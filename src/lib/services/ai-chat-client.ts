import {
	getCells,
	getLastCellId,
	getExternalSchemaTables,
	getTables,
	getLLMConfig,
	getActiveTabId,
	insertCellAfter,
	appendCellAtEnd,
	updateCellCode,
	updateCellMarkdown,
	updateCellName,
	removeCell,
	runCell,
	runPythonCell,
	insertPythonCellAfter,
	addPythonCell,
	updatePythonCellCode,
	getPythonAvailable,
	setCellResultChartConfig,
	setCellResultViewMode,
	setCellMarkdownPreview,
	setCellMaterializeMode,
	restoreCellSnapshots,
	moveCell,
	reorderCell,
	getConnections,
	getAllCellsAcrossNotebooks,
	scheduleSave,
	getProjectFolder,
	getIsDbtProject,
	type CellSnapshot,
	type CellMaterializationMode
} from '$lib/stores/notebook.svelte.js';
import {
	readAIMemory,
	recordAIMemoryEntry,
	writeAIConventions
} from '$lib/services/project-client.js';
import {
	getMessages,
	appendMessage,
	updateMessageText,
	appendErrorMessage,
	setMessageStreaming,
	appendActionEvent,
	updateLastActionEvent,
	setMessageSuggestions,
	setMessageError,
	getIsGenerating,
	setIsGenerating,
	setActiveController,
	getContextCellIds,
	clearContextCells,
	markGhostCell,
	unmarkGhostCell,
	clearGhostCells,
	setPendingSnapshot,
	getPendingSnapshot,
	setUndoAvailable,
	getWorkspaceStandards,
	setWorkspaceStandards,
	pushCheckpoint,
	popCheckpoint,
	clearCheckpoints,
	getCheckpointCount,
	requestConfirmation,
	resolveConfirmation,
	requestPlanApproval,
	getSprintTasks,
	setSprintTasks,
	updateSprintTask,
	clearSprintTasks,
	requestSprintPlanApproval,
	setCurrentActivityLabel,
	getHistorySummaryCache,
	setHistorySummaryCache,
	setPipelinePhases,
	updatePipelinePhase,
	clearPipelinePhases,
	type NotebookSnapshot
} from '$lib/stores/ai-chat.svelte.js';
import type {
	AIChatRequest,
	AIChatToolCall,
	CreateCellArgs,
	UpdateCellArgs,
	SetChartArgs,
	PickChartArgs,
	SetViewModeArgs,
	DeleteCellArgs,
	RunCellsArgs,
	MoveCellArgs,
	GetCellResultArgs,
	GetLineageArgs,
	SearchWorkspaceArgs,
	QueryDataArgs,
	SampleDataArgs,
	ProfileColumnArgs,
	RecordDecisionArgs,
	WorkspaceContract,
	WorkspaceNamingRule,
	SprintTask,
	SprintTaskType,
	PipelinePhase
} from '$lib/types/ai-chat.js';
import {
	buildDiscoverySummary,
	parseReviewResult,
	formatReviewFeedback,
	SUBAGENT_TOOLS,
	SPRINT_TASK_TOOLS
} from '$lib/services/ai-subagents.js';
import type { PlanAssertion } from '$lib/types/ai-subagents.js';
import { executeSQL } from '$lib/services/duckdb.js';
import { queryConnectionSQL } from '$lib/services/connections.js';
import { resolveDependencies } from '$lib/services/cell-deps.js';
import { detectHardcodedContent } from '$lib/services/markdown-lint.js';
import { createSSEParser, type SSEEvent } from '$lib/services/ai-stream.js';
import { rowsToCsv } from '$lib/utils.js';
import {
	estimateTokens,
	fitToTokenBudget,
	DEFAULT_HISTORY_TOKEN_BUDGET
} from '$lib/services/token-budget.js';
import { summarizeOlderTurns } from '$lib/services/history-summarizer.js';
import { type Connection, isBuiltinDuckDBConnection } from '$lib/types/connection.js';
import {
	quoteIdent,
	toMarkdownTable,
	getDefaultConnection,
	getConnectionForTable,
	runRawQuery,
	knownTableNames,
	assertKnownTable
} from '$lib/services/ai-investigation-tools.js';
import {
	emitAgentTelemetry,
	resetAgentSessionId,
	flushAgentTelemetry
} from '$lib/agent/telemetry.js';
import { authorizeAITool, clearAIToolAuthCache } from '$lib/agent/tools/authorize.js';
import { routeAgentIntent } from '$lib/agent/router/intent-router.js';
import { createFsmContext, transitionFsm, applyTransition } from '$lib/agent/fsm/agent-fsm.js';

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTrailingSemicolons(sql: string): string {
	return sql
		.trimEnd()
		.replace(/;+\s*$/, '')
		.trimEnd();
}

function fixBacktickIdents(sql: string): string {
	// Backticks are never valid in DuckDB/Trino — silently convert to double-quotes
	return sql.replace(/`([^`\n]+)`/g, '"$1"');
}

/**
 * Extract a compact, relevant excerpt from failing SQL to include in error feedback.
 * If the error message contains a line number, return those lines ±1 for context.
 * Otherwise return the first 400 chars (covers the SELECT clause for most queries).
 * Gives local LLMs the context to spot the bad pattern without the token cost of the full query.
 */
function extractSQLSnippet(sql: string, errMsg: string): string {
	const lineMatch = errMsg.match(/(?:at line|line)\s+(\d+)/i);
	if (lineMatch) {
		const lineNum = parseInt(lineMatch[1], 10) - 1; // 0-indexed
		const lines = sql.split('\n');
		const start = Math.max(0, lineNum - 1);
		const end = Math.min(lines.length, lineNum + 2);
		return lines.slice(start, end).join('\n').trim();
	}
	const prefix = sql.slice(0, 400).trimEnd();
	return sql.length > 400 ? prefix + '\n...' : prefix;
}

function fixBracketSubscripts(sql: string): string {
	// alias["col"] is array/struct subscript syntax in DuckDB, not a column reference.
	// Convert identifier["col"] → identifier."col" so spaced column names work correctly.
	// Only matches when the bracket content is a double-quoted string (not a numeric index).
	return sql.replace(/(\w+)\["([^"]+)"\]/g, '$1."$2"');
}

/**
 * Quote any schema column names that contain spaces but appear unquoted in the SQL.
 * Works by splitting on already-quoted tokens (double-quoted identifiers and single-quoted
 * string literals) and only processing the unquoted segments between them, so existing
 * quoted identifiers and string values are never double-processed.
 */
function fixUnquotedSpacedColumns(sql: string): string {
	const spacedCols = new Set<string>();
	for (const t of getExternalSchemaTables()) {
		for (const col of t.columns) if (col.includes(' ')) spacedCols.add(col);
	}
	for (const t of getTables()) {
		for (const col of t.columns ?? []) if (col.includes(' ')) spacedCols.add(col);
	}
	if (spacedCols.size === 0) return sql;

	// Longest first so overlapping names (e.g. "Foo Bar" vs "Foo") are handled correctly
	const cols = [...spacedCols].sort((a, b) => b.length - a.length);

	// Split on any already-quoted token: "ident" or 'string literal'
	const segments = sql.split(/(\"[^\"]*\"|'[^']*')/);
	return segments
		.map((seg, i) => {
			if (i % 2 === 1) return seg; // inside an existing quoted token — leave alone
			let result = seg;
			for (const col of cols) {
				result = result.replace(new RegExp(escapeRegExp(col), 'g'), `"${col}"`);
			}
			return result;
		})
		.join('');
}

function sanitizeSQL(sql: string): string {
	return fixUnquotedSpacedColumns(fixBacktickIdents(fixBracketSubscripts(sql)));
}

/**
 * Lightweight pre-execution column validation: warns if the SQL references columns
 * that don't appear in the known schema. Returns a warning string or null.
 */
function validateColumnRefs(
	sql: string,
	externalTables: ReturnType<typeof getExternalSchemaTables>,
	localTables: ReturnType<typeof getTables>
): string | null {
	if (!sql) return null;
	const knownColumns = new Set<string>();
	for (const t of externalTables) for (const col of t.columns) knownColumns.add(col.toLowerCase());
	for (const t of localTables)
		for (const col of t.columns ?? []) knownColumns.add(col.toLowerCase());
	if (knownColumns.size === 0) return null;

	// Extract bare identifiers from SELECT list (between SELECT and FROM/WHERE/GROUP)
	const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+(?:FROM|WHERE|GROUP|ORDER|LIMIT|HAVING)\b/i);
	if (!selectMatch) return null;

	const selectList = selectMatch[1];
	// Extract aliases or bare column names; skip *, aggregates, expressions
	const colRefs = [
		...selectList.matchAll(/(?:^|,)\s*(?:[a-z_]\w*\.)?(([a-z_]\w*))\s*(?:AS\s+\w+)?\s*(?=,|$)/gi)
	]
		.map((m) => m[2]?.toLowerCase())
		.filter((name): name is string => !!name && name !== '*');

	const unknown = colRefs.filter((col) => !knownColumns.has(col) && col !== 'null');
	if (unknown.length === 0) return null;
	return `column(s) not found in schema: ${unknown.slice(0, 3).join(', ')} — verify names before running`;
}

function levenshtein(a: string, b: string): number {
	const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = i;
		for (let j = 1; j <= b.length; j++) {
			const cur = a[i - 1] === b[j - 1] ? dp[j - 1] : Math.min(dp[j - 1], dp[j], prev) + 1;
			dp[j - 1] = prev;
			prev = cur;
		}
		dp[b.length] = prev;
	}
	return dp[b.length];
}

function findClosestColumn(
	failingName: string,
	allTables: Array<{ name: string; columns: string[] }>
): { table: string; column: string } | null {
	const lower = failingName.toLowerCase();
	let best: { table: string; column: string } | null = null;
	let bestDist = 4; // only suggest matches within edit distance 3
	for (const t of allTables) {
		for (const col of t.columns) {
			const dist = levenshtein(lower, col.toLowerCase());
			if (dist < bestDist) {
				bestDist = dist;
				best = { table: t.name, column: col };
			}
		}
	}
	return best;
}

const _sessionId = crypto.randomUUID();

// ── Data tool state ───────────────────────────────────────────────────────────

// Accumulated facts discovered through data tool calls — persists across turns
let _sessionDataContext = new Map<string, string>();
// Modeling decisions recorded via record_decision tool — persists across turns
let _sessionPlanContext: string[] = [];
// Row count + column profile cache per table — keyed by table name
let _preflightCache = new Map<
	string,
	{ rowCount: number; columnProfiles: Record<string, string> }
>();
// Skip preflight on subsequent turns once it has run for this session
let _preflightDone = false;
// Skip idle expansion once it has fired for this session
let _idlePreflightDone = false;
// Schema hash from previous buildRequest — used to detect schema changes across turns
let _lastSchemaHash: string | null = null;

const AI_MEMORY_KEY = 'lunapad_ai_memory';
const AI_MEMORY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Persist key session context so it survives page reloads. */
function saveAIMemory(): void {
	try {
		const payload = JSON.stringify({
			dataContext: [..._sessionDataContext.entries()].slice(-10),
			planContext: _sessionPlanContext.slice(-5),
			savedAt: Date.now()
		});
		localStorage.setItem(AI_MEMORY_KEY, payload);
	} catch {
		/* storage full or unavailable */
	}
}

/** Load persisted session context at startup (max 24h old). */
function loadAIMemory(): void {
	try {
		const raw = localStorage.getItem(AI_MEMORY_KEY);
		if (!raw) return;
		const { dataContext, planContext, savedAt } = JSON.parse(raw) as {
			dataContext: [string, string][];
			planContext: string[];
			savedAt: number;
		};
		if (Date.now() - savedAt > AI_MEMORY_TTL_MS) return;
		for (const [k, v] of dataContext) _sessionDataContext.set(k, v);
		_sessionPlanContext.push(...planContext);
	} catch {
		/* corrupted or unavailable */
	}
}

// Load persisted memory immediately on module init
loadAIMemory();

export function resetAISession(): void {
	saveAIMemory();
	_sessionDataContext = new Map();
	_sessionPlanContext = [];
	_preflightCache = new Map();
	_preflightDone = false;
	_idlePreflightDone = false;
	_lastSchemaHash = null;
	clearCheckpoints();
	resetAgentSessionId();
	clearAIToolAuthCache();
}

// Tracks which project folder's memory is currently loaded into session state, so a folder
// switch (including to/from no-project demo mode) is detected once per change rather than
// re-fetched on every turn. `null` also covers "no project open yet".
let _lastLoadedMemoryFolder: string | null | undefined = undefined;

/** Seeds session memory from `.lunapad/memory/` when a project folder is open, or falls back
 *  to the existing localStorage path in demo mode. Call once per turn, before `buildRequest()` —
 *  it's a no-op unless the open project folder changed since the last call.
 *
 *  Folder changes (including closing a project) also reset the rest of session state — today
 *  `resetAISession()` is only wired to a manual "reset" button, so without this, tool-output
 *  cache and decisions from a previously-open project would otherwise silently leak into a
 *  different project's chat session. */
export async function loadProjectMemoryIfNeeded(): Promise<void> {
	const folder = getProjectFolder();
	if (folder === _lastLoadedMemoryFolder) return;
	_lastLoadedMemoryFolder = folder;

	_sessionDataContext = new Map();
	_preflightCache = new Map();
	_preflightDone = false;
	_idlePreflightDone = false;
	_lastSchemaHash = null;

	if (!folder || !getIsDbtProject()) {
		_sessionPlanContext = [];
		loadAIMemory();
		return;
	}

	try {
		const { conventions, entries } = await readAIMemory(folder);
		// Ambient seed stays small and recency-based (the index is already sorted newest-first) —
		// anything beyond this is retrieved on demand via search_workspace, not dumped here.
		_sessionPlanContext = entries.slice(0, 5).map((e) => `(${e.type}) ${e.description}`);
		const existing = getWorkspaceStandards();
		setWorkspaceStandards({ ...existing, customInstructions: conventions });
	} catch (err) {
		console.error('[ai-memory] failed to load project memory:', err);
		_sessionPlanContext = [];
	}
}

/** Appends up to 3 "learned" bullets to customInstructions after a review cycle resolves
 *  issues a previous fix pass introduced. Shared by both the subagent pipeline and sprint
 *  loop's review steps (previously duplicated verbatim in each). Mirrors the update to disk
 *  when a project is open, so self-learned conventions survive across sessions too. */
function persistLearnedPatterns(lastIssues: string[]): void {
	const existing = getWorkspaceStandards();
	const date = new Date().toLocaleDateString();
	const learned = lastIssues
		.slice(0, 3)
		.map((issue) => `• ${issue} [learned ${date}]`)
		.join('\n');
	const customInstructions = [existing.customInstructions, learned].filter(Boolean).join('\n');
	setWorkspaceStandards({ ...existing, customInstructions });
	scheduleSave();

	const folder = getProjectFolder();
	if (folder && getIsDbtProject()) {
		writeAIConventions(folder, customInstructions).catch((err) =>
			console.error('[ai-memory] failed to persist learned conventions:', err)
		);
	}
}

const DATA_TOOL_NAMES = new Set(['query_data', 'sample_data', 'profile_column']);

interface DataToolResult {
	llmText: string;
	previewText: string;
	label: string;
	contextKey: string;
	contextSummary: string;
}

async function executeDataTool(call: AIChatToolCall): Promise<DataToolResult | null> {
	try {
		switch (call.tool) {
			case 'query_data': {
				const { sql, limit = 20 } = call.args as QueryDataArgs;
				const safeLimit = Math.min(limit ?? 20, 50);
				const wrappedSql = /\bLIMIT\s+\d+/i.test(sql)
					? sql
					: `SELECT * FROM (${sql}) _q LIMIT ${safeLimit}`;
				const result = await runRawQuery(wrappedSql);
				const csv = rowsToCsv(result.columns, result.rows);
				const preview = toMarkdownTable(result.columns, result.rows);
				const summary = `${result.rows.length} rows, columns: ${result.columns.join(', ')}`;
				const shortSql = sql.replace(/\s+/g, ' ').slice(0, 80);
				return {
					llmText: `query_data(${result.rows.length} rows):\n${csv}`,
					previewText: preview,
					label: `Queried → ${result.rows.length} rows`,
					contextKey: `query: ${shortSql}`,
					contextSummary: summary
				};
			}
			case 'sample_data': {
				const { table, n = 10 } = call.args as SampleDataArgs;
				const tableError = assertKnownTable(table);
				if (tableError) {
					return {
						llmText: `sample_data failed: ${tableError}`,
						previewText: tableError,
						label: `Unknown table: ${table}`,
						contextKey: `error: sample_data(${table})`,
						contextSummary: tableError
					};
				}
				const safeN = Math.min(n ?? 10, 50);
				const { isBuiltin, connection } = getConnectionForTable(table) ?? getDefaultConnection();
				const qt = quoteIdent(table);
				const sampleSql = isBuiltin
					? `SELECT * FROM ${qt} USING SAMPLE ${safeN} ROWS`
					: connection.type === 'clickhouse'
						? `SELECT * FROM ${qt} ORDER BY rand() LIMIT ${safeN}`
						: `SELECT * FROM ${qt} ORDER BY RANDOM() LIMIT ${safeN}`;
				const result = await runRawQuery(sampleSql, table);
				const csv = rowsToCsv(result.columns, result.rows);
				const preview = toMarkdownTable(result.columns, result.rows);
				const summary = `${result.rows.length} rows sampled, columns: ${result.columns.join(', ')}`;
				return {
					llmText: `sample_data(${table}, ${safeN}) → ${result.rows.length} rows:\n${csv}`,
					previewText: preview,
					label: `Sampled ${table} → ${result.rows.length} rows`,
					contextKey: `sample: ${table}`,
					contextSummary: summary
				};
			}
			case 'profile_column': {
				const { table, column } = call.args as ProfileColumnArgs;
				const profileTableError = assertKnownTable(table);
				if (profileTableError) {
					return {
						llmText: `profile_column failed: ${profileTableError}`,
						previewText: profileTableError,
						label: `Unknown table: ${table}`,
						contextKey: `error: profile_column(${table})`,
						contextSummary: profileTableError
					};
				}
				const qCol = quoteIdent(column);
				const qTable = quoteIdent(table);
				const [nullRes, statsRes, topRes] = await Promise.all([
					runRawQuery(
						`SELECT COUNT(*) AS _total, COUNT(${qCol}) AS _non_null FROM ${qTable}`,
						table
					),
					runRawQuery(
						`SELECT MIN(${qCol}) AS _min, MAX(${qCol}) AS _max, COUNT(DISTINCT ${qCol}) AS _distinct FROM ${qTable}`,
						table
					),
					runRawQuery(
						`SELECT ${qCol} AS _val, COUNT(*) AS _cnt FROM ${qTable} WHERE ${qCol} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
						table
					)
				]);
				const total = Number(nullRes.rows[0]?.['_total'] ?? 0);
				const nonNull = Number(nullRes.rows[0]?.['_non_null'] ?? 0);
				const nullRate = total > 0 ? (((total - nonNull) / total) * 100).toFixed(1) + '%' : 'N/A';
				const minVal = statsRes.rows[0]?.['_min'];
				const maxVal = statsRes.rows[0]?.['_max'];
				const distinctCount = statsRes.rows[0]?.['_distinct'];
				const topValues = topRes.rows.map((r) => String(r['_val'])).join(', ');
				const statsText = `null: ${nullRate}, distinct: ${distinctCount}, min: ${minVal}, max: ${maxVal}, top: [${topValues}]`;
				return {
					llmText: `profile_column(${table}.${column}): ${statsText}`,
					previewText: statsText,
					label: `Profiled ${table}.${column}`,
					contextKey: `profile: ${table}.${column}`,
					contextSummary: statsText
				};
			}
			default:
				return null;
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Query failed';
		return {
			llmText: `${call.tool} failed: ${msg}`,
			previewText: `Error: ${msg.slice(0, 100)}`,
			label: `Failed: ${msg.slice(0, 50)}`,
			contextKey: `error: ${call.tool}`,
			contextSummary: msg
		};
	}
}

async function runPreflightProfiles(): Promise<void> {
	const withTimeout = <T>(ms: number, p: Promise<T>): Promise<T> =>
		Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

	async function profileTable(
		cacheKey: string,
		columns: string[],
		columnTypes: string[],
		query: (sql: string) => Promise<{ columns: string[]; rows: Record<string, unknown>[] }>,
		timeoutMs: number
	): Promise<void> {
		if (_preflightCache.has(cacheKey)) return;
		try {
			const countResult = await withTimeout(
				timeoutMs,
				query(`SELECT COUNT(*) AS _c FROM ${quoteIdent(cacheKey)}`)
			);
			const rowCount = Number(countResult.rows[0]?.['_c'] ?? 0);
			const textCols = columns
				.slice(0, 5)
				.map((col, i) => ({ col, type: (columnTypes[i] ?? '').toUpperCase() }))
				.filter(({ type }) => /VARCHAR|TEXT|STRING|CHAR/.test(type) || type === '')
				.slice(0, 3);
			const columnProfiles: Record<string, string> = {};
			await Promise.all(
				textCols.map(async ({ col }) => {
					try {
						const vals = await withTimeout(
							timeoutMs,
							query(
								`SELECT ${quoteIdent(col)}, COUNT(*) AS _cnt FROM ${quoteIdent(cacheKey)} WHERE ${quoteIdent(col)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`
							)
						);
						columnProfiles[col] = vals.rows.map((r) => String(r[col])).join(', ');
					} catch {
						/* skip column */
					}
				})
			);
			_preflightCache.set(cacheKey, { rowCount, columnProfiles });
		} catch {
			/* skip table on timeout or error */
		}
	}

	// DuckDB tables
	const duckdbWork = getTables()
		.slice(0, 8)
		.map((t) => profileTable(t.name, t.columns ?? [], t.columnTypes ?? [], executeSQL, 2000));

	// External connection tables — grouped by connection
	const externalTables = getExternalSchemaTables();
	const connections = getConnections();
	const byConn = new Map<string, typeof externalTables>();
	for (const t of externalTables) {
		const list = byConn.get(t.connectionId) ?? [];
		list.push(t);
		byConn.set(t.connectionId, list);
	}
	const externalWork = [...byConn.entries()].flatMap(([connId, tables]) => {
		const conn = connections.find((c) => c.id === connId);
		if (!conn || isBuiltinDuckDBConnection(conn)) return [];
		const query = (sql: string) => queryConnectionSQL(conn, sql);
		return tables.slice(0, 6).map((t) => {
			const cacheKey = t.schema ? `${t.schema}.${t.name}` : t.name;
			return profileTable(cacheKey, t.columns, t.columnTypes, query, 3000);
		});
	});

	await Promise.all([...duckdbWork, ...externalWork]);
}

// #7 — Profiles remaining tables (indices 8+ for DuckDB, tail of external) in the background
// after the first preflight has already warmed the hot tables.
async function runIdlePreflightExpansion(): Promise<void> {
	if (_idlePreflightDone) return;
	_idlePreflightDone = true;

	const withTimeout = <T>(ms: number, p: Promise<T>): Promise<T> =>
		Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

	async function profileTable(
		cacheKey: string,
		columns: string[],
		columnTypes: string[],
		query: (sql: string) => Promise<{ columns: string[]; rows: Record<string, unknown>[] }>,
		timeoutMs: number
	): Promise<void> {
		if (_preflightCache.has(cacheKey)) return;
		try {
			const countResult = await withTimeout(
				timeoutMs,
				query(`SELECT COUNT(*) AS _c FROM ${quoteIdent(cacheKey)}`)
			);
			const rowCount = Number(countResult.rows[0]?.['_c'] ?? 0);
			const textCols = columns
				.slice(0, 5)
				.map((col, i) => ({ col, type: (columnTypes[i] ?? '').toUpperCase() }))
				.filter(({ type }) => /VARCHAR|TEXT|STRING|CHAR/.test(type) || type === '')
				.slice(0, 3);
			const columnProfiles: Record<string, string> = {};
			await Promise.all(
				textCols.map(async ({ col }) => {
					try {
						const vals = await withTimeout(
							timeoutMs,
							query(
								`SELECT ${quoteIdent(col)}, COUNT(*) AS _cnt FROM ${quoteIdent(cacheKey)} WHERE ${quoteIdent(col)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`
							)
						);
						columnProfiles[col] = vals.rows.map((r) => String(r[col])).join(', ');
					} catch {
						/* skip column */
					}
				})
			);
			_preflightCache.set(cacheKey, { rowCount, columnProfiles });
		} catch {
			/* skip on timeout */
		}
	}

	// DuckDB: indices 8+ (first 8 already profiled in runPreflightProfiles)
	const duckdbRemainder = getTables()
		.slice(8, 30)
		.map((t) => profileTable(t.name, t.columns ?? [], t.columnTypes ?? [], executeSQL, 3000));

	// External: all connections, tables 6+ per connection
	const externalTables = getExternalSchemaTables();
	const connections = getConnections();
	const byConn = new Map<string, typeof externalTables>();
	for (const t of externalTables) {
		const list = byConn.get(t.connectionId) ?? [];
		list.push(t);
		byConn.set(t.connectionId, list);
	}
	const externalRemainder = [...byConn.entries()].flatMap(([connId, tables]) => {
		const conn = connections.find((c) => c.id === connId);
		if (!conn || isBuiltinDuckDBConnection(conn)) return [];
		const query = (sql: string) => queryConnectionSQL(conn, sql);
		return tables.slice(6, 20).map((t) => {
			const cacheKey = t.schema ? `${t.schema}.${t.name}` : t.name;
			return profileTable(cacheKey, t.columns, t.columnTypes, query, 4000);
		});
	});

	// Run all with small gaps so we don't hammer the DB during active use
	for (const work of [...duckdbRemainder, ...externalRemainder]) {
		await work;
		await new Promise<void>((r) => setTimeout(r, 100));
	}
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

function takeSnapshot(): NotebookSnapshot {
	const notebookId = getActiveTabId();
	const cells = getCells();
	return {
		notebookId,
		cells: cells.map(
			(c) =>
				({
					id: c.id,
					outputName: c.outputName,
					code: c.code,
					markdown: c.markdown,
					udfBody: c.udfBody,
					language: c.language,
					cellType: c.cellType,
					display: c.display,
					guiStages: c.guiStages,
					editMode: c.editMode,
					connectionId: c.connectionId,
					materializeMode: c.materializeMode,
					materializeTarget: c.materializeTarget,
					description: c.description,
					dbtTags: c.dbtTags,
					scheduleEnabled: c.scheduleEnabled,
					scheduleIntervalMinutes: c.scheduleIntervalMinutes,
					scheduleScope: c.scheduleScope,
					result: c.result,
					status: c.status,
					resultViewMode: c.resultViewMode,
					resultChartConfig: c.resultChartConfig,
					executionMs: c.executionMs,
					errors: c.errors
				}) satisfies CellSnapshot
		)
	};
}

export function undoAIChanges(): void {
	const snap = getPendingSnapshot();
	if (!snap) return;

	// Record outcomes: cells that were created this generation are being deleted
	const ghostIds = new Set([..._outputNameToId.values()]);
	for (const [outputName, cellId] of _outputNameToId) {
		if (ghostIds.has(cellId)) {
			const originalCell = snap.cells.find((c) => c.id === cellId);
			void fetch('/api/ai/outcome', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId: _sessionId,
					cellId,
					outputName,
					outcome: 'deleted',
					originalCode: originalCell?.code ?? ''
				})
			}).catch(() => {});
		}
	}

	clearGhostCells();
	clearCheckpoints();
	restoreCellSnapshots(snap.notebookId, snap.cells);
	setPendingSnapshot(null);
	setUndoAvailable(false);
}

export function undoLastAIStep(): void {
	const snap = popCheckpoint();
	if (!snap) return;
	clearGhostCells();
	restoreCellSnapshots(snap.notebookId, snap.cells);
	// Keep pendingSnapshot and undoAvailable so full undo is still possible
}

// ── Context builder ───────────────────────────────────────────────────────────

const KNOWN_PREFIXES: Record<string, string> = {
	stg_: 'staging/cleaning',
	dim_: 'entity tables',
	fct_: 'event facts',
	mart_: 'reporting marts',
	metric_: 'business metrics',
	feat_: 'feature engineering',
	int_: 'intermediate transforms',
	rpt_: 'report views'
};

const VALID_MATERIALIZE_MODES = new Set([
	'ephemeral',
	'view',
	'table',
	'incremental',
	'materialized_view'
]);

function deriveWorkspaceContract(
	cells: ReturnType<typeof getCells>,
	downstreamCounts: Map<string, number>
): WorkspaceContract | undefined {
	const standards = getWorkspaceStandards();

	// Determine naming rules: user-defined takes priority, otherwise infer from cells
	let namingRules: WorkspaceNamingRule[];
	if (standards.namingRules.length > 0) {
		namingRules = standards.namingRules;
	} else {
		// Infer from existing cells: group by recognized prefix, take materializeMode of first cell
		const seen = new Map<string, { materialization: string; count: number }>();
		for (const cell of cells) {
			if (cell.cellType !== 'query' || !cell.outputName) continue;
			for (const [prefix, description] of Object.entries(KNOWN_PREFIXES)) {
				if (cell.outputName.startsWith(prefix)) {
					if (!seen.has(prefix)) {
						seen.set(prefix, { materialization: cell.materializeMode ?? 'ephemeral', count: 0 });
					}
					seen.get(prefix)!.count++;
					break;
				}
			}
		}
		namingRules = [...seen.entries()].map(([prefix, { materialization }]) => ({
			prefix,
			description: KNOWN_PREFIXES[prefix],
			materialization
		}));
	}

	// Top reusable models: query cells with at least 1 downstream, sorted by downstream count
	const topReusableModels = cells
		.filter(
			(c) => c.cellType === 'query' && c.outputName && (downstreamCounts.get(c.outputName) ?? 0) > 0
		)
		.sort(
			(a, b) =>
				(downstreamCounts.get(b.outputName) ?? 0) - (downstreamCounts.get(a.outputName) ?? 0)
		)
		.slice(0, 8)
		.map((c) => ({
			name: c.outputName,
			downstreamCount: downstreamCounts.get(c.outputName) ?? 0
		}));

	if (
		namingRules.length === 0 &&
		topReusableModels.length === 0 &&
		!standards.customInstructions.trim()
	) {
		return undefined;
	}

	return {
		namingRules,
		topReusableModels,
		...(standards.customInstructions.trim() && {
			customInstructions: standards.customInstructions.trim()
		})
	};
}

/**
 * Strip verbose read-tool result blocks from old assistant messages.
 * These blocks are injected into message text by executeReadTool via updateMessageText
 * and can be large (search results include full SQL code). The underlying facts are
 * already captured in sessionDataContext / sessionPlanContext / the system prompt, so
 * removing them from stale turns reduces context size without losing useful information.
 *
 * NOT applied to the 2 most recent messages so the current turn's tool results stay intact.
 */
function compressOldMessage(content: string): string {
	if (content.length < 400) return content;
	let result = content;

	// search_workspace: may span multiple \n\n due to embedded SQL code blocks — use regex
	// that stops at the next bold heading or tool_call tag rather than the next blank line.
	result = result.replace(
		/\n{1,2}\*\*Search: "[^"]*"\*\*[\s\S]*?(?=\n\n(?:\*\*|<tool_call>)|$)/g,
		''
	);

	// All other read-tool blocks fit in a single \n\n-separated paragraph — filter by prefix.
	const DROP_PREFIXES = ['**Cells:**\n', '**Lineage: `', '**Search unavailable**'];
	const paragraphs = result.split('\n\n');
	const filtered = paragraphs.filter((p) => {
		const t = p.trimStart();
		return !DROP_PREFIXES.some((prefix) => t.startsWith(prefix));
	});
	return filtered.join('\n\n');
}

type ChatTurn = { role: 'user' | 'assistant'; content: string };

/**
 * Relevance-weighted, token-budgeted history selection — kept first (task framing) + any older
 * messages that mention active cell outputNames (preserves per-cell context, token-budgeted
 * since this is the one part that can grow unboundedly with conversation length) + last 6 always.
 * Also retains the most recent assistant message containing a <plan> block so the model never
 * loses an agreed plan mid-task, even as the window slides.
 *
 * Pure (no store/network access) so it's independently testable — `buildRequest` below handles
 * the side-effecting parts (reading/writing the history-summary cache, kicking off the
 * background summarization call) using `dropped` from this function's result.
 */
export function selectConversationHistory(
	allMsgs: ChatTurn[],
	activeOutputNames: Set<string>
): { conversationMessages: ChatTurn[]; dropped: ChatTurn[] } {
	if (allMsgs.length <= 7) {
		return { conversationMessages: allMsgs, dropped: [] };
	}

	const first = allMsgs[0];
	const last6 = allMsgs.slice(-6);
	const older = allMsgs.slice(1, -6);
	const relevant = older.filter((m) =>
		[...activeOutputNames].some((name) => m.content.includes(name))
	);
	// Intent-anchor: most recent plan-containing message not already in relevant or last6
	const relevantSet = new Set(relevant);
	const planMsg = [...older]
		.reverse()
		.find((m) => m.role === 'assistant' && m.content.includes('<plan>') && !relevantSet.has(m));
	// Strip verbose read-tool blocks from stale messages; keep the 2 most recent intact
	// so the current turn's tool results (list_cells, search, etc.) remain fully visible.
	const compress = (m: ChatTurn) =>
		m.role === 'assistant' ? { ...m, content: compressOldMessage(m.content) } : m;

	const compressedFirst = compress(first);
	const compressedPlanMsg = planMsg ? compress(planMsg) : undefined;
	const compressedLast6 = [...last6.slice(0, -2).map(compress), ...last6.slice(-2)];
	// `relevant` is the one part of this list that can grow unboundedly with conversation
	// length (every distinct active outputName mentioned anywhere in history adds a
	// candidate) — first/planMsg/last6 are all small, fixed-size, and always kept in full.
	// Token-budget only the unbounded part, prioritizing the most recently mentioned
	// messages over older ones when the budget doesn't stretch to all of them.
	const reserved =
		estimateTokens(compressedFirst.content) +
		(compressedPlanMsg ? estimateTokens(compressedPlanMsg.content) : 0) +
		compressedLast6.reduce((sum, m) => sum + estimateTokens(m.content), 0);
	const remainingBudget = Math.max(0, DEFAULT_HISTORY_TOKEN_BUDGET - reserved);
	const compressedRelevant = relevant.map(compress);
	const relevantByRecencyDesc = [...compressedRelevant].reverse();
	const { kept, dropped } = fitToTokenBudget(relevantByRecencyDesc, remainingBudget, (m) =>
		estimateTokens(m.content)
	);
	const keptRelevantChronological = [...kept].reverse();
	const droppedChronological = [...dropped].reverse();

	return {
		conversationMessages: [
			compressedFirst,
			...keptRelevantChronological,
			...(compressedPlanMsg ? [compressedPlanMsg] : []),
			...compressedLast6
		],
		dropped: droppedChronological
	};
}

// Only worth the rolling-summarization LLM round trip once the dropped mass is more than a
// couple of stray messages — otherwise we'd re-summarize away one borderline message every turn
// for no real benefit.
const MIN_SUMMARIZE_TOKENS = 300;

function buildRequest(contextCellIds: string[], workspaceMemory?: string): AIChatRequest {
	const cells = getCells();
	const schema = getExternalSchemaTables();
	const llmConfig = getLLMConfig();
	const defaultConn = getDefaultConnection();

	const allMsgs: ChatTurn[] = getMessages()
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text }));
	const activeOutputNames = new Set(cells.map((c) => c.outputName).filter(Boolean));
	const { conversationMessages: selectedHistory, dropped } = selectConversationHistory(
		allMsgs,
		activeOutputNames
	);

	const droppedTokens = dropped.reduce((sum, m) => sum + estimateTokens(m.content), 0);
	let summaryMessage: ChatTurn | undefined;
	if (dropped.length > 0 && droppedTokens > MIN_SUMMARIZE_TOKENS) {
		const cache = getHistorySummaryCache();
		if (cache) {
			summaryMessage = { role: 'assistant', content: `Session summary so far: ${cache.summary}` };
		}
		if (!cache || cache.atMessageCount < allMsgs.length) {
			// Stale or missing — refresh in the background for the *next* turn to pick up. This
			// turn proceeds with whatever cached summary it had (possibly none) rather than
			// blocking on an extra LLM round trip.
			void summarizeOlderTurns(dropped, llmConfig)
				.then((summary) => setHistorySummaryCache({ atMessageCount: allMsgs.length, summary }))
				.catch(() => {});
		}
	}

	const conversationMessages: ChatTurn[] = summaryMessage
		? [selectedHistory[0], summaryMessage, ...selectedHistory.slice(1)]
		: selectedHistory;

	// Merge DuckDB local tables + external schema tables into unified schema list
	// Enrich with preflight profiles if available
	const duckdbTables = getTables().map((t) => {
		const profile = _preflightCache.get(t.name);
		return {
			name: t.name,
			columns: t.columns.slice(0, 30),
			columnTypes: t.columnTypes?.slice(0, 30) ?? [],
			...(profile?.rowCount != null && { rowCount: profile.rowCount }),
			...(profile?.columnProfiles &&
				Object.keys(profile.columnProfiles).length > 0 && {
					columnProfiles: profile.columnProfiles
				})
		};
	});
	// Today's client-side truncation — kept as a cheap fallback for when server-side retrieval
	// (against schema_embeddings, scoped by externalConnectionIds below) is unavailable. No
	// longer the primary path: at warehouse scale a flat slice(0, 40) made any table outside
	// the window structurally invisible to the AI, regardless of relevance.
	const externalSchemaFallback = schema.slice(0, 40).map((t) => {
		const cacheKey = t.schema ? `${t.schema}.${t.name}` : t.name;
		const profile = _preflightCache.get(cacheKey);
		return {
			name: cacheKey,
			columns: t.columns.slice(0, 30),
			columnTypes: t.columnTypes?.slice(0, 30) ?? [],
			...(t.description && { description: t.description }),
			...(profile?.rowCount != null && { rowCount: profile.rowCount }),
			...(profile?.columnProfiles &&
				Object.keys(profile.columnProfiles).length > 0 && {
					columnProfiles: profile.columnProfiles
				})
		};
	});
	const externalConnectionIds = [...new Set(schema.map((t) => t.connectionId))];
	const allSchemaTables = [...duckdbTables, ...externalSchemaFallback].slice(0, 50);

	// #9 — Schema-diff awareness: detect table additions/removals across turns
	const currentSchemaHash = allSchemaTables
		.map((t) => `${t.name}:${t.columns.slice(0, 10).join(',')}`)
		.sort()
		.join('|');
	const schemaChangeNote =
		_lastSchemaHash !== null && _lastSchemaHash !== currentSchemaHash
			? 'Schema changed since the previous turn — a table or column was added or removed. Re-verify column names before writing SQL.'
			: undefined;
	_lastSchemaHash = currentSchemaHash;

	// Build regex map for whole-word matching of outputNames
	const outputNames = cells.filter((c) => c.outputName).map((c) => c.outputName);
	const nameRegexes = new Map<string, RegExp>(
		outputNames.map((n) => [n, new RegExp(`\\b${escapeRegExp(n)}\\b`)])
	);

	// Pre-compute downstream counts per outputName (needed for workspace contract)
	const downstreamCounts = new Map<string, number>();
	for (const cell of cells) {
		if (!cell.outputName) continue;
		const re = nameRegexes.get(cell.outputName)!;
		let count = 0;
		for (const other of cells) {
			if (other.outputName !== cell.outputName && re.test(other.code)) count++;
		}
		if (count > 0) downstreamCounts.set(cell.outputName, count);
	}

	const workspaceContract = deriveWorkspaceContract(cells, downstreamCounts);

	// Pre-compute per-cell upstream/downstream (needed for depth BFS and cell objects)
	const cellUpstreamNames = new Map<string, string[]>();
	const cellDownstreamNames = new Map<string, string[]>();
	for (const c of cells) {
		cellUpstreamNames.set(
			c.id,
			outputNames.filter((n) => n !== c.outputName && nameRegexes.get(n)!.test(c.code))
		);
	}
	for (const c of cells) {
		cellDownstreamNames.set(
			c.id,
			c.outputName
				? outputNames.filter((n) => {
						if (n === c.outputName) return false;
						const dc = cells.find((x) => x.outputName === n);
						return dc ? nameRegexes.get(c.outputName)!.test(dc.code) : false;
					})
				: []
		);
	}

	// #8 — BFS from context cells to compute dependency depth for each cell.
	// depth 0 = context cell, depth 1 = direct dep/dependent, depth 2+ = transitive, undefined = unrelated
	const depthMap = new Map<string, number>();
	if (contextCellIds.length > 0) {
		const bfsQueue: Array<{ id: string; depth: number }> = contextCellIds.map((id) => ({
			id,
			depth: 0
		}));
		const visited = new Set<string>(contextCellIds);
		for (const id of contextCellIds) depthMap.set(id, 0);
		while (bfsQueue.length > 0) {
			const { id, depth } = bfsQueue.shift()!;
			const cell = cells.find((c) => c.id === id);
			if (!cell) continue;
			const neighborNames = [
				...(cellUpstreamNames.get(id) ?? []),
				...(cellDownstreamNames.get(id) ?? [])
			];
			for (const name of neighborNames) {
				const neighbor = cells.find((c) => c.outputName === name);
				if (!neighbor || visited.has(neighbor.id)) continue;
				visited.add(neighbor.id);
				depthMap.set(neighbor.id, depth + 1);
				bfsQueue.push({ id: neighbor.id, depth: depth + 1 });
			}
		}
	}

	return {
		messages: conversationMessages,
		notebookContext: {
			cells: cells.map((c) => {
				const upstream = cellUpstreamNames.get(c.id) ?? [];
				const downstream = cellDownstreamNames.get(c.id) ?? [];

				// #4 — Criticality score: downstream cell count — signals high-impact cells
				const criticalityScore = c.outputName ? (downstreamCounts.get(c.outputName) ?? 0) : 0;

				// #8 — Tiered code truncation by BFS depth from context cells:
				// depth 0 (context) or depth 1 (direct dep): full code
				// depth 2+: 200-char snippet (preserves existing behavior)
				// no path (unrelated): 80-char snippet
				// error cells always get full code — LLM can't fix what it can't see
				const isContext = contextCellIds.includes(c.id);
				const isError = c.status === 'error';
				const depth = depthMap.get(c.id);
				const codeSnippet =
					isContext || isError || depth === 1
						? c.code
						: depth !== undefined
							? c.code.slice(0, 200)
							: c.code.slice(0, 80);

				const errorMessage = isError
					? (c.errors?.[0]?.display ?? c.errors?.[0]?.reason)?.slice(0, 200)
					: undefined;

				// Python cells: dataframe shape already lands in c.result (same as query
				// cells), but stdout/error live separately in pythonOutput.
				const pythonError =
					c.cellType === 'python' ? c.pythonOutput?.error?.slice(0, 200) : undefined;
				const pythonStdout =
					c.cellType === 'python' && isContext ? c.pythonOutput?.stdout?.slice(0, 400) : undefined;

				return {
					id: c.id,
					outputName: c.outputName,
					language: c.language,
					cellType:
						c.cellType === 'python' ? 'python' : c.cellType === 'markdown' ? 'markdown' : 'query',
					code: codeSnippet,
					// Only include result columns for context cells — non-context columns duplicate schema info
					resultColumns: isContext ? (c.result?.columns ?? []) : [],
					status: c.status,
					isActiveNotebook: true,
					...(isContext && { isContextCell: true }),
					...(upstream.length > 0 && { upstream }),
					...(downstream.length > 0 && { downstream }),
					// Include existing chart config for context cells so AI can modify rather than replace
					...(isContext && c.resultChartConfig && { resultChartConfig: c.resultChartConfig }),
					// #4 — Include criticality score so system prompt can flag high-impact cells
					...(criticalityScore > 0 && { criticalityScore }),
					// Pass error message so LLM knows what to fix without calling run_cells first
					...(errorMessage && { errorMessage }),
					...(pythonError && { pythonError }),
					...(pythonStdout && { pythonStdout })
				};
			}),
			connectionSchema: duckdbTables,
			externalConnectionIds,
			externalSchemaFallback,
			activeConnectionId: defaultConn.isBuiltin ? null : (defaultConn.connection.id ?? null),
			connectionDialect: defaultConn.isBuiltin ? 'duckdb' : 'trino',
			pythonAvailable: getPythonAvailable()
		},
		llmConfig: {
			provider: llmConfig.provider,
			baseUrl: llmConfig.baseUrl,
			model: llmConfig.model,
			apiKey: llmConfig.apiKey
		},
		...(workspaceMemory && { workspaceMemory }),
		// Cap session data context to last 20 entries to prevent unbounded payload growth
		...(_sessionDataContext.size > 0 && {
			sessionDataContext: Object.fromEntries([..._sessionDataContext.entries()].slice(-20))
		}),
		// #3 — Modeling decisions recorded this session via record_decision
		...(_sessionPlanContext.length > 0 && { sessionPlanContext: _sessionPlanContext.slice(-15) }),
		...(workspaceContract && { workspaceContract }),
		// #9 — Flag schema changes so the model re-verifies column names
		...(schemaChangeNote && { schemaChangeNote })
	};
}

// ── Read-only inspection tools ────────────────────────────────────────────────

async function executeReadTool(call: AIChatToolCall, aiMsgId: string): Promise<string> {
	const cells = getCells();

	switch (call.tool) {
		case 'get_lineage': {
			const { outputName } = call.args as GetLineageArgs;
			const re = new RegExp(`\\b${escapeRegExp(outputName)}\\b`);

			// Upstream: outputNames referenced in this cell's code
			const target = cells.find((c) => c.outputName === outputName);
			const upstream = target
				? cells
						.filter(
							(c) =>
								c.outputName !== outputName &&
								c.outputName &&
								new RegExp(`\\b${escapeRegExp(c.outputName)}\\b`).test(target.code)
						)
						.map((c) => c.outputName)
				: [];

			// Downstream: cells that reference this outputName
			const downstream = cells
				.filter((c) => c.outputName !== outputName && re.test(c.code))
				.map((c) => c.outputName);

			const result = target
				? `**Lineage: \`${outputName}\`**\n- Upstream: ${upstream.join(', ') || 'none'}\n- Downstream: ${downstream.join(', ') || 'none'}`
				: `**Lineage: \`${outputName}\` not found in notebook**`;
			updateMessageText(aiMsgId, `\n\n${result}\n\n`);
			return result;
		}

		case 'list_cells': {
			const queryCells = cells.filter((c) => c.cellType === 'query' || c.cellType === 'python');
			if (queryCells.length === 0) {
				const text = '**Cells:** (none)';
				updateMessageText(aiMsgId, `\n\n${text}\n\n`);
				return text;
			}
			const summary = queryCells
				.map(
					(c) =>
						`- \`${c.outputName}\` (${c.cellType === 'python' ? 'python' : c.language}, ${c.status}, ${c.result?.rows?.length ?? 0} rows)`
				)
				.join('\n');
			const text = `**Cells:**\n${summary}`;
			updateMessageText(aiMsgId, `\n\n${text}\n\n`);
			return text;
		}

		case 'get_cell_result': {
			const { cellId, limit = 50 } = call.args as GetCellResultArgs;
			const resolvedId = resolveCellId(cellId);
			const cell = getCells().find((c) => c.id === (resolvedId ?? cellId));
			if (!cell?.result?.rows?.length) {
				if (cell?.errors?.length) {
					const errMsg = cell.errors.map((e) => e.display ?? e.reason).join('\n');
					const text = `**Cell \`${cell.outputName ?? cellId}\` — error:**\n\`\`\`\n${errMsg}\n\`\`\`\nFix the SQL with update_cell.`;
					updateMessageText(aiMsgId, `\n\n${text}\n\n`);
					return text;
				}
				if (cell?.status === 'error') {
					const name = cell.outputName ?? cellId;
					const text = `**Cell \`${name}\` is in error state (no details stored).** Call run_cells(['${name}']) to reproduce the error, then fix with update_cell.`;
					updateMessageText(aiMsgId, `\n\n${text}\n\n`);
					return text;
				}
				const text = `**Cell \`${cellId}\`:** no result data — run it first`;
				updateMessageText(aiMsgId, `\n\n${text}\n\n`);
				return text;
			}
			const safeLimit = Math.min(limit, 100);
			const rows = cell.result.rows.slice(0, safeLimit);
			const csv = rowsToCsv(cell.result.columns, rows);
			const preview = toMarkdownTable(cell.result.columns, rows);
			appendActionEvent(aiMsgId, {
				tool: 'get_cell_result',
				label: `Read \`${cell.outputName}\` → ${cell.result.rows.length} rows`,
				preview
			});
			_sessionDataContext.set(
				`result: ${cell.outputName}`,
				`${cell.result.rows.length} rows, cols: ${cell.result.columns.join(', ')}`
			);
			return `get_cell_result(${cell.outputName}): ${cell.result.rows.length} rows, columns: ${cell.result.columns.join(', ')}\n${csv}`;
		}

		case 'search_workspace': {
			const { query } = call.args as SearchWorkspaceArgs;
			try {
				const res = await fetch('/api/ai/search', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query })
				});
				if (!res.ok) throw new Error(`search failed: ${res.status}`);
				const data = (await res.json()) as {
					cells: Array<{ output_name: string; code_snippet: string; similarity: number }>;
					tables: Array<{ table_name: string; column_names: string; similarity: number }>;
				};
				// Include full SQL so AI can inspect and reuse model logic without guessing
				const cellLines = data.cells.map((c) =>
					c.code_snippet?.trim()
						? `\`${c.output_name}\` (${(c.similarity * 100).toFixed(0)}% match):\n\`\`\`sql\n${c.code_snippet.trim()}\n\`\`\``
						: `\`${c.output_name}\` (${(c.similarity * 100).toFixed(0)}% match)`
				);
				const tableLines = data.tables.map((t) => `- \`${t.table_name}\`: ${t.column_names}`);
				const text =
					`**Search: "${query}"**\n` +
					(cellLines.length ? `Relevant cells:\n${cellLines.join('\n\n')}\n` : '') +
					(tableLines.length ? `Relevant tables:\n${tableLines.join('\n')}\n` : '') +
					(!cellLines.length && !tableLines.length ? 'No matches found.\n' : '');
				updateMessageText(aiMsgId, `\n\n${text}\n`);
				return text;
			} catch {
				const text =
					'**Search unavailable** — vector index not set up yet. Use list_cells and get_lineage to discover existing models.';
				updateMessageText(aiMsgId, `\n\n${text}\n\n`);
				return text;
			}
		}

		default:
			return '';
	}
}

// ── Materialization inference ─────────────────────────────────────────────────

function inferMaterializeMode(outputName: string): CellMaterializationMode | null {
	// Check user-defined standards first
	const standards = getWorkspaceStandards();
	for (const rule of standards.namingRules) {
		if (outputName.startsWith(rule.prefix) && VALID_MATERIALIZE_MODES.has(rule.materialization)) {
			return rule.materialization as CellMaterializationMode;
		}
	}
	// Built-in defaults per naming convention
	if (outputName.startsWith('dim_')) return 'table';
	if (outputName.startsWith('fct_')) return 'incremental';
	if (outputName.startsWith('stg_')) return 'view';
	if (outputName.startsWith('metric_')) return 'incremental';
	if (outputName.startsWith('mart_')) return 'table';
	if (outputName.startsWith('rpt_')) return 'view';
	if (outputName.startsWith('int_')) return 'view';
	return null;
}

// ── Tool call executor ────────────────────────────────────────────────────────

async function executeToolCallWithResult(
	call: AIChatToolCall,
	aiMsgId: string
): Promise<string | null> {
	const allowed = await authorizeAITool(call.tool);
	if (!allowed) {
		emitAgentTelemetry({
			type: 'tool',
			tool: call.tool,
			metadata: { denied: true }
		});
		return `${call.tool}: permission denied — your role cannot run this AI tool`;
	}

	emitAgentTelemetry({ type: 'tool', tool: call.tool });

	// Read-only inspection tools — inject result as text, also return for LLM re-injection
	if (
		call.tool === 'get_lineage' ||
		call.tool === 'list_cells' ||
		call.tool === 'search_workspace' ||
		call.tool === 'get_cell_result'
	) {
		return executeReadTool(call, aiMsgId);
	}

	// All remaining tools mutate the notebook (record_decision/validate_result/compare_cells are read-only)
	if (
		call.tool !== 'record_decision' &&
		call.tool !== 'validate_result' &&
		call.tool !== 'compare_cells'
	)
		_madeNotebookChanges = true;

	switch (call.tool) {
		case 'create_cell': {
			const args = call.args as CreateCellArgs;
			// Ensure outputName is never null/undefined
			const outputName = args.outputName ?? `ai_cell_${Date.now()}`;
			const cells = getCells();
			const anchor = args.afterCellId ?? (cells.length > 0 ? cells[cells.length - 1].id : '');

			if (args.cellType === 'python') {
				if (!getPythonAvailable()) {
					return 'create_cell: Python is not available in this environment — use a SQL cell instead.';
				}
				const existingId = resolveCellId(outputName);
				if (existingId) {
					updatePythonCellCode(existingId, args.code ?? '');
					_updatedCellIds.add(existingId);
					_outputNameToId.set(outputName, existingId);
					if (call.callId) _callIdToId.set(call.callId, existingId);
					appendActionEvent(aiMsgId, {
						tool: 'update_cell',
						label: `Edited cell \`${outputName}\``,
						cellId: existingId
					});
					return `Cell '${outputName}' updated (create_cell redirected — cell already exists)`;
				}
				const pyCellId = anchor ? insertPythonCellAfter(anchor) : addPythonCell();
				if (!pyCellId) return 'create_cell: failed to create Python cell';
				updatePythonCellCode(pyCellId, args.code ?? '');
				const renameResult = updateCellName(pyCellId, outputName);
				if (!renameResult.ok) return `create_cell: ${renameResult.error}`;
				markGhostCell(pyCellId);
				appendActionEvent(aiMsgId, {
					tool: 'create_cell',
					label: `Created Python cell \`${outputName}\``,
					cellId: pyCellId
				});
				_outputNameToId.set(outputName, pyCellId);
				if (call.callId) _callIdToId.set(call.callId, pyCellId);
				return `Cell '${outputName}' created (id: ${pyCellId}, type: python)`;
			}

			let newCellId: string;
			// Detect markdown: explicit cellType, explicit markdown field, or model accidentally
			// put markdown prose (# headings, **bold**) in the code field instead of markdown field.
			const codeIsMarkdown =
				typeof args.code === 'string' &&
				/^[ \t]*(#{1,3} |\*\*|>|---)/m.test(args.code.slice(0, 400)) &&
				!/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|DROP|EXPLAIN)\b/i.test(
					args.code.trimStart()
				);
			const isMarkdown =
				args.cellType === 'markdown' || args.markdown !== undefined || codeIsMarkdown;
			// When markdown content landed in the code field, use it as the markdown body
			const markdownContent = args.markdown ?? (codeIsMarkdown ? (args.code ?? '') : '');

			// Redirect duplicate SQL cell creates to update_cell. Models sometimes call
			// create_cell when self-correcting an error instead of calling update_cell,
			// which produces a second cell with the same outputName.
			if (!isMarkdown) {
				const existingId = resolveCellId(outputName);
				if (existingId) {
					const oldCode = getCells().find((c) => c.id === existingId)?.code;
					if (args.code !== undefined)
						updateCellCode(existingId, sanitizeSQL(stripTrailingSemicolons(args.code ?? '')));
					_updatedCellIds.add(existingId);
					_outputNameToId.set(outputName, existingId);
					if (call.callId) _callIdToId.set(call.callId, existingId);
					const newCode =
						args.code !== undefined ? sanitizeSQL(stripTrailingSemicolons(args.code)) : undefined;
					appendActionEvent(aiMsgId, {
						tool: 'update_cell',
						label: `Edited cell \`${outputName}\``,
						cellId: existingId,
						...(oldCode !== undefined && newCode !== undefined && { oldCode, newCode })
					});
					const colWarning = validateColumnRefs(
						newCode ?? oldCode ?? '',
						getExternalSchemaTables(),
						getTables()
					);
					return `Cell '${outputName}' updated (create_cell redirected — cell already exists)${colWarning ? `\n\n⚠ Column hint: ${colWarning}` : ''}`;
				}
			}

			// Redirect duplicate markdown cell creates (e.g. findings cell created twice after stall nudges).
			if (isMarkdown) {
				const existingMarkdownId = resolveCellId(outputName);
				if (existingMarkdownId) {
					const newMarkdown = markdownContent || args.code || '';
					if (newMarkdown) updateCellMarkdown(existingMarkdownId, newMarkdown);
					_outputNameToId.set(outputName, existingMarkdownId);
					if (call.callId) _callIdToId.set(call.callId, existingMarkdownId);
					appendActionEvent(aiMsgId, {
						tool: 'update_cell',
						label: `Edited cell \`${outputName}\``,
						cellId: existingMarkdownId
					});
					const redirectLintHint = newMarkdown
						? detectHardcodedContent(newMarkdown, getAllCellsAcrossNotebooks())
						: null;
					return `Cell '${outputName}' updated (create_cell redirected — markdown cell already exists)${redirectLintHint ? `\n\n⚠ Live-ref hint: ${redirectLintHint}` : ''}`;
				}
			}

			if (isMarkdown) {
				newCellId = appendCellAtEnd({
					outputName,
					code: '',
					language: 'sql',
					editMode: 'prql',
					guiStages: [],
					markdown: markdownContent
				});
			} else if (anchor) {
				newCellId = insertCellAfter(anchor, {
					outputName,
					code: sanitizeSQL(stripTrailingSemicolons(args.code ?? '')),
					language: args.language ?? 'sql',
					editMode: args.editMode ?? 'prql',
					guiStages: []
				});
			} else {
				newCellId = appendCellAtEnd({
					outputName,
					code: sanitizeSQL(stripTrailingSemicolons(args.code ?? '')),
					language: args.language ?? 'sql',
					editMode: args.editMode ?? 'prql',
					guiStages: []
				});
			}

			if (newCellId) {
				markGhostCell(newCellId);
				// Put markdown cells directly into preview so they render immediately
				if (isMarkdown) setCellMarkdownPreview(newCellId, true);

				// Apply materializeMode: from AI args, then infer from prefix, then leave default
				if (!isMarkdown && args.materializeMode) {
					if (VALID_MATERIALIZE_MODES.has(args.materializeMode)) {
						setCellMaterializeMode(newCellId, args.materializeMode as CellMaterializationMode);
					}
				} else if (!isMarkdown) {
					const inferredMode = inferMaterializeMode(outputName);
					if (inferredMode) setCellMaterializeMode(newCellId, inferredMode);
				}

				appendActionEvent(aiMsgId, {
					tool: 'create_cell',
					label: `Created ${isMarkdown ? 'markdown' : 'SQL'} cell \`${outputName}\``,
					cellId: newCellId
				});
				// Map outputName AND callId → newCellId for downstream references in this generation
				_outputNameToId.set(outputName, newCellId);
				if (call.callId) _callIdToId.set(call.callId, newCellId);
				// Lightweight column validation for query cells
				const createColWarning =
					!isMarkdown && args.code
						? validateColumnRefs(args.code, getExternalSchemaTables(), getTables())
						: null;
				const createLintHint = isMarkdown
					? detectHardcodedContent(markdownContent, getAllCellsAcrossNotebooks())
					: null;
				return `Cell '${outputName}' created (id: ${newCellId}, type: ${isMarkdown ? 'markdown' : 'query'})${createColWarning ? `\n\n⚠ Column hint: ${createColWarning}` : ''}${createLintHint ? `\n\n⚠ Live-ref hint: ${createLintHint}` : ''}`;
			}
			return null;
		}

		case 'update_cell': {
			const args = call.args as UpdateCellArgs;
			// Resolve cellId: may be an outputName or actual id
			const cellId = resolveCellId(args.cellId);
			if (!cellId) return `update_cell: cell '${args.cellId}' not found`;

			// Capture old name/code for diff preview and rename tracking before mutating
			const cellBeforeUpdate = getCells().find((c) => c.id === cellId);
			const oldCode = cellBeforeUpdate?.code;
			const oldName = cellBeforeUpdate?.outputName;
			if (args.code !== undefined) {
				// Route by the target's actual cellType — sanitizeSQL/stripTrailingSemicolons
				// are SQL-specific and would corrupt Python source.
				if (cellBeforeUpdate?.cellType === 'python') {
					updatePythonCellCode(cellId, args.code);
				} else {
					updateCellCode(cellId, sanitizeSQL(stripTrailingSemicolons(args.code)));
				}
			}
			if (args.markdown !== undefined) updateCellMarkdown(cellId, args.markdown);
			if (args.outputName !== undefined) {
				const renameResult = updateCellName(cellId, args.outputName);
				if (!renameResult.ok) return `update_cell: ${renameResult.error}`;
				// Keep _outputNameToId in sync with renames so stall-recovery nudges
				// and duplicate-create checks reference the correct (new) cell name.
				if (oldName && oldName !== args.outputName) _outputNameToId.delete(oldName);
				_outputNameToId.set(args.outputName, cellId);
			}
			_updatedCellIds.add(cellId);
			const newCode = args.code !== undefined ? stripTrailingSemicolons(args.code) : undefined;
			const updateLintHint =
				args.markdown !== undefined
					? detectHardcodedContent(args.markdown, getAllCellsAcrossNotebooks())
					: null;
			appendActionEvent(aiMsgId, {
				tool: 'update_cell',
				label: `Edited cell \`${args.outputName ?? args.cellId}\``,
				cellId,
				...(oldCode !== undefined && newCode !== undefined && { oldCode, newCode })
			});
			// Lightweight column validation warning
			const colWarning =
				args.code !== undefined
					? validateColumnRefs(newCode ?? oldCode ?? '', getExternalSchemaTables(), getTables())
					: null;
			return `Cell '${args.outputName ?? args.cellId}' updated${colWarning ? `\n\n⚠ Column hint: ${colWarning}` : ''}${updateLintHint ? `\n\n⚠ Live-ref hint: ${updateLintHint}` : ''}`;
		}

		case 'set_chart': {
			const args = call.args as SetChartArgs;
			const cellId = resolveCellId(args.cellId);
			if (!cellId) return `set_chart: cell '${args.cellId}' not found`;

			setCellResultChartConfig(cellId, args.chartConfig);
			setCellResultViewMode(cellId, 'chart');
			_chartedCellIds.add(cellId);
			appendActionEvent(aiMsgId, {
				tool: 'set_chart',
				label: `Chart configured for \`${args.cellId}\``,
				cellId
			});
			return `Chart configured for '${args.cellId}' (${args.chartConfig.chartType})`;
		}

		case 'pick_chart': {
			const { cellId: ref } = call.args as PickChartArgs;
			const cellId = resolveCellId(ref);
			if (!cellId) return `pick_chart: cell '${ref}' not found`;
			const cell = getCells().find((c) => c.id === cellId);
			if (!cell?.result?.columns?.length) {
				return `pick_chart: no results yet for '${ref}' — call run_cells first`;
			}
			const chart = inferChartFromColumns(cell.result.columns, cell.result.rows ?? []);
			if (!chart) {
				setCellResultViewMode(cellId, 'table');
				_chartedCellIds.add(cellId);
				appendActionEvent(aiMsgId, {
					tool: 'pick_chart',
					label: `Table view set for \`${ref}\` (no numeric columns)`,
					cellId
				});
				return `pick_chart: table view set for '${ref}' — no numeric columns detected, showing result table`;
			}
			setCellResultChartConfig(cellId, chart);
			setCellResultViewMode(cellId, 'chart');
			_chartedCellIds.add(cellId);
			appendActionEvent(aiMsgId, {
				tool: 'pick_chart',
				label: `Auto-charted \`${ref}\` → ${chart.chartType}`,
				cellId
			});
			return `pick_chart: applied ${chart.chartType} chart to '${ref}' (x=${chart.xColumn}, y=[${chart.yColumns.join(', ')}])`;
		}

		case 'set_view_mode': {
			const args = call.args as SetViewModeArgs;
			const cellId = resolveCellId(args.cellId);
			if (!cellId) return null;
			setCellResultViewMode(cellId, args.mode);
			return `View mode set to '${args.mode}' for '${args.cellId}'`;
		}

		case 'delete_cell': {
			const args = call.args as DeleteCellArgs;
			const cellId = resolveCellId(args.cellId);
			if (!cellId) return `delete_cell: cell '${args.cellId}' not found`;
			unmarkGhostCell(cellId);
			removeCell(cellId);
			appendActionEvent(aiMsgId, { tool: 'delete_cell', label: `Deleted cell \`${args.cellId}\`` });
			return `Cell '${args.cellId}' deleted`;
		}

		case 'move_cell': {
			const args = call.args as MoveCellArgs;
			const cellId = resolveCellId(args.cellId);
			if (!cellId) return `move_cell: cell '${args.cellId}' not found`;
			if (args.toIndex !== undefined) {
				reorderCell(cellId, args.toIndex);
				appendActionEvent(aiMsgId, {
					tool: 'move_cell',
					label: `Moved \`${args.cellId}\` to position ${args.toIndex}`,
					cellId
				});
				return `Cell '${args.cellId}' moved to index ${args.toIndex}`;
			} else if (args.direction) {
				moveCell(cellId, args.direction);
				appendActionEvent(aiMsgId, {
					tool: 'move_cell',
					label: `Moved \`${args.cellId}\` ${args.direction}`,
					cellId
				});
				return `Cell '${args.cellId}' moved ${args.direction}`;
			}
			return `move_cell: specify direction ('up'|'down') or toIndex`;
		}

		case 'record_decision': {
			// #3 — Planning memory: store a modeling decision so it persists across turns
			const { decision, type } = call.args as RecordDecisionArgs;
			if (decision?.trim()) {
				const text = decision.trim();
				_sessionPlanContext.push(text);
				appendActionEvent(aiMsgId, {
					tool: 'record_decision',
					label: `Noted: ${text.slice(0, 80)}`
				});
				// Mirror to disk when a project is open — survives across sessions/machines
				// instead of only the 24h-TTL localStorage cap. Best-effort: never blocks the
				// turn or rolls back the in-memory state above on a disk failure.
				const folder = getProjectFolder();
				if (folder && getIsDbtProject()) {
					recordAIMemoryEntry(folder, type === 'discovery' ? 'discovery' : 'decision', text).catch(
						(err) => console.error('[ai-memory] failed to persist decision:', err)
					);
				}
				return `Decision recorded: "${text}"`;
			}
			return 'record_decision: decision text is required';
		}

		case 'run_cells': {
			const args = call.args as RunCellsArgs;
			// cellIds may be undefined/empty — fall back to all ghost cells created this generation
			const rawIds: string[] = args.cellIds?.length ? args.cellIds : [..._outputNameToId.values()];
			const resolvedIds = rawIds
				.map((id: string) => resolveCellId(id))
				.filter((id: string | null): id is string => !!id);
			if (resolvedIds.length === 0) return 'run_cells: no cells to run';

			appendActionEvent(aiMsgId, {
				tool: 'run_cells',
				label: `Running ${resolvedIds.length} cell${resolvedIds.length > 1 ? 's' : ''}…`
			});

			// Build dependency graph among the requested cells so independent cells
			// run in parallel and dependent cells wait for their upstream.
			const allCellsList = getCells();
			const resolvedSet = new Set(resolvedIds);
			const cellDepsMap = new Map<string, Set<string>>();
			for (const cellId of resolvedIds) {
				cellDepsMap.set(cellId, new Set());
				const cell = allCellsList.find((c) => c.id === cellId);
				if (!cell) continue;
				const idx = allCellsList.indexOf(cell);
				if (idx < 0) continue;
				for (const dep of resolveDependencies(allCellsList, idx)) {
					if (resolvedSet.has(dep.id)) cellDepsMap.get(cellId)!.add(dep.id);
				}
			}

			// Kahn's algorithm: group into layers where all cells in a layer
			// have no unprocessed deps — cells within a layer run in parallel.
			const layers: string[][] = [];
			const remaining = new Set(resolvedIds);
			while (remaining.size > 0) {
				const layer = [...remaining].filter((id) => {
					const d = cellDepsMap.get(id);
					return !d || [...d].every((depId) => !remaining.has(depId));
				});
				if (layer.length === 0) {
					layers.push([...remaining]);
					break;
				} // cycle guard
				layers.push(layer);
				for (const id of layer) remaining.delete(id);
			}

			// Execute: run each layer in parallel, wait for ACTUAL completion, then next layer.
			// runCell is async and resolves only after the cell finishes (status set to
			// success/error). We must await it — the old fire-and-forget + 8s deadline poll
			// resolved early on a cold DuckDB-WASM start (first run of a session) while the
			// cell was still 'running', so the result builder below reported it as "success".
			// The model then emitted <done>, the loop broke, and the cell errored afterwards →
			// "Couldn't fix all SQL errors" while the AI never saw the error to fix it.
			const runLayer = (layer: string[]): Promise<void> =>
				Promise.all(
					layer.map((id) => {
						_alreadyRanIds.add(id);
						const targetCell = allCellsList.find((c) => c.id === id);
						const run = targetCell?.cellType === 'python' ? runPythonCell(id) : runCell(id);
						return run.catch(() => {
							/* error surfaced via cell.status below */
						});
					})
				).then(() => undefined);

			for (const layer of layers) await runLayer(layer);

			// Auto-heal: if a failed cell's SQL still has unquoted spaced columns or backticks
			// (i.e., sanitizeSQL would change it), silently update + re-run before reporting errors.
			// This handles pre-existing cells or edge cases that bypassed the create/update hooks.
			const failedAfterRun = resolvedIds.filter((id) => {
				const c = getCells().find((x) => x.id === id);
				return c && c.status === 'error';
			});
			if (failedAfterRun.length > 0) {
				const toHeal = failedAfterRun.filter((id) => {
					const cell = getCells().find((c) => c.id === id);
					if (!cell || cell.cellType === 'python') return false;
					const fixed = sanitizeSQL(cell.code);
					if (fixed === cell.code) return false;
					updateCellCode(id, fixed);
					// Do NOT add to _updatedCellIds — auto-heal is silent preprocessing,
					// not an AI fix attempt. Adding it caused "Couldn't fix" to appear
					// even when the LLM never called update_cell.
					return true;
				});
				if (toHeal.length > 0) await runLayer(toHeal);
			}

			// #2 — cap result previews to 3 cells to avoid bloating the prompt
			let previewCount = 0;
			const resultLines = resolvedIds.map((id) => {
				const cell = getCells().find((c) => c.id === id);
				if (!cell) return `${id}: not found`;
				if (cell.status === 'error' && cell.cellType === 'python') {
					// Python errors are tracebacks, not SQL — skip the column/table/syntax
					// categorization below, which doesn't apply.
					const pyErrMsg = cell.pythonOutput?.error ?? 'unknown error';
					return `${cell.outputName ?? id}: RUN FAILED — ${pyErrMsg}`;
				}
				if (cell.status === 'error') {
					const errMsg = cell.errors?.[0]?.display ?? cell.errors?.[0]?.reason ?? 'unknown error';

					// Compact SQL excerpt: enough context for the model to spot the bad pattern
					// without the token cost of the full query. Line-targeted when error has a line number.
					const sqlSnippet = extractSQLSnippet(cell.code, errMsg);
					const snippetLine = `\nFailing SQL (excerpt):\n${sqlSnippet}`;

					// Categorize error so we can give targeted hints rather than generic schema dump
					const errCategory =
						/column.*not found|referenced column|cannot be resolved|no such column|unknown column/i.test(
							errMsg
						)
							? 'column'
							: /type.*mismatch|conversion error|cannot cast|incompatible type|TYPE_MISMATCH/i.test(
										errMsg
								  )
								? 'type'
								: /syntax error|parse error|mismatched input|unexpected token/i.test(errMsg)
									? 'syntax'
									: /table.*not found|no such table|does not exist|schema.*not found/i.test(errMsg)
										? 'table'
										: 'other';

					// Build enriched schema list with column types and cache key for profile lookup
					const allSchema = [
						...getTables().map((t) => ({
							name: t.name,
							columns: t.columns,
							columnTypes: t.columnTypes ?? ([] as string[]),
							cacheKey: t.name
						})),
						...getExternalSchemaTables().map((t) => ({
							name: t.schema ? `${t.schema}.${t.name}` : t.name,
							columns: t.columns,
							columnTypes: t.columnTypes ?? ([] as string[]),
							cacheKey: t.schema ? `${t.schema}.${t.name}` : t.name
						}))
					];

					// Include schema for the referenced tables so the model knows the correct
					// column names — but NOT the failing SQL, which the model already knows
					// from its own prior messages and whose presence causes it to misread the
					// error result as "SQL snippet output" rather than a run failure.
					const referencedTables = allSchema
						.filter((t) => new RegExp(`\\b${escapeRegExp(t.name)}\\b`, 'i').test(cell.code))
						.slice(0, 3);

					const referencedSchema = referencedTables
						.map((t) => {
							// col:TYPE annotations — short type codes so the model can spot type mismatches
							const cols = t.columns
								.slice(0, 15)
								.map((col, i) => {
									const raw = t.columnTypes[i] ?? '';
									const shortType = raw.match(/INT|FLOAT|DOUBLE|DECIMAL|NUMERIC|REAL/i)
										? 'NUM'
										: raw.match(/DATE|TIME/i)
											? 'DATE'
											: raw.match(/BOOL/i)
												? 'BOOL'
												: raw
													? 'TEXT'
													: '';
									const quoted = col.includes(' ') ? `"${col}"` : col;
									return shortType ? `${quoted}:${shortType}` : quoted;
								})
								.join(', ');
							// Preflight profiles: top values for text columns — helps fix value mismatches
							const profile = _preflightCache.get(t.cacheKey);
							const profileLine =
								profile && Object.keys(profile.columnProfiles).length > 0
									? '\n    values: ' +
										Object.entries(profile.columnProfiles)
											.map(([col, vals]) => `${col}=[${vals}]`)
											.join(', ')
									: '';
							return `  ${t.name}(${cols})${profileLine}`;
						})
						.join('\n');

					const schemaLine = referencedSchema ? `\nAvailable columns:\n${referencedSchema}` : '';

					// Category-specific targeted hint
					let categoryHint = '';
					if (errCategory === 'table') {
						const tableList = allSchema
							.map((t) => t.name)
							.slice(0, 20)
							.join(', ');
						categoryHint = `\n⚠ Table not found. Available tables: ${tableList}`;
					} else if (errCategory === 'syntax') {
						const { isBuiltin } = getDefaultConnection();
						const dialectName = isBuiltin ? 'DuckDB' : 'Trino';
						categoryHint = `\n⚠ ${dialectName} syntax reminder: no trailing semicolons, no backtick identifiers (use double-quotes), no WITH clauses (cell outputNames auto-wrap as CTEs)`;
					} else if (errCategory === 'column') {
						// Extract the failing column name and suggest the closest real column
						const failingColMatch =
							errMsg.match(
								/column ['""`]?(\w+)['""`]? (?:not found|referenced|cannot be resolved)/i
							) ??
							errMsg.match(/no such column[:\s]+['""`]?(\w+)/i) ??
							errMsg.match(/Unknown column '(\w+)'/i);
						const failingCol = failingColMatch?.[1];
						if (failingCol) {
							const closest = findClosestColumn(failingCol, allSchema);
							if (closest) {
								categoryHint = `\n⚠ Column "${failingCol}" not found. Did you mean "${closest.column}" from ${closest.table}?`;
							}
						}
					}

					// Detect unquoted spaced column names in the failing SQL and give a direct fix hint
					const allSpacedCols = [
						...getTables().flatMap((t) => t.columns ?? []),
						...getExternalSchemaTables().flatMap((t) => t.columns)
					].filter((col) => col.includes(' '));
					const unquotedInCode = allSpacedCols.filter(
						(col) => cell.code.includes(col) && !cell.code.includes(`"${col}"`)
					);
					const quotingHint =
						unquotedInCode.length > 0
							? `\n⚠ Fix: column names with spaces must be double-quoted: ${unquotedInCode.map((c) => `"${c}" not ${c}`).join('; ')}`
							: '';

					return `${cell.outputName ?? id}: RUN FAILED — ${errMsg}${snippetLine}${schemaLine}${categoryHint}${quotingHint}`;
				}
				// Defensive: never report a non-terminal status (running/idle) as success — that
				// would let the model emit <done> over a cell that never actually completed.
				if (cell.status !== 'success') {
					return `${cell.outputName ?? id}: RUN FAILED — cell did not finish running (status: ${cell.status}). Call run_cells again to verify it succeeds.`;
				}
				const rows = cell.result?.rows?.length ?? 0;
				const cols = cell.result?.columns?.join(', ') ?? 'none';
				// Auto-chart or correct the chart type using actual result data
				if (cell.result?.columns?.length) {
					const inferredChart = inferChartFromColumns(cell.result.columns, cell.result.rows ?? []);
					if (inferredChart) {
						const currentType = cell.resultChartConfig?.chartType;
						const isKpiResult = inferredChart.chartType === 'big-value';
						const wrongType =
							currentType &&
							currentType !== 'big-value' &&
							currentType !== 'value' &&
							currentType !== 'delta';
						if (!_chartedCellIds.has(id) || (isKpiResult && wrongType)) {
							setCellResultChartConfig(id, inferredChart);
							setCellResultViewMode(id, 'chart');
							_chartedCellIds.add(id);
						}
					}
				}
				// #2 — Output snapshot: include top-5-row preview for the first 3 successful cells
				let previewLines = '';
				if (previewCount < 3 && rows > 0 && cell.result?.columns?.length) {
					previewCount++;
					previewLines =
						'\nPreview:\n' +
						toMarkdownTable(cell.result.columns, (cell.result.rows ?? []).slice(0, 5));
				}
				return `${cell.outputName ?? id}: success (${rows} rows, columns: ${cols})${previewLines}`;
			});

			// Update the "Running…" action event chip to show the outcome
			const hasError = resultLines.some((l) => l.includes('ERROR'));
			const resultLabel =
				resolvedIds.length === 1
					? resultLines[0]
					: `${resolvedIds.length} cells — ${hasError ? 'errors' : 'all succeeded'}`;
			updateLastActionEvent(aiMsgId, {
				label: resultLabel,
				...(resolvedIds.length > 1 && { preview: resultLines.join('\n') })
			});

			return `run_cells result:\n${resultLines.join('\n')}`;
		}

		case 'validate_result': {
			const { cellId, expectedRowCount, minRowCount, expectedColumns, assertNotEmpty } =
				call.args as import('$lib/types/ai-chat.js').ValidateResultArgs;
			const id = resolveCellId(cellId);
			const cell = id ? getCells().find((c) => c.id === id) : null;
			if (!cell) return `validate_result: cell "${cellId}" not found`;
			if (!cell.result)
				return `validate_result(${cell.outputName}): no result — call run_cells first`;
			const rows = cell.result.rows?.length ?? 0;
			const cols = cell.result.columns ?? [];
			const checks: string[] = [];
			if (assertNotEmpty && rows === 0) checks.push('FAIL: result is empty (0 rows)');
			if (expectedRowCount !== undefined && rows !== expectedRowCount)
				checks.push(`FAIL: expected ${expectedRowCount} rows, got ${rows}`);
			if (minRowCount !== undefined && rows < minRowCount)
				checks.push(`FAIL: expected ≥${minRowCount} rows, got ${rows}`);
			if (expectedColumns?.length) {
				const missing = expectedColumns.filter((c) => !cols.includes(c));
				if (missing.length) checks.push(`FAIL: missing columns: ${missing.join(', ')}`);
			}
			const verdict = checks.length === 0 ? 'PASS: all checks passed' : checks.join('\n');
			appendActionEvent(aiMsgId, {
				tool: 'get_cell_result',
				label: `Validated ${cell.outputName}: ${checks.length === 0 ? 'PASS' : 'FAIL'}`
			});
			return `validate_result(${cell.outputName}): ${verdict}`;
		}

		case 'compare_cells': {
			const { cellId1, cellId2 } = call.args as import('$lib/types/ai-chat.js').CompareCellsArgs;
			const id1 = resolveCellId(cellId1);
			const id2 = resolveCellId(cellId2);
			const c1 = id1 ? getCells().find((c) => c.id === id1) : null;
			const c2 = id2 ? getCells().find((c) => c.id === id2) : null;
			if (!c1 || !c2)
				return `compare_cells: cell(s) not found (${!c1 ? cellId1 : ''} ${!c2 ? cellId2 : ''})`.trim();
			if (!c1.result || !c2.result)
				return `compare_cells: both cells must have results — call run_cells first`;
			const cols1 = new Set(c1.result.columns ?? []);
			const cols2 = new Set(c2.result.columns ?? []);
			const onlyIn1 = [...cols1].filter((c) => !cols2.has(c));
			const onlyIn2 = [...cols2].filter((c) => !cols1.has(c));
			const rows1 = c1.result.rows?.length ?? 0;
			const rows2 = c2.result.rows?.length ?? 0;
			const rowDiff = rows1 - rows2;
			const lines = [
				`${c1.outputName}: ${rows1} rows, cols: [${[...cols1].join(', ')}]`,
				`${c2.outputName}: ${rows2} rows, cols: [${[...cols2].join(', ')}]`,
				onlyIn1.length ? `Only in ${c1.outputName}: ${onlyIn1.join(', ')}` : null,
				onlyIn2.length ? `Only in ${c2.outputName}: ${onlyIn2.join(', ')}` : null,
				rowDiff !== 0 ? `Row diff: ${rowDiff > 0 ? '+' : ''}${rowDiff}` : 'Row counts match'
			]
				.filter(Boolean)
				.join('\n');
			appendActionEvent(aiMsgId, {
				tool: 'get_cell_result',
				label: `Compared ${c1.outputName} vs ${c2.outputName}`
			});
			return `compare_cells:\n${lines}`;
		}

		default:
			return null;
	}
}

// Maps outputName → cellId for cells created during the current generation
let _outputNameToId = new Map<string, string>();
// Maps callId → cellId so models can reference newly-created cells by their creation callId
let _callIdToId = new Map<string, string>();
// Track cells explicitly run via run_cells so we don't double-run them
let _alreadyRanIds = new Set<string>();
// Track cells that already have a chart configured this generation
let _chartedCellIds = new Set<string>();
// Track cells updated (not created) this generation so they also get auto-charted
let _updatedCellIds = new Set<string>();
// True if any notebook-mutating tool call was executed this generation
let _madeNotebookChanges = false;

type InferredChartConfig = {
	chartType: 'bar' | 'bar-horizontal' | 'line' | 'area' | 'pie' | 'big-value';
	xColumn: string;
	yColumns: string[];
	colorColumn: null;
	seriesMode?: 'grouped';
};

// Patterns that indicate a date/time column name
const TIME_RE = /month|week|day|date|year|quarter|period|time|hour|minute|created|updated|ts$/i;
// Patterns indicating a likely numeric measure column by name
const MEASURE_NAME_RE =
	/count|sum|total|avg|average|amount|revenue|cost|price|qty|quantity|sales|orders|rate|pct|percent|score|value|n$|\d$/i;

/**
 * Infer a chart config from actual result column names and row data.
 * More reliable than SQL parsing since it uses the real output schema.
 */
function inferChartFromColumns(columns: string[], rows: unknown[]): InferredChartConfig | null {
	if (columns.length === 0) return null;

	// Single row with multiple columns → KPI / big-value
	if (rows.length === 1 && columns.length >= 1) {
		return {
			chartType: 'big-value',
			xColumn: columns[0],
			yColumns: columns.slice(1),
			colorColumn: null
		};
	}

	if (columns.length === 1) return null; // need at least x + y

	const dims = columns.filter((c) => !MEASURE_NAME_RE.test(c));
	const measures = columns.filter((c) => MEASURE_NAME_RE.test(c));

	// All look like measures → KPI
	if (dims.length === 0) {
		return {
			chartType: 'big-value',
			xColumn: columns[0],
			yColumns: columns.slice(1),
			colorColumn: null
		};
	}

	const xCol = dims[0];
	const yCols = measures.length > 0 ? measures : columns.filter((c) => c !== xCol);

	if (yCols.length === 0) return null;

	// When no measure-named columns were found, verify the candidate y-cols actually contain
	// numbers — avoids creating a bar chart for all-string results (e.g. raw entity tables).
	if (measures.length === 0) {
		const typedRows = rows as Record<string, unknown>[];
		const hasNumeric = yCols.some((col) =>
			typedRows.slice(0, 5).some((row) => typeof row[col] === 'number')
		);
		if (!hasNumeric) return null;
	}

	const isTime = TIME_RE.test(xCol.toLowerCase());
	if (isTime) {
		const isArea = yCols.some((y) => /cumul|total|running|revenue|amount|sales/i.test(y));
		return {
			chartType: isArea ? 'area' : 'line',
			xColumn: xCol,
			yColumns: yCols,
			colorColumn: null
		};
	}

	return {
		chartType: 'bar',
		xColumn: xCol,
		yColumns: yCols,
		colorColumn: null,
		...(yCols.length > 1 && { seriesMode: 'grouped' as const })
	};
}

function resolveCellId(ref: string): string | null {
	// Try direct id match
	const cells = getCells();
	const byId = cells.find((c) => c.id === ref);
	if (byId) return byId.id;

	// Try outputName match (AI may reference by name)
	const byName = cells.find((c) => c.outputName === ref);
	if (byName) return byName.id;

	// Try outputName map from this generation
	const byOutputName = _outputNameToId.get(ref);
	if (byOutputName) return byOutputName;

	// Try callId map — some models reference a created cell by its creation callId
	return _callIdToId.get(ref) ?? null;
}

const ACTIVITY_LABELS: Record<string, string> = {
	create_cell: 'Creating cell…',
	update_cell: 'Editing cell…',
	set_chart: 'Configuring chart…',
	pick_chart: 'Auto-charting…',
	set_view_mode: 'Switching view…',
	delete_cell: 'Deleting cell…',
	run_cells: 'Running cells…',
	move_cell: 'Reordering cells…',
	get_lineage: 'Checking lineage…',
	list_cells: 'Listing cells…',
	search_workspace: 'Searching workspace…',
	get_cell_result: 'Reading cell result…',
	query_data: 'Querying data…',
	sample_data: 'Sampling data…',
	profile_column: 'Profiling column…',
	record_decision: 'Recording decision…',
	validate_result: 'Validating result…',
	compare_cells: 'Comparing cells…'
};

function activityLabelForTool(tool: string): string {
	return ACTIVITY_LABELS[tool] ?? 'Working…';
}

// ── Streaming helper ──────────────────────────────────────────────────────────

async function streamOneTurn(
	reqBody: AIChatRequest,
	aiMsgId: string,
	signal: AbortSignal
): Promise<{
	allToolResults: string[];
	aborted: boolean;
	signalledDone: boolean;
	hadDataToolCalls: boolean;
	wasTruncated: boolean;
	streamError: boolean;
	planProposal?: NonNullable<Parameters<typeof requestPlanApproval>[0]>;
	sprintTasks?: SprintTask[];
	sprintUpdate?: SprintTask[];
}> {
	const allToolResults: string[] = [];
	let hadDataToolCalls = false;
	let signalledDone = false;
	let wasTruncated = false;
	let planProposal: NonNullable<Parameters<typeof requestPlanApproval>[0]> | undefined;
	let sprintTasks: SprintTask[] | undefined;
	let sprintUpdate: SprintTask[] | undefined;
	const isAbort = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError';

	let response: Response;
	try {
		response = await fetch('/api/ai/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(reqBody),
			signal
		});
	} catch (err) {
		// Network failure before any bytes — abort is a clean stop; anything else is retryable.
		return {
			allToolResults,
			aborted: isAbort(err),
			signalledDone: false,
			hadDataToolCalls: false,
			wasTruncated: false,
			streamError: !isAbort(err),
			planProposal
		};
	}

	if (!response.ok) {
		const errText = await response.text().catch(() => '');
		appendErrorMessage(
			`The AI request failed (${response.status}). ${errText.slice(0, 200)}`.trim()
		);
		return {
			allToolResults,
			aborted: true,
			signalledDone: false,
			hadDataToolCalls: false,
			wasTruncated: false,
			streamError: false,
			planProposal
		};
	}

	if (!response.body) {
		appendErrorMessage('The AI response could not be read (non-streaming response).');
		return {
			allToolResults,
			aborted: true,
			signalledDone: false,
			hadDataToolCalls: false,
			wasTruncated: false,
			streamError: false,
			planProposal
		};
	}
	const reader = response.body.getReader();
	const dec = new TextDecoder();

	// Dispatch one parsed SSE event.
	const dispatchEvent = async (event: SSEEvent): Promise<void> => {
		switch (event.type) {
			case 'text_delta':
				if (typeof event.delta === 'string') updateMessageText(aiMsgId, event.delta);
				break;
			case 'tool_call': {
				const toolCall = event.call as AIChatToolCall;
				setCurrentActivityLabel(activityLabelForTool(toolCall.tool));
				if (DATA_TOOL_NAMES.has(toolCall.tool)) {
					// Execute inline so results reach the model in the same turn
					hadDataToolCalls = true;
					const r = await executeDataTool(toolCall);
					if (r) {
						appendActionEvent(aiMsgId, {
							tool: 'query_data',
							label: r.label,
							preview: r.previewText
						});
						_sessionDataContext.set(r.contextKey, r.contextSummary.slice(0, 2000));
						allToolResults.push(r.llmText);
					}
				} else {
					const result = await executeToolCallWithResult(toolCall, aiMsgId);
					if (result) allToolResults.push(result);
				}
				break;
			}
			case 'plan_delta':
				// Plan is internal AI scaffolding — not shown to users
				break;
			case 'plan_proposal':
				// Modeling subagent output a plan for the user to approve before sql-gen starts.
				// Store it in the SSE result so the pipeline can await approval.
				if (event.proposal && typeof event.proposal === 'object') {
					planProposal = event.proposal as NonNullable<Parameters<typeof requestPlanApproval>[0]>;
				}
				break;
			case 'sprint_tasks':
				if (Array.isArray(event.tasks)) {
					const tasks = (
						event.tasks as Array<{ type?: string; title?: string; successCriteria?: string }>
					).map((t) => ({
						id: crypto.randomUUID(),
						type: (t.type ?? 'build') as SprintTaskType,
						title: t.title ?? 'Task',
						successCriteria: t.successCriteria,
						status: 'pending' as const,
						cellIds: []
					}));
					sprintTasks = tasks;
				}
				break;
			case 'sprint_update':
				if (Array.isArray(event.tasks)) {
					const updatedTasks = (
						event.tasks as Array<{ type?: string; title?: string; successCriteria?: string }>
					).map((t) => ({
						id: crypto.randomUUID(),
						type: (t.type ?? 'build') as SprintTaskType,
						title: t.title ?? 'Task',
						successCriteria: t.successCriteria,
						status: 'pending' as const,
						cellIds: []
					}));
					sprintUpdate = updatedTasks;
				}
				break;
			case 'suggestions':
				if (Array.isArray(event.suggestions)) {
					try {
						setMessageSuggestions(aiMsgId, event.suggestions as string[]);
					} catch {
						/* HMR staleness guard */
					}
					signalledDone = true;
				}
				break;
			case 'truncated':
				wasTruncated = true;
				break;
			case 'error':
				appendErrorMessage(String(event.error));
				break;
			case 'done':
				break;
		}
	};

	// SSE lines can be split across network chunks (a `data:` line can arrive in two
	// reads, even mid-JSON). The parser buffers partial lines across reads and only emits
	// complete events — the old per-chunk split silently dropped events spanning a boundary.
	const parser = createSSEParser();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const event of parser.push(dec.decode(value, { stream: true }))) {
				await dispatchEvent(event);
			}
		}
		// Flush any trailing complete event left without a final newline.
		for (const event of parser.flush()) await dispatchEvent(event);
		setCurrentActivityLabel(null);
	} catch (err) {
		setCurrentActivityLabel(null);
		// The SSE stream broke mid-response (network reset, server closed the connection).
		// Surface it as a retryable streamError instead of throwing — the old code let this
		// propagate to the outer catch and silently kill the whole generation.
		return {
			allToolResults,
			aborted: isAbort(err),
			signalledDone,
			hadDataToolCalls,
			wasTruncated,
			streamError: !isAbort(err)
		};
	}

	return {
		allToolResults,
		aborted: false,
		signalledDone,
		hadDataToolCalls,
		wasTruncated,
		streamError: false,
		planProposal,
		sprintTasks,
		sprintUpdate
	};
}

// ── Sprint loop ───────────────────────────────────────────────────────────────

async function runSprintLoop(
	userText: string,
	aiMsgId: string,
	contextCellIds: string[],
	workspaceMemory: string | undefined,
	signal: AbortSignal
): Promise<void> {
	function buildSprintReq(
		type: NonNullable<AIChatRequest['subagentType']>,
		userContent: string,
		allowedTools: import('$lib/types/ai-chat.js').AIChatToolName[],
		injection?: { role: 'user'; content: string }
	): AIChatRequest {
		const req = buildRequest(contextCellIds, workspaceMemory);
		req.messages = [
			{ role: 'user', content: userContent },
			{ role: 'assistant', content: '' }
		];
		if (injection) {
			req.messages = [...req.messages, injection, { role: 'assistant', content: '' }];
		}
		req.subagentType = type;
		req.allowedTools = allowedTools;
		return req;
	}

	// Phase 0 — Planning: ask AI to decompose the task into typed sprint tasks
	appendActionEvent(aiMsgId, { tool: 'record_decision', label: 'Planning sprint...' });
	let { sprintTasks: plannedTasks, aborted: planAborted } = await streamOneTurn(
		buildSprintReq('sprint_planning', userText, SUBAGENT_TOOLS['sprint_planning']),
		aiMsgId,
		signal
	);
	if (planAborted || signal.aborted) return;

	// If the planning turn produced no tasks, fall back to the standard subagent pipeline
	if (!plannedTasks || plannedTasks.length === 0) {
		updateLastActionEvent(aiMsgId, { label: 'Searching workspace...' });
		await runSubagentPipeline(
			userText,
			aiMsgId,
			contextCellIds,
			workspaceMemory,
			signal,
			'complex'
		);
		return;
	}

	setSprintTasks(plannedTasks);
	updateLastActionEvent(aiMsgId, { label: `Sprint planned: ${plannedTasks.length} tasks` });

	// Sprint plan refinement loop — user reviews the plan and can request changes before building
	while (!signal.aborted) {
		const feedback = await requestSprintPlanApproval();
		if (signal.aborted) return;
		if (feedback === null) break; // approved → proceed to Phase 1

		// Re-run sprint_planning with user's refinement feedback injected
		appendActionEvent(aiMsgId, { tool: 'record_decision', label: 'Refining plan...' });
		const currentPlanSummary = plannedTasks
			.map(
				(t, i) =>
					`${i + 1}. ${t.title}${t.successCriteria ? ` (done when: ${t.successCriteria})` : ''}`
			)
			.join('\n');
		const { sprintTasks: refinedTasks, aborted: replanAborted } = await streamOneTurn(
			buildSprintReq('sprint_planning', userText, SUBAGENT_TOOLS['sprint_planning'], {
				role: 'user',
				content: `[User refinement request]: ${feedback}\n\n[Current plan]:\n${currentPlanSummary}\n\nUpdate the plan to incorporate the user's feedback.`
			}),
			aiMsgId,
			signal
		);
		if (replanAborted || signal.aborted) return;
		if (refinedTasks && refinedTasks.length > 0) {
			plannedTasks = refinedTasks;
			setSprintTasks(plannedTasks);
		}
		updateLastActionEvent(aiMsgId, { label: `Sprint plan refined: ${plannedTasks.length} tasks` });
	}
	if (signal.aborted) return;

	// Phase 1 — Discovery: confirm existing models and sample key tables
	appendActionEvent(aiMsgId, { tool: 'record_decision', label: 'Searching workspace...' });
	const { allToolResults: discResults, aborted: discAborted } = await streamOneTurn(
		buildSprintReq('discovery', userText, SUBAGENT_TOOLS['discovery']),
		aiMsgId,
		signal
	);
	if (discAborted || signal.aborted) return;
	const discSummary = buildDiscoverySummary(discResults);
	updateLastActionEvent(aiMsgId, { label: 'Workspace searched' });

	// Phase 2 — Task loop: execute each task in sequence with bounded context
	let sprintSummary = ''; // distilled summary of what prior tasks built
	let tasks = getSprintTasks(); // live reference — may be updated mid-sprint

	for (let i = 0; i < tasks.length; i++) {
		if (signal.aborted) return;
		const task = tasks[i];
		updateSprintTask(task.id, { status: 'active' });

		// Snapshot the current cell set so we can tell which cells this task creates
		const cellsBefore = new Set(
			getCells()
				.filter((c) => c.cellType === 'query' || c.cellType === 'python')
				.map((c) => c.id)
		);

		const taskPrompt = [
			`Task ${i + 1}/${tasks.length}: ${task.title}`,
			task.successCriteria ? `Done when: ${task.successCriteria}` : '',
			`Task type: ${task.type}`,
			sprintSummary ? `Sprint progress:\n${sprintSummary}` : '',
			`Discovery:\n${discSummary}`,
			`\nOriginal goal: ${userText}`
		]
			.filter(Boolean)
			.join('\n');

		const taskTools = SPRINT_TASK_TOOLS[task.type];
		const taskSubagentType: NonNullable<AIChatRequest['subagentType']> =
			task.type === 'investigate'
				? 'discovery'
				: task.type === 'visualize' || task.type === 'dashboard'
					? 'dashboard'
					: task.type === 'document'
						? 'documentation'
						: 'sql-gen';
		const MAX_TASK_DEPTH = 8;
		let taskDepth = 0;
		let taskInjection: { role: 'user'; content: string } | null = null;
		let taskDone = false;
		let taskStallRetries = 0;

		while (!taskDone && taskDepth < MAX_TASK_DEPTH && !signal.aborted) {
			const taskReq = buildSprintReq(
				taskSubagentType,
				taskPrompt,
				taskTools,
				taskInjection ?? undefined
			);
			const { allToolResults, aborted, signalledDone, wasTruncated, streamError, sprintUpdate } =
				await streamOneTurn(taskReq, aiMsgId, signal);
			if (aborted) return;

			// If the AI emitted a <sprint_update>, replace remaining pending tasks with the updated plan
			if (sprintUpdate && sprintUpdate.length > 0) {
				const current = getSprintTasks();
				const finishedTasks = current.filter((t) => t.status !== 'pending');
				setSprintTasks([...finishedTasks, ...sprintUpdate]);
				tasks = getSprintTasks(); // refresh local reference
			}

			if (streamError || wasTruncated) {
				taskInjection = { role: 'user', content: 'Continue from where you left off.' };
				taskDepth++;
				continue;
			}

			if (signalledDone) {
				taskDone = true;
				break;
			}

			if (allToolResults.length > 0) {
				taskStallRetries = 0;
				const errorLines = allToolResults.filter((r) => r.includes(': RUN FAILED —'));

				// For investigate tasks: any data tool call counts as progress; mark done after results come in
				if (task.type === 'investigate' && allToolResults.length > 0 && errorLines.length === 0) {
					// Emit a sprint_update nudge to let the AI optionally refine remaining tasks
					taskInjection = {
						role: 'user',
						content: `Tool results:\n\n${allToolResults.join('\n\n---\n\n')}\n\nInvestigation complete. If these findings change what later tasks should build, emit a <sprint_update>[...remaining tasks as JSON...]</sprint_update> block now. Then output <done> with follow-up suggestions.`
					};
					taskDepth++;
					continue;
				}

				const hadRunCells = allToolResults.some((r) => r.startsWith('run_cells result:'));
				const directive =
					errorLines.length > 0
						? `Fix SQL errors — call update_cell then run_cells:\n${errorLines.join('\n')}`
						: hadRunCells
							? `Cells ran. Check: ${task.successCriteria ?? 'all cells succeeded'}. If done, output <done>. Otherwise continue.`
							: 'Continue the task. Call run_cells to validate, then output <done> when complete.';
				taskInjection = {
					role: 'user',
					content: `Tool results:\n\n${allToolResults.join('\n\n---\n\n')}\n\n${directive}`
				};
				taskDepth++;
				continue;
			}

			// Stall recovery
			if (taskStallRetries < 2) {
				taskStallRetries++;
				const hint =
					task.type === 'investigate'
						? 'Call sample_data or query_data to investigate the data, then output <done>.'
						: task.type === 'visualize'
							? 'Call pick_chart on the cell to chart it, then output <done>.'
							: task.type === 'dashboard'
								? 'Call list_cells, then create_cell with cellType:"markdown" using {% grid %}, {% metric %}, and {% chart %} tags, then output <done>.'
								: 'Call create_cell with the SQL, then run_cells to validate it, then output <done>.';
				taskInjection = { role: 'user', content: `You have not completed the task yet. ${hint}` };
				taskDepth++;
				continue;
			}
			taskDone = true; // exhausted stall budget — move on
		}

		// Capture sprint_update from the last task turn if the AI emitted one
		// (The event was already handled in dispatchEvent; check getSprintTasks for updated pending tasks)
		tasks = getSprintTasks();

		// Auto-verify: check that cells created by this task all ran successfully
		const newCellIds = getCells()
			.filter((c) => (c.cellType === 'query' || c.cellType === 'python') && !cellsBefore.has(c.id))
			.map((c) => c.id);

		const isPassing =
			task.type === 'investigate' ||
			task.type === 'document' ||
			task.type === 'visualize' ||
			task.type === 'dashboard' ||
			newCellIds.length === 0 ||
			newCellIds.every((id) => getCells().find((c) => c.id === id)?.status === 'success');

		if (isPassing) {
			// Build a one-line summary for the next task's context
			const cellSummaries = newCellIds
				.map((id) => {
					const c = getCells().find((x) => x.id === id);
					return c ? `${c.outputName} (${c.result?.rows?.length ?? 0} rows)` : null;
				})
				.filter(Boolean)
				.join(', ');
			const resultLine = cellSummaries
				? `${task.title}: ${cellSummaries}`
				: `${task.title}: completed`;
			updateSprintTask(task.id, { status: 'done', cellIds: newCellIds, result: resultLine });
			sprintSummary += (sprintSummary ? '\n' : '') + `✓ ${resultLine}`;
		} else {
			// One retry pass with explicit error context before marking failed
			const failedIds = newCellIds.filter(
				(id) => getCells().find((c) => c.id === id)?.status === 'error'
			);
			const errorDetails = failedIds
				.map((id) => {
					const c = getCells().find((x) => x.id === id);
					const err = c?.errors?.[0]?.display ?? c?.errors?.[0]?.reason ?? 'unknown error';
					return `${c?.outputName ?? id}: ${err}`;
				})
				.join('\n');

			appendActionEvent(aiMsgId, {
				tool: 'record_decision',
				label: `Retrying task ${i + 1}: ${task.title}`
			});
			const retryContent = `Task ${i + 1} verification failed.\n${errorDetails}\n\nFix the SQL errors: call update_cell with corrected SQL, then run_cells. Task done when all cells pass.`;
			const { allToolResults: retryResults, aborted: retryAborted } = await streamOneTurn(
				buildSprintReq('sql-gen', taskPrompt, SPRINT_TASK_TOOLS['build'], {
					role: 'user',
					content: retryContent
				}),
				aiMsgId,
				signal
			);
			if (retryAborted || signal.aborted) return;

			const stillFailing = failedIds.some(
				(id) => getCells().find((c) => c.id === id)?.status === 'error'
			);
			if (stillFailing) {
				updateSprintTask(task.id, { status: 'failed', cellIds: newCellIds });
				sprintSummary += (sprintSummary ? '\n' : '') + `✗ ${task.title}: had errors — continuing`;
			} else {
				updateSprintTask(task.id, { status: 'done', cellIds: newCellIds });
				sprintSummary += (sprintSummary ? '\n' : '') + `✓ ${task.title}: fixed and passed`;
			}
			void retryResults; // suppress unused warning
		}
	}

	if (signal.aborted) return;

	// Phase 3 — sql-review: final quality check across all built cells
	const createdNames = [..._outputNameToId.keys()];
	const anyFailing = [..._outputNameToId.values()].some((id) => {
		const c = getCells().find((x) => x.id === id);
		return c && c.cellType !== 'markdown' && c.status === 'error';
	});
	if (createdNames.length === 0 || anyFailing) return;

	const MAX_REVIEW_CYCLES = 2;
	let lastIssues: string[] = [];

	for (let reviewCycle = 1; reviewCycle <= MAX_REVIEW_CYCLES; reviewCycle++) {
		if (signal.aborted) return;
		appendActionEvent(aiMsgId, {
			tool: 'record_decision',
			label: `Reviewing (${reviewCycle}/${MAX_REVIEW_CYCLES})...`
		});
		const reviewReq = buildSprintReq(
			'sql-review',
			`Review these newly created notebook cells: ${createdNames.join(', ')}`,
			SUBAGENT_TOOLS['sql-review']
		);
		const { allToolResults: reviewResults } = await streamOneTurn(reviewReq, aiMsgId, signal);
		if (signal.aborted) return;

		const reviewText = reviewResults.join('\n');
		const review = parseReviewResult(reviewText);
		const totalScore = review?.total ?? 10;
		if (!review || review.approved || review.issues.length === 0 || totalScore >= 7) {
			if (reviewCycle > 1 && lastIssues.length > 0) persistLearnedPatterns(lastIssues);
			break;
		}
		if (totalScore < 4) {
			appendActionEvent(aiMsgId, { tool: 'record_decision', label: 'Review: needs rework' });
			break;
		}

		lastIssues = review.issues;
		const feedback = formatReviewFeedback(review, reviewCycle);
		appendActionEvent(aiMsgId, {
			tool: 'record_decision',
			label: `Fixing review issues (cycle ${reviewCycle})...`
		});
		await streamOneTurn(
			buildSprintReq('sql-gen', userText, SPRINT_TASK_TOOLS['build'], {
				role: 'user',
				content: feedback
			}),
			aiMsgId,
			signal
		);
	}
}

// ── Subagent pipeline ────────────────────────────────────────────────────────

async function runSubagentPipeline(
	userText: string,
	aiMsgId: string,
	contextCellIds: string[],
	workspaceMemory: string | undefined,
	signal: AbortSignal,
	complexity: import('$lib/services/ai-subagents.js').TaskComplexity = 'medium'
): Promise<void> {
	function buildSubagentReq(
		type: NonNullable<AIChatRequest['subagentType']>,
		userContent: string,
		injection?: { role: 'user'; content: string }
	): AIChatRequest {
		const req = buildRequest(contextCellIds, workspaceMemory);
		req.messages = [
			{ role: 'user', content: userContent },
			{ role: 'assistant', content: '' }
		];
		if (injection) {
			req.messages = [...req.messages, injection, { role: 'assistant', content: '' }];
		}
		req.subagentType = type;
		req.allowedTools = SUBAGENT_TOOLS[type];
		return req;
	}

	const PHASE_LABELS: Record<PipelinePhase['id'], string> = {
		discovery: 'Discovery',
		modeling: 'Modeling',
		'sql-gen': 'SQL generation',
		'sql-review': 'Review'
	};
	const phaseIds: PipelinePhase['id'][] =
		complexity === 'complex'
			? ['discovery', 'modeling', 'sql-gen', 'sql-review']
			: ['discovery', 'modeling', 'sql-gen'];
	setPipelinePhases(
		phaseIds.map((id) => ({
			id,
			label: PHASE_LABELS[id],
			status: id === 'discovery' ? 'active' : 'pending'
		}))
	);

	// Phase 1: Discovery — always run (even medium tasks benefit from reuse detection)
	appendActionEvent(aiMsgId, { tool: 'record_decision', label: 'Searching workspace...' });
	const { allToolResults: discResults, aborted: discAborted } = await streamOneTurn(
		buildSubagentReq('discovery', userText),
		aiMsgId,
		signal
	);
	if (discAborted || signal.aborted) return;

	const discSummary = buildDiscoverySummary(discResults);
	updateLastActionEvent(aiMsgId, { label: 'Workspace searched' });
	updatePipelinePhase('discovery', { status: 'done' });
	updatePipelinePhase('modeling', { status: 'active' });

	// Phase 2: Modeling — always run so the user sees a plan before SQL is written
	let planAssertions: PlanAssertion[] = [];
	{
		appendActionEvent(aiMsgId, { tool: 'record_decision', label: 'Designing model...' });
		const { aborted: modAborted, planProposal } = await streamOneTurn(
			buildSubagentReq('modeling', `${userText}\n\n${discSummary}`),
			aiMsgId,
			signal
		);
		if (modAborted || signal.aborted) return;

		// Plan approval gate: surface the modeling plan to the user before writing SQL.
		// If the user rejects (or the model didn't emit a plan_proposal), we still proceed —
		// the gate is advisory so as not to block progress when the model omits the block.
		if (planProposal) {
			appendActionEvent(aiMsgId, {
				tool: 'record_decision',
				label: 'Waiting for plan approval...'
			});
			const approved = await requestPlanApproval(planProposal);
			if (!approved || signal.aborted) return;
			updateLastActionEvent(aiMsgId, { label: 'Plan approved' });
			// Extract assertions from the approved plan — carry them forward as acceptance criteria
			if (Array.isArray((planProposal as { assertions?: PlanAssertion[] }).assertions)) {
				planAssertions = (planProposal as { assertions?: PlanAssertion[] }).assertions ?? [];
			}
		}
	}

	updatePipelinePhase('modeling', { status: 'done' });
	updatePipelinePhase('sql-gen', { status: 'active' });

	// Phase 3: SQL Generation — multi-turn mini-loop with error recovery
	appendActionEvent(aiMsgId, { tool: 'record_decision', label: 'Writing SQL...' });
	const assertionsBlock =
		planAssertions.length > 0
			? '\n\n[Acceptance criteria — verify all pass via query_data before calling <done>]\n' +
				planAssertions
					.map((a, i) => `${i + 1}. ${a.model} — ${a.description}: ${a.sql}`)
					.join('\n') +
				'\nAfter run_cells succeeds, run each assertion. If any returns FALSE or non-zero, fix the model.'
			: '';
	const sqlBaseContent = `${userText}\n\n${discSummary}${assertionsBlock}`;
	let sqlInjection: { role: 'user'; content: string } | null = null;
	let sqlDone = false;
	const MAX_SQL_DEPTH = 12;
	let sqlDepth = 0;
	// Stall-recovery budget — mirrors the standard loop. Small models routinely build a
	// cell, fix its error, then emit a prose-only "all done" turn WITHOUT a <done> block.
	// Without these nudges the loop broke immediately and skipped charting + review, so the
	// run appeared to "stop after fixing the SQL error".
	let sqlStallRetries = 0;

	// Are any query cells built so far still failing?
	const anyBuiltCellFailing = (): boolean =>
		[..._outputNameToId.values()].some((id) => {
			const c = getCells().find((x) => x.id === id);
			return c && c.cellType !== 'markdown' && c.status === 'error';
		});
	// Query cells built so far (non-markdown).
	const builtQueryCellCount = (): number =>
		[..._outputNameToId.values()].filter(
			(id) => getCells().find((c) => c.id === id)?.cellType !== 'markdown'
		).length;
	// Query cells built this run that don't yet have a chart.
	const unchartedNames = (): string[] =>
		[..._outputNameToId.values()]
			.filter(
				(id) =>
					!_chartedCellIds.has(id) && getCells().find((c) => c.id === id)?.cellType !== 'markdown'
			)
			.map((id) => getCells().find((c) => c.id === id)?.outputName ?? id);
	// Query cells built this run that haven't been run yet (no results yet — still idle).
	const unrunCellIds = (): string[] =>
		[..._outputNameToId.values()].filter((id) => {
			const c = getCells().find((x) => x.id === id);
			return c && c.cellType !== 'markdown' && (!c.status || c.status === 'idle');
		});
	// True once any markdown cell (findings/summary) was created this generation.
	const findingsCreated = (): boolean =>
		[..._outputNameToId.values()].some(
			(id) => getCells().find((x) => x.id === id)?.cellType === 'markdown'
		);

	while (!sqlDone && sqlDepth < MAX_SQL_DEPTH && !signal.aborted) {
		const sqlReq = buildSubagentReq('sql-gen', sqlBaseContent, sqlInjection ?? undefined);
		const { allToolResults, aborted, signalledDone, wasTruncated, streamError } =
			await streamOneTurn(sqlReq, aiMsgId, signal);
		if (aborted) return;

		// Transient stream/connection error mid-response — retry this turn instead of bailing.
		if (streamError) {
			sqlInjection = {
				role: 'user',
				content:
					'The previous response was interrupted by a connection error. Continue from where you left off.'
			};
			sqlDepth++;
			continue;
		}

		// Only honor <done> once every built cell actually runs clean — prevents the model
		// declaring completion over a cell that's still erroring. Also guard against the
		// case where the model emits <done> before run_cells in the same output chunk
		// (server flushes done-blocks before tool-calls, so signalledDone can be true
		// even though run_cells just fired and the model hasn't seen the results).
		const hadRunCellsSql = allToolResults.some((r) => r.startsWith('run_cells result:'));
		if (signalledDone && !anyBuiltCellFailing() && !hadRunCellsSql) {
			sqlDone = true;
			break;
		}

		if (wasTruncated) {
			sqlInjection = { role: 'user', content: 'Continue from where you left off.' };
			sqlDepth++;
			continue;
		}

		if (allToolResults.length > 0) {
			sqlStallRetries = 0; // productive turn — reset stall budget
			const errorLines = allToolResults.filter((r) => r.includes(': RUN FAILED —'));
			const charts = unchartedNames();
			const unrun = unrunCellIds();

			// All clean: no errors, all cells ran, all cells charted — the model did its job.
			// Exit even if it didn't emit <done> (llama-3.3-70b often omits it after pick_chart).
			// Also exit for documentation-only tasks where builtQueryCellCount() stays 0.
			const hasFindingsNow = findingsCreated();
			if (
				errorLines.length === 0 &&
				unrun.length === 0 &&
				charts.length === 0 &&
				(builtQueryCellCount() > 0 || hasFindingsNow)
			) {
				sqlDone = true;
				break;
			}

			const directive =
				errorLines.length > 0
					? `Fix SQL errors — call update_cell then run_cells:\n${errorLines.join('\n')}`
					: builtQueryCellCount() === 0 && !hasFindingsNow
						? 'No SQL models created yet. Call create_cell with cellType:"query" and complete SQL, then call run_cells to execute it.'
						: unrun.length > 0
							? `Cells created but not yet executed. Call run_cells with cellIds: ${JSON.stringify(unrun)} to validate them, then continue.`
							: charts.length > 0 && !hasFindingsNow
								? `Cells run clean. Now: (1) write a findings markdown cell (cellType:"markdown", outputName:"findings") — use \`$outputName.field\` live refs for all key numbers (e.g. \`$orders.count orders processed\`, \`$top.revenue\`) so the summary stays accurate when data refreshes; (2) call pick_chart for: ${charts.join(', ')}; (3) output <done> with follow-up suggestions.`
								: charts.length > 0
									? `Cells run clean. Call pick_chart for: ${charts.join(', ')}, then output <done> with follow-up suggestions.`
									: !hasFindingsNow
										? 'Cells run clean. Write a findings markdown cell (cellType:"markdown", outputName:"findings") — use `$outputName.field` live refs for all key numbers so the summary updates when data refreshes. Then output <done> with follow-up suggestions.'
										: 'All done. Output <done> with follow-up suggestions.';
			sqlInjection = {
				role: 'user',
				content: `Tool results:\n\n${allToolResults.join('\n\n---\n\n')}\n\n${directive}`
			};
			sqlDepth++;
			continue;
		}

		// No tool calls this turn (prose-only stall). If we already have clean cells or a
		// findings cell, treat the build as complete and fall through to review.
		if ((builtQueryCellCount() > 0 || findingsCreated()) && !anyBuiltCellFailing()) {
			sqlDone = true;
			break;
		}
		if (sqlStallRetries < 2) {
			sqlStallRetries++;
			sqlInjection = {
				role: 'user',
				content: anyBuiltCellFailing()
					? 'Cells still have SQL errors. Call update_cell with corrected SQL, then run_cells to verify. Do NOT respond with prose only.'
					: 'You have not built the model yet. Call create_cell with the SQL, then run_cells to validate. Do NOT respond with prose only.'
			};
			sqlDepth++;
			continue;
		}
		break; // exhausted stall budget with no cells built
	}

	if (signal.aborted) return;
	updatePipelinePhase('sql-gen', { status: 'done' });

	// Phase 4: SQL Review — GAN-inspired generator-evaluator loop.
	// Only for complex tasks (medium tasks skip review to reduce latency).
	// Runs up to 3 review cycles: each failed review feeds specific, scored feedback
	// back to sql-gen for a targeted fix pass, then the evaluator re-checks.
	const createdNames = [..._outputNameToId.keys()];
	if (complexity !== 'complex' || createdNames.length === 0 || anyBuiltCellFailing()) {
		updatePipelinePhase('sql-review', { status: 'done' });
		return;
	}

	updatePipelinePhase('sql-review', { status: 'active' });
	const MAX_REVIEW_CYCLES = 3;
	let lastIssues: string[] = [];

	for (let reviewCycle = 1; reviewCycle <= MAX_REVIEW_CYCLES; reviewCycle++) {
		if (signal.aborted) return;

		appendActionEvent(aiMsgId, {
			tool: 'record_decision',
			label: `Reviewing (${reviewCycle}/${MAX_REVIEW_CYCLES})...`
		});
		const reviewAssertionsBlock =
			planAssertions.length > 0
				? '\n\n[Pre-defined acceptance criteria from planning — run these first]\n' +
					planAssertions
						.map((a, i) => `${i + 1}. ${a.model} — ${a.description}: ${a.sql}`)
						.join('\n')
				: '';
		const { allToolResults: reviewResults } = await streamOneTurn(
			buildSubagentReq(
				'sql-review',
				`Review these newly created notebook cells: ${[..._outputNameToId.keys()].join(', ')}${reviewAssertionsBlock}`
			),
			aiMsgId,
			signal
		);
		if (signal.aborted) return;

		const reviewText = reviewResults.join('\n');
		const review = parseReviewResult(reviewText);

		// Approve if: no blocking issues, or total score >= 7/10, or review can't be parsed
		const totalScore = review?.total ?? (review ? 10 : 10);
		if (!review || review.approved || review.issues.length === 0 || totalScore >= 7) {
			// Persist learned patterns if a previous fix cycle resolved issues (Improvement 4)
			if (reviewCycle > 1 && lastIssues.length > 0) persistLearnedPatterns(lastIssues);
			break;
		}

		// Too broken to fix iteratively — surface to user and exit
		if (totalScore < 4) {
			appendActionEvent(aiMsgId, { tool: 'record_decision', label: 'Review: needs rework' });
			break;
		}

		// Fixable: inject specific scored feedback back to sql-gen
		lastIssues = review.issues;
		const feedback = formatReviewFeedback(review, reviewCycle);
		appendActionEvent(aiMsgId, {
			tool: 'record_decision',
			label: `Fixing review issues (cycle ${reviewCycle})...`
		});

		let fixInjection: { role: 'user'; content: string } | null = {
			role: 'user',
			content: feedback
		};
		let fixDepth = 0;
		const MAX_FIX_DEPTH = 6;
		while (fixDepth < MAX_FIX_DEPTH && !signal.aborted) {
			const {
				allToolResults: fixResults,
				aborted: fixAborted,
				signalledDone: fixDone,
				streamError
			} = await streamOneTurn(
				buildSubagentReq('sql-gen', sqlBaseContent, fixInjection ?? undefined),
				aiMsgId,
				signal
			);
			if (fixAborted) return;
			if (streamError) {
				fixInjection = { role: 'user', content: 'Continue from where you left off.' };
				fixDepth++;
				continue;
			}
			if (fixDone && !anyBuiltCellFailing()) break;
			if (fixResults.length > 0) {
				const errLines = fixResults.filter((r) => r.includes(': RUN FAILED —'));
				fixInjection =
					errLines.length > 0
						? {
								role: 'user',
								content: `Tool results:\n\n${fixResults.join('\n\n---\n\n')}\n\nFix SQL errors — call update_cell then run_cells:\n${errLines.join('\n')}`
							}
						: {
								role: 'user',
								content: `Tool results:\n\n${fixResults.join('\n\n---\n\n')}\n\nAll fixed. Call <done>.`
							};
			} else {
				fixInjection = {
					role: 'user',
					content:
						'Call update_cell with the fix and run_cells to verify. Do NOT respond with prose only.'
				};
			}
			fixDepth++;
		}
	}
	updatePipelinePhase('sql-review', { status: 'done' });
}

// ── Focused subagent loops ────────────────────────────────────────────────────

/** Shared helper: build a subagent request with restricted tool access. */
function buildFocusedReq(
	type: NonNullable<AIChatRequest['subagentType']>,
	userContent: string,
	contextCellIds: string[],
	workspaceMemory: string | undefined,
	injection?: { role: 'user'; content: string }
): AIChatRequest {
	const req = buildRequest(contextCellIds, workspaceMemory);
	req.messages = [
		{ role: 'user', content: userContent },
		{ role: 'assistant', content: '' }
	];
	if (injection) {
		req.messages = [...req.messages, injection, { role: 'assistant', content: '' }];
	}
	req.subagentType = type;
	req.allowedTools = SUBAGENT_TOOLS[type];
	return req;
}

async function runDebugLoop(
	userText: string,
	aiMsgId: string,
	contextCellIds: string[],
	workspaceMemory: string | undefined,
	signal: AbortSignal
): Promise<void> {
	const MAX_DEPTH = 10;
	let depth = 0;
	let injection: { role: 'user'; content: string } | null = null;
	let stallRetries = 0;
	let streamErrorCount = 0;

	while (depth < MAX_DEPTH && !signal.aborted) {
		const { allToolResults, aborted, signalledDone, wasTruncated, streamError } =
			await streamOneTurn(
				buildFocusedReq('debug', userText, contextCellIds, workspaceMemory, injection ?? undefined),
				aiMsgId,
				signal
			);
		if (aborted) return;

		if (streamError || wasTruncated) {
			streamErrorCount++;
			if (streamErrorCount >= 3) break; // Give up after 3 consecutive stream errors
			injection = { role: 'user', content: 'Continue from where you left off.' };
			depth++;
			continue;
		}
		streamErrorCount = 0;

		if (allToolResults.length > 0) {
			stallRetries = 0;
			const hadRunCells = allToolResults.some((r) => r.startsWith('run_cells result:'));
			const runFailedLines = allToolResults.filter((r) => r.includes(': RUN FAILED —'));
			const getCellErrorLines = allToolResults.filter(
				(r) => r.includes('— error:') && r.includes('Fix the SQL with update_cell')
			);
			// Exit immediately when run_cells succeeded (no failures) — avoids sending an extra
			// turn just to emit <done>, which can be very slow with external LLM providers.
			if (hadRunCells && runFailedLines.length === 0) break;
			// Model emitted <done> but cells are still failing — override and continue.
			if (signalledDone && runFailedLines.length === 0 && getCellErrorLines.length === 0) break;
			const directive =
				runFailedLines.length > 0
					? `Fix the SQL error — call update_cell with corrected SQL then run_cells:\n${runFailedLines.join('\n')}`
					: getCellErrorLines.length > 0
						? `The cell has an SQL error. Call update_cell with corrected SQL (use valid column names from the table), then run_cells to verify:\n${getCellErrorLines.join('\n')}`
						: 'Continue debugging. Call run_cells to verify the fix, then call <done>.';
			injection = {
				role: 'user',
				content: `Tool results:\n\n${allToolResults.join('\n\n---\n\n')}\n\n${directive}`
			};
			depth++;
			continue;
		}

		if (signalledDone) break;

		if (stallRetries < 3) {
			stallRetries++;
			injection = {
				role: 'user',
				content:
					'Call run_cells on the failing cell to reproduce the SQL error (the run result will contain the error message), then call update_cell with the corrected SQL and run_cells again to verify. Do NOT respond with prose only.'
			};
			depth++;
			continue;
		}
		break;
	}
}

// Composes a Markdoc grid/columns layout of metric/chart widgets in one markdown cell —
// the replacement for the old "assemble a Dashboard object" loop.
async function runDashboardLoop(
	userText: string,
	aiMsgId: string,
	contextCellIds: string[],
	workspaceMemory: string | undefined,
	signal: AbortSignal
): Promise<void> {
	const MAX_DEPTH = 8;
	let depth = 0;
	let injection: { role: 'user'; content: string } | null = null;
	let stallRetries = 0;
	// Track the created summary cell across turns so the model updates it instead of
	// creating a second one.
	let knownCellName: string | null = null;

	while (depth < MAX_DEPTH && !signal.aborted) {
		const { allToolResults, aborted, signalledDone, wasTruncated, streamError } =
			await streamOneTurn(
				buildFocusedReq(
					'dashboard',
					userText,
					contextCellIds,
					workspaceMemory,
					injection ?? undefined
				),
				aiMsgId,
				signal
			);
		if (aborted) return;

		if (streamError || wasTruncated) {
			injection = { role: 'user', content: 'Continue from where you left off.' };
			depth++;
			continue;
		}

		if (signalledDone) break;

		if (allToolResults.length > 0) {
			stallRetries = 0;

			if (!knownCellName) {
				for (const r of allToolResults) {
					const m = r.match(/Cell '(.+?)' (?:created|updated)/);
					if (m) {
						knownCellName = m[1];
						break;
					}
				}
			}

			const directive = knownCellName
				? `The summary cell '${knownCellName}' already exists. Use update_cell to revise it rather than creating a new one. Then call <done>.`
				: 'Write one markdown cell (create_cell, cellType:"markdown") using {% grid %} of {% metric %} widgets and {% chart %} tags for the relevant cells, then call <done>.';

			injection = {
				role: 'user',
				content: `Tool results:\n\n${allToolResults.join('\n\n---\n\n')}\n\n${directive} Do NOT respond with prose only — call the tools now.`
			};
			depth++;
			continue;
		}

		if (stallRetries < 2) {
			stallRetries++;
			const directive = knownCellName
				? `The summary cell '${knownCellName}' already exists — use update_cell to revise it, then call <done>.`
				: 'Write one markdown cell (create_cell, cellType:"markdown") using {% grid %} of {% metric %} widgets and {% chart %} tags, then call <done>. Do NOT respond with prose only.';
			injection = { role: 'user', content: directive };
			depth++;
			continue;
		}
		break;
	}
}

async function runInvestigationLoop(
	userText: string,
	aiMsgId: string,
	contextCellIds: string[],
	workspaceMemory: string | undefined,
	signal: AbortSignal
): Promise<void> {
	const MAX_DEPTH = 8;
	let depth = 0;
	let injection: { role: 'user'; content: string } | null = null;
	let stallRetries = 0;

	while (depth < MAX_DEPTH && !signal.aborted) {
		const { allToolResults, aborted, signalledDone, wasTruncated, streamError } =
			await streamOneTurn(
				buildFocusedReq(
					'investigation',
					userText,
					contextCellIds,
					workspaceMemory,
					injection ?? undefined
				),
				aiMsgId,
				signal
			);
		if (aborted) return;

		if (streamError || wasTruncated) {
			injection = { role: 'user', content: 'Continue from where you left off.' };
			depth++;
			continue;
		}

		if (signalledDone) break;

		if (allToolResults.length > 0) {
			stallRetries = 0;
			injection = {
				role: 'user',
				content: `Tool results:\n\n${allToolResults.join('\n\n---\n\n')}\n\nSummarize your findings and call <done> with follow-up suggestions.`
			};
			depth++;
			continue;
		}

		if (stallRetries < 2) {
			stallRetries++;
			injection = {
				role: 'user',
				content:
					'You did not call any data tools and did not signal completion. If you already have enough information from context, summarize your findings and end with <done>{"suggestions":["short follow-up 1","short follow-up 2","short follow-up 3"]}</done>. Otherwise call sample_data or query_data first.'
			};
			depth++;
			continue;
		}
		break;
	}
}

// ── Main submit ───────────────────────────────────────────────────────────────

export async function submitAIMessage(
	userText: string,
	forcedIntent?: 'build' | 'sprint' | 'fix' | 'dashboard' | 'explore'
): Promise<void> {
	if (getIsGenerating()) return;

	// Snapshot before any mutations
	setPendingSnapshot(takeSnapshot());
	setUndoAvailable(false);

	const contextCellIds = getContextCellIds();
	clearContextCells();
	_outputNameToId = new Map();
	_callIdToId = new Map();
	_alreadyRanIds = new Set();
	_chartedCellIds = new Set();
	_updatedCellIds = new Set();
	_madeNotebookChanges = false;
	clearSprintTasks();
	clearPipelinePhases();

	// Append user message to thread
	appendMessage({
		role: 'user',
		text: userText,
		isStreaming: false,
		contextPills: contextCellIds.map((id) => {
			const cell = getCells().find((c) => c.id === id);
			return { cellId: id, cellName: cell?.outputName ?? id };
		}),
		actionEvents: []
	});

	// Start streaming AI message
	const aiMsg = appendMessage({
		role: 'assistant',
		text: '',
		isStreaming: true,
		contextPills: [],
		actionEvents: []
	});

	const abortController = new AbortController();
	setActiveController(abortController);
	setIsGenerating(true);

	let didCancel = false;

	try {
		// Detect a project-folder switch (including to/from demo mode) and reseed session
		// memory accordingly before anything else this turn touches it.
		await loadProjectMemoryIfNeeded();

		// Run preflight + fetch workspace patterns in parallel — both are best-effort.
		// _preflightDone skips the profiling queries on subsequent turns (cache already warm).
		const [workspaceMemory] = await Promise.all([
			fetch('/api/ai/patterns')
				.then(async (r) => {
					if (!r.ok) return undefined;
					const d = (await r.json()) as { patterns?: string };
					return d.patterns || undefined;
				})
				.catch(() => undefined as string | undefined),
			_preflightDone
				? Promise.resolve()
				: runPreflightProfiles().then(() => {
						_preflightDone = true;
						// #7 — Fire background expansion for remaining tables without awaiting
						void runIdlePreflightExpansion();
					})
		]);

		// Route to the most appropriate loop based on intent.
		const route = routeAgentIntent(userText, forcedIntent);
		const intent = route.intent;
		const complexity = route.complexity;
		emitAgentTelemetry({
			type: 'intent',
			intent,
			loop: route.loop,
			metadata: { tier: route.tier, requiresPlanApproval: route.requiresPlanApproval }
		});
		if (intent === 'creation') {
			const loopName = complexity === 'complex' ? 'sprint' : 'pipeline';
			emitAgentTelemetry({ type: 'loop_start', loop: loopName, intent });
			if (complexity === 'complex') {
				// Complex tasks use the sprint loop: plan → discovery → per-task loops → review
				await runSprintLoop(
					userText,
					aiMsg.id,
					contextCellIds,
					workspaceMemory,
					abortController.signal
				);
			} else {
				await runSubagentPipeline(
					userText,
					aiMsg.id,
					contextCellIds,
					workspaceMemory,
					abortController.signal,
					complexity
				);
			}
			// If the request asked for a dashboard/chart/kpi, build it from the newly created cells.
			if (
				/\b(dashboard|chart|kpi|graph|plot|visuali[sz]e)\b/i.test(userText) &&
				!abortController.signal.aborted
			) {
				await runDashboardLoop(
					userText,
					aiMsg.id,
					contextCellIds,
					workspaceMemory,
					abortController.signal
				);
			}
		} else if (intent === 'debug') {
			emitAgentTelemetry({ type: 'loop_start', loop: 'debug', intent });
			await runDebugLoop(
				userText,
				aiMsg.id,
				contextCellIds,
				workspaceMemory,
				abortController.signal
			);
		} else if (intent === 'dashboard') {
			emitAgentTelemetry({ type: 'loop_start', loop: 'dashboard', intent });
			await runDashboardLoop(
				userText,
				aiMsg.id,
				contextCellIds,
				workspaceMemory,
				abortController.signal
			);
		} else if (intent === 'investigation') {
			emitAgentTelemetry({ type: 'loop_start', loop: 'investigation', intent });
			await runInvestigationLoop(
				userText,
				aiMsg.id,
				contextCellIds,
				workspaceMemory,
				abortController.signal
			);
		} else {
			emitAgentTelemetry({ type: 'loop_start', loop: 'standard', intent });
			const fsm = createFsmContext({ loop: 'standard', maxTurns: 30 });
			applyTransition(fsm, transitionFsm(fsm, { type: 'routed', loop: 'standard' }));
			// ── Agentic loop ─────────────────────────────────────────────────────────
			// Higher depth needed: each result-critical tool call (run_cells, sample_data, etc.)
			// now occupies its own iteration so a 3-cell task uses ~8–12 turns instead of 2–3.
			const MAX_DEPTH = 30;
			let depth = 0;
			// Single injection slot — replaced each iteration, never accumulated.
			// Accumulating would bloat the prompt and squeeze out response tokens.
			let agentInjection: { role: 'user'; content: string } | null = null;
			// How many times we've nudged the model after it stalled with SQL errors still present.
			// Checked against actual cell status (not just "did the last turn return errors") so
			// multiple consecutive prose-only stalls during error correction all get recovery nudges.
			let errorStallRetries = 0;
			// Last known error lines from run_cells — persisted so stall recovery nudges can
			// re-surface the specific error even when allToolResults is empty.
			let lastErrorDetails: string[] = [];
			// Same for data tool failures (sample_data/query_data/profile_column).
			let prevHadDataErrors = false;
			// Generic mid-task stall counter: model produced only prose with no tool calls and no <done>.
			// Allows multiple recovery nudges and resets when the model makes productive progress,
			// so a stall → recovery → work → stall sequence still gets a nudge on the second stall.
			let midTaskStallRetries = 0;
			const MAX_MID_TASK_STALL_RETRIES = 3;
			// Whether the previous iteration executed data tool calls (sample_data / query_data /
			// profile_column). Used to detect the investigation→stall gap: model called sample_data,
			// got results, then produced prose only without proceeding to build cells.
			let prevHadDataToolCalls = false;
			// How many times we've resumed after a max_tokens truncation. Capped to prevent infinite loops
			// if the model consistently hits the limit on the same subtask.
			let truncationRetries = 0;
			const MAX_TRUNCATION_RETRIES = 3;
			// How many times we've retried after a mid-stream connection/parse error. Bounded so a
			// persistently broken connection doesn't loop forever, but a transient blip no longer
			// kills the whole generation.
			let streamErrorRetries = 0;
			const MAX_STREAM_ERROR_RETRIES = 2;

			while (depth < MAX_DEPTH) {
				if (abortController.signal.aborted) {
					didCancel = true;
					break;
				}
				// Save per-iteration checkpoint BEFORE any mutations in this iteration
				pushCheckpoint(takeSnapshot());

				const reqBody = buildRequest(contextCellIds, workspaceMemory);

				// Inject the latest tool result message from the previous iteration.
				// Append after the current assistant message so the server's slice(-2) sees:
				//   [history..., assistantMsg, agentInjection, emptyAssistantPlaceholder]
				// → olderMessages = [...history, assistantMsg], lastUser = agentInjection.content
				// This preserves the assistant's prior response in context across iterations.
				if (agentInjection) {
					reqBody.messages = [
						...reqBody.messages,
						agentInjection,
						{ role: 'assistant' as const, content: '' }
					];
				}

				const {
					allToolResults,
					aborted,
					signalledDone,
					hadDataToolCalls,
					wasTruncated,
					streamError
				} = await streamOneTurn(reqBody, aiMsg.id, abortController.signal);
				if (aborted) break;

				if (allToolResults.length > 0) {
					applyTransition(fsm, transitionFsm(fsm, { type: 'tool_calls' }));
					applyTransition(fsm, transitionFsm(fsm, { type: 'tools_done' }));
				} else if (signalledDone) {
					applyTransition(fsm, transitionFsm(fsm, { type: 'done' }));
				} else if (!streamError && !wasTruncated && allToolResults.length === 0) {
					const stall = transitionFsm(fsm, { type: 'prose_only' });
					if (stall.next === 'stall_recovery') {
						emitAgentTelemetry({
							type: 'stall',
							stallReason: stall.reason,
							turn: fsm.turn,
							metadata: { loop: 'standard' }
						});
					}
					applyTransition(fsm, stall);
				}

				if (wasTruncated) {
					emitAgentTelemetry({ type: 'truncation', turn: depth, metadata: { loop: 'standard' } });
				}
				if (streamError) {
					emitAgentTelemetry({ type: 'stream_error', turn: depth, metadata: { loop: 'standard' } });
				}

				// Transient stream/connection error mid-response. The old code let this throw and
				// silently end the run; instead retry the turn (bounded) so a network blip doesn't
				// kill generation. The model re-receives context and continues; create_cell de-dupes.
				if (streamError) {
					if (streamErrorRetries < MAX_STREAM_ERROR_RETRIES) {
						streamErrorRetries++;
						agentInjection = {
							role: 'user',
							content:
								'The previous response was interrupted by a connection error. Continue the task from where you left off — re-run any cells whose results you did not see.'
						};
						depth++;
						continue;
					}
					appendErrorMessage(
						'The connection was interrupted repeatedly. Some steps may be incomplete — ask me to continue.'
					);
					break;
				}

				// Truncation recovery: server detected finish_reason="length" (LLM hit max_tokens).
				// The model's output was cut off mid-stream — stall recovery nudges are wrong here.
				// Inject a clean "continue where you left off" message instead.
				if (wasTruncated && truncationRetries < MAX_TRUNCATION_RETRIES) {
					agentInjection = {
						role: 'user',
						content:
							'Your response was cut off because you hit the token limit. Continue exactly where you left off — complete any unfinished tool calls or steps and then finish the task.'
					};
					truncationRetries++;
					depth++;
					continue;
				}

				// Confirmation gate: if > 3 new cells created in first iteration and none run yet,
				// pause and ask user to confirm before proceeding to run/chart steps.
				if (depth === 0 && _outputNameToId.size > 3 && _alreadyRanIds.size === 0) {
					const shouldProceed = await requestConfirmation(_outputNameToId.size);
					if (!shouldProceed) {
						undoAIChanges();
						didCancel = true;
						break;
					}
				}

				// Agent signalled completion via <done> block.
				// Only stop if there are no run_cells errors AND all created/updated query cells
				// have been explicitly run — prevents silent failures in the finally auto-run.
				// Also don't stop if data tools (sample_data/query_data/profile_column) were just
				// called: their results need to be fed back before the model can continue building.
				const hasRunErrors = allToolResults.some((r) => r.includes(': RUN FAILED —'));
				const createdButNotRun = [..._outputNameToId.values()].filter(
					(id) =>
						!_alreadyRanIds.has(id) && getCells().find((c) => c.id === id)?.cellType !== 'markdown'
				);
				const updatedButNotRun = [..._updatedCellIds].filter((id) => !_alreadyRanIds.has(id));
				const hasUnrunCells = createdButNotRun.length > 0 || updatedButNotRun.length > 0;
				// Check actual cell status — not just whether this turn's allToolResults had errors.
				// Prevents honoring <done> when the model emits it after a failed fix attempt
				// without re-running cells, so hasRunErrors would be false despite broken cells.
				const anyCellStillFailed = [
					...new Set([..._outputNameToId.values(), ..._updatedCellIds])
				].some((id) => {
					const c = getCells().find((x) => x.id === id);
					return c && c.cellType !== 'markdown' && c.status === 'error';
				});
				// Detect turns where only inspection tools were called (list_cells, search_workspace, etc.)
				// and no cells have been built yet — used by Fix A (stronger directive) and Fix B (don't
				// honour <done> when the task clearly still requires building cells).
				const INSPECTION_PREFIXES = ['**Cells:', '**Search:', '**Lineage:', '**Search unavailable'];
				const allResultsAreInspection =
					allToolResults.length > 0 &&
					allToolResults.every((r) => INSPECTION_PREFIXES.some((p) => r.startsWith(p)));
				const inspectionOnlyWithNoCells = allResultsAreInspection && _outputNameToId.size === 0;
				// Don't honour <done> if run_cells or get_cell_result fired this turn — the model
				// may have emitted <done> before the tool call in the same chunk (server flushes
				// done-blocks before tool-calls), causing signalledDone=true even though the model
				// hasn't seen the results yet. run_cells is not in DATA_TOOL_NAMES so hadDataToolCalls
				// doesn't catch it.
				const hadRunCells = allToolResults.some((r) => r.startsWith('run_cells result:'));
				const hadGetCellResult = allToolResults.some((r) => r.startsWith('get_cell_result('));
				if (
					signalledDone &&
					!hasRunErrors &&
					!hasUnrunCells &&
					!hadDataToolCalls &&
					!hadRunCells &&
					!hadGetCellResult &&
					!anyCellStillFailed &&
					!inspectionOnlyWithNoCells
				)
					break;

				// No tool calls at all — agent is done or stalled
				if (allToolResults.length === 0) {
					if (!signalledDone && depth === 0) {
						// First turn: model emitted only text/plan without calling any tools.
						agentInjection = {
							role: 'user',
							content:
								'You described a plan but did not call any tools. Execute it now: call sample_data to investigate the data, then create_cell, run_cells, and pick_chart to build the notebook.'
						};
						depth++;
						continue;
					}

					// Check which created/updated cells currently have error status.
					// Using actual cell state (not allToolResults) so this stays accurate across
					// multiple consecutive prose-only stalls during error correction.
					const failedCells = [...new Set([..._outputNameToId.values(), ..._updatedCellIds])]
						.map((id) => getCells().find((c) => c.id === id))
						.filter(
							(c): c is NonNullable<typeof c> =>
								!!c && c.cellType !== 'markdown' && c.status === 'error'
						);

					// Error stall recovery — up to 4 nudges, each re-includes the error details.
					if (failedCells.length > 0 && errorStallRetries < 4) {
						// Use current cell names from failedCells — lastErrorDetails may reference
						// an old name if the model renamed the cell as part of its fix attempt.
						const details = failedCells
							.map((c) => {
								const match = lastErrorDetails.find((d) => d.startsWith(`${c.outputName}:`));
								return (
									match ?? `${c.outputName}: RUN FAILED — (call run_cells to see current error)`
								);
							})
							.join('\n');
						const errorHint = lastErrorDetails
							.slice(0, 2)
							.map((d) => d.slice(0, 200))
							.join('\n');
						agentInjection = {
							role: 'user',
							content: `These cells still have SQL errors — fix them by calling update_cell then run_cells:\n${details}\n\nLast errors:\n${errorHint}\n\nCall update_cell(cellId="<outputName>", code="<corrected SQL>") for each failing cell. Do NOT respond with prose only.`
						};
						errorStallRetries++;
						depth++;
						continue;
					}

					// Data tool failed (table not found) — nudge the model to use the correct table name.
					if (prevHadDataErrors) {
						agentInjection = {
							role: 'user',
							content:
								'The data investigation failed because the requested table was not found. Check the Schema section for the exact available table names and call sample_data again with the correct name. Do not respond with prose only — call the tools now.'
						};
						prevHadDataErrors = false;
						depth++;
						continue;
					}

					// Mid-task stall: model produced prose only at depth > 0, no errors, no <done>.
					// Three cases:
					//   A) Cells exist → model described visualization but didn't call pick_chart/<done>
					//   B) No cells yet but previous turn had data tool calls → model investigated
					//      source data then stalled instead of proceeding to create cells (Step 0 gap)
					//   C) No cells, no data tool calls → model produced prose/wrong-format tool call
					//      (e.g. raw {"sql":...} instead of <tool_call>{"tool":"query_data",...}])
					// Allow up to MAX_MID_TASK_STALL_RETRIES nudges; counter resets on productive turns
					// so a stall → recovery → work → stall sequence still gets nudged the second time.
					const hasCells = _outputNameToId.size > 0;
					if (
						!signalledDone &&
						midTaskStallRetries < MAX_MID_TASK_STALL_RETRIES &&
						failedCells.length === 0
					) {
						let nudgeContent: string;
						if (hasCells) {
							const unchartedNames = [..._outputNameToId.values()]
								.filter((id) => !_chartedCellIds.has(id))
								.map((id) => getCells().find((c) => c.id === id)?.outputName ?? id)
								.filter(
									(name) => getCells().find((c) => c.outputName === name)?.cellType !== 'markdown'
								);
							nudgeContent =
								unchartedNames.length > 0
									? `You stopped mid-task. Complete these steps in order: (1) call create_cell with cellType:"markdown", outputName:"findings" to write a findings summary, (2) call pick_chart for each query cell: ${unchartedNames.join(', ')}, (3) output <done> with follow-up suggestions. Do not respond with prose only — call the tools now.`
									: 'You stopped mid-task without signalling completion. Write a findings markdown cell (create_cell cellType:"markdown", outputName:"findings") then output <done> with follow-up suggestions.';
						} else if (prevHadDataToolCalls) {
							nudgeContent =
								'You investigated the source data but have not built any cells yet. Proceed now: call list_cells and search_workspace (Step 1 — Discover), then create_cell for each model (Step 2 — Build), run_cells (Step 4 — Validate), and pick_chart. Do not respond with prose only — call the tools.';
						} else {
							nudgeContent =
								'You have not called any tools. Use the exact <tool_call> format from the instructions — do NOT output raw JSON or prose descriptions of tool calls. Required format:\n<tool_call>{"tool":"query_data","callId":"D1","args":{"sql":"SELECT ..."}}</tool_call>\nCall sample_data or query_data to investigate the data, then create_cell, run_cells, and pick_chart.';
						}
						agentInjection = { role: 'user', content: nudgeContent };
						midTaskStallRetries++;
						depth++;
						continue;
					}
					break;
				}

				prevHadDataToolCalls = hadDataToolCalls;
				// Model made productive tool calls — reset mid-task stall counter so future stalls
				// after productive work still get recovery nudges (not just the very first one).
				midTaskStallRetries = 0;

				// Feed the latest tool results back to the LLM so it can verify and self-correct.
				// We replace (not accumulate) to keep prompt size stable across iterations.
				const errorLines = allToolResults.filter((r) => r.includes(': RUN FAILED —'));
				const dataErrorLines = allToolResults.filter((r) =>
					/^(?:sample_data|query_data|profile_column) failed:/.test(r)
				);
				// Persist the most recent error lines so stall recovery nudges can re-surface them
				// even when the model stalls (allToolResults empty) in a subsequent iteration.
				if (errorLines.length > 0) lastErrorDetails = errorLines;
				prevHadDataErrors = dataErrorLines.length > 0;

				let directive: string;
				if (allResultsAreInspection && _outputNameToId.size === 0) {
					directive =
						'Discovery complete. Now BUILD the analysis: call sample_data on the most relevant table ' +
						'(or query_data for a quick overview), then create_cell for each model you need, run_cells ' +
						'to validate, and pick_chart to visualise results. Do not respond with prose only — call the tools now.';
				} else if (hadDataToolCalls && _outputNameToId.size === 0) {
					// Data investigation complete but no cells built yet — strong "build now" directive prevents
					// the model from stalling after sample_data/query_data/profile_column stops the stream.
					directive =
						'Data investigation complete. Now build the analysis: call create_cell for each model you need ' +
						'(using the actual data structure shown above), then run_cells to validate, and pick_chart to visualise. ' +
						'Do not respond with prose only — call the tools now.';
				} else if (
					((hadRunCells && !hasRunErrors) || hadGetCellResult) &&
					_outputNameToId.size > 0
				) {
					// run_cells succeeded or cell data retrieved — tell model to chart and finish.
					const uncharted = [..._outputNameToId.values()]
						.filter((id) => !_chartedCellIds.has(id))
						.map((id) => getCells().find((c) => c.id === id)?.outputName ?? id)
						.filter(
							(name) => getCells().find((c) => c.outputName === name)?.cellType !== 'markdown'
						);
					const prefix = hadRunCells ? 'Cells ran successfully' : 'Cell data retrieved';
					directive =
						uncharted.length > 0
							? `${prefix}. Now: (1) write a findings markdown cell (cellType:"markdown", outputName:"findings") documenting what was built and any data quality observations, (2) call pick_chart for: ${uncharted.join(', ')}, (3) output <done> with 3 follow-up suggestions.`
							: `${prefix}. Now write a findings markdown cell (cellType:"markdown", outputName:"findings") documenting what was built and any data quality observations, then output <done> with 3 follow-up suggestions.`;
				} else {
					directive = 'Continue based on these results.';
				}
				if (errorLines.length > 0) {
					const failingNames = errorLines.map((l) => l.split(':')[0]).join(', ');
					// Do not repeat errorLines here — they are already shown in Tool results above.
					// Redundant SQL/schema blocks in the directive caused the model to interpret
					// error results as "SQL snippet output" and miss the RUN FAILED signal.
					directive = `The cells above show RUN FAILED. You MUST fix them:\n1. Call update_cell(cellId="<name>", code="<corrected SQL>") for each failing cell: ${failingNames}\n2. Then call run_cells([${failingNames}]) to verify the fix.\nDo NOT assume a cell works until run_cells reports success rows. Do NOT output <done> until all cells succeed.`;
					// If the error text contains backticks, hint the model about DuckDB identifier syntax
					if (errorLines.some((l) => l.includes('`'))) {
						directive +=
							'\n⚠ Hint: DuckDB does not support backtick identifiers. Replace every `name` with "name" (double-quotes).';
					}
				} else if (dataErrorLines.length > 0) {
					directive = `Data investigation failed — the requested table(s) were not found. Check the Schema section above for exact table names and call sample_data again with the correct name.`;
				} else if (hasUnrunCells) {
					const names = [...new Set([...createdButNotRun, ...updatedButNotRun])]
						.map((id) => getCells().find((c) => c.id === id)?.outputName ?? id)
						.join(', ');
					directive = `Cells were created/updated but NOT run: ${names}. Calling update_cell does NOT verify correctness — you MUST call run_cells([${names}]) now to confirm they work.`;
				}
				agentInjection = {
					role: 'user',
					content: `Tool results:\n\n${allToolResults.join('\n\n---\n\n')}\n\n${directive}`
				};

				depth++;
			}

			// If loop ended with cells still in error state, emit a human-readable message
			const stillFailed = [...new Set([..._outputNameToId.values(), ..._updatedCellIds])]
				.map((id) => getCells().find((c) => c.id === id))
				.filter(
					(c): c is NonNullable<typeof c> =>
						!!c && c.cellType !== 'markdown' && c.status === 'error'
				);
			if (stillFailed.length > 0) {
				const details = stillFailed
					.map((c) => {
						const errMsg = c.errors?.[0]?.display ?? c.errors?.[0]?.reason ?? 'unknown error';
						return `- \`${c.outputName}\`: ${errMsg}`;
					})
					.join('\n');
				updateMessageText(
					aiMsg.id,
					`\n\n⚠ Couldn't fix all SQL errors after multiple attempts. These cells still have errors:\n${details}\n\nTry asking me to use a different approach, or fix them manually.`
				);
				setMessageError(aiMsg.id);
			}
		} // end else (standard loop)
	} catch (err) {
		if (!(err instanceof Error && err.name === 'AbortError')) {
			appendErrorMessage(err instanceof Error ? err.message : 'Unknown error');
		}
	} finally {
		// Auto-run any query cells created this generation that the model forgot to run.
		// Await real completion so (a) results exist before we auto-chart below, and
		// (b) undo isn't enabled mid-run — the old fire-and-forget `void runCell()` raced
		// the snapshot/undo path and could leave the UI in an inconsistent state.
		await Promise.all(
			[..._outputNameToId.values()]
				.filter((cellId) => !_alreadyRanIds.has(cellId))
				.map((cellId) => {
					const cell = getCells().find((c) => c.id === cellId);
					if (!cell || cell.cellType === 'markdown') return Promise.resolve();
					_alreadyRanIds.add(cellId);
					return runCell(cellId).catch(() => {
						/* error surfaced via cell.status */
					});
				})
		);

		const allCells = getCells();

		// Auto-configure charts for query cells the model didn't chart (created + updated).
		// Infer from the ACTUAL result columns (not a SQL-text guess) and only switch to
		// chart view when those columns exist in the result — otherwise leave the table
		// visible. The old SQL-text inference produced configs whose columns didn't match
		// the result, so the cell flickered to an empty chart the moment generation ended.
		const cellsToAutoChart = new Set([..._outputNameToId.values(), ..._updatedCellIds]);
		for (const cellId of cellsToAutoChart) {
			if (_chartedCellIds.has(cellId)) continue;
			const cell = allCells.find((c) => c.id === cellId);
			if (!cell || cell.cellType === 'markdown') continue;
			const cols = cell.result?.columns;
			if (!cols || cols.length === 0) continue;
			const chart = inferChartFromColumns(cols, cell.result?.rows ?? []);
			if (chart && cols.includes(chart.xColumn) && chart.yColumns.every((y) => cols.includes(y))) {
				setCellResultChartConfig(cellId, chart);
				setCellResultViewMode(cellId, 'chart');
				_madeNotebookChanges = true;
			}
		}

		// Trigger background embedding for newly created/updated cells
		const notebookId = getActiveTabId();
		const cellsToEmbed = [..._outputNameToId.entries()]
			.map(([outputName, cellId]) => {
				const cell = allCells.find((c) => c.id === cellId);
				return cell && cell.cellType !== 'markdown'
					? { notebookId, cellId, outputName, code: cell.code }
					: null;
			})
			.filter(
				(x): x is { notebookId: string; cellId: string; outputName: string; code: string } =>
					x !== null
			);
		if (cellsToEmbed.length > 0) {
			void fetch('/api/ai/embed', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(cellsToEmbed)
			}).catch(() => {});
		}

		clearGhostCells();
		setMessageStreaming(aiMsg.id, false);
		setIsGenerating(false);
		setActiveController(null);
		// Only enable undo when the AI actually mutated the notebook (created/updated/deleted
		// cells, ran queries, configured charts). Pure text answers leave _madeNotebookChanges
		// false so the "AI changes applied" bar never appears for read-only responses.
		if (!didCancel) setUndoAvailable(_madeNotebookChanges);
		// Resolve any dangling confirmation request (e.g., if generation was aborted)
		resolveConfirmation(false);
		emitAgentTelemetry({ type: 'loop_end', metadata: { didCancel } });
		void flushAgentTelemetry();
	}
}
