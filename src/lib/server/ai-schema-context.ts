// Shared schema-context helpers. Originally built for the single-turn LLM endpoints
// (`/api/llm/generate-prql`, `/api/ai/edit-cell`) — `rankColumnsByRelevance`/`buildSchemaBlock`
// stay focused on that single-focus-table use case. `selectSchemaForPrompt` (bottom of file) is
// the newer, multi-table token-budgeted selector shared by the agentic chat path
// (`/api/ai/chat`) and `prompt-stage-plan`, replacing what used to be four independent,
// inconsistent positional-truncation implementations.

import type { AIChatSchemaTable } from '$lib/types/ai-chat.js';
import {
	estimateTokens,
	fitToTokenBudget,
	DEFAULT_SCHEMA_TOKEN_BUDGET
} from '$lib/services/token-budget.js';
import { assertSafeOutboundHttpUrl, normalizeSafeLlmBaseUrl } from '$lib/server/safe-outbound-url';
import { hasPostgres, hasOllama } from '$lib/server/ai-capabilities.js';
import {
	countSchemaEmbeddings,
	listSchemaEmbeddings,
	searchSchemaEmbeddings
} from '$lib/server/embeddings.js';

export interface SchemaColumn {
	name: string;
	dataKind: 'numeric' | 'date' | 'boolean' | 'text';
	semanticType?: string;
	sqlType?: string;
	sampleValues?: string[];
	nullRatio?: number;
	distinctCount?: number;
	minVal?: string;
	maxVal?: string;
	p50Val?: string;
	dateGranularity?: string;
	topValues?: Array<{ v: string; pct: number }>;
}

export interface OtherTable {
	name: string;
	columns: string[];
	columnTypes: string[];
}

const DEFAULT_TIMEOUT_MS = 180_000;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 180_000;

export function normalizeTimeoutMs(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(value)));
}

export function normalizeBaseUrl(baseUrl: string): string {
	return normalizeSafeLlmBaseUrl(baseUrl);
}

/** Backtick-quote identifiers with non-identifier characters. Purely informational in the
 *  schema block sent to the model — not the quoting convention of any generated code. */
export function quoteIdent(name: string): string {
	if (!name) return '';
	if (/[^A-Za-z0-9_.]/.test(name)) return `\`${name}\``;
	return name;
}

export function sqlTypeMismatchCast(dataKind: string, sqlType: string | undefined): string | null {
	if (!sqlType) return null;
	const sql = sqlType.toUpperCase();
	if (sql.includes('VARBINARY')) {
		return 'varbinary — use from_utf8(col) for text comparisons; re-save source if column should be varchar';
	}
	if (sql.includes('JSON')) {
		return "json — use json_parse(col) and json_extract_scalar(col, '$.key')";
	}
	if (sql.includes('IPADDRESS') || sql === 'INET') {
		return 'ip address — CAST(col AS VARCHAR) for string comparison';
	}
	if (
		dataKind === 'date' &&
		(sql.includes('VARCHAR') || sql.includes('TEXT') || sql.includes('CHAR'))
	) {
		return 'stored as text — needs CAST(col AS TIMESTAMP) or date_parse(col, format)';
	}
	if (dataKind === 'date' && sql.includes('TIMESTAMP')) {
		return 'timestamp — CAST(col AS DATE) for date-only comparison';
	}
	if (
		dataKind === 'numeric' &&
		(sql.includes('VARCHAR') || sql.includes('TEXT') || sql.includes('CHAR'))
	) {
		return 'stored as text — needs CAST(col AS DOUBLE) or try_cast';
	}
	return null;
}

export function buildSchemaBlock(
	sourceTable: string,
	columns: SchemaColumn[],
	otherTables?: OtherTable[],
	/** Language-specific cast guidance (e.g. PRQL s-string syntax vs generic). Defaults to a
	 *  generic hint; callers needing language-specific phrasing pass their own. */
	castNoteFn: (dataKind: string, sqlType: string | undefined) => string | null = sqlTypeMismatchCast
): string {
	const colLines = columns.map((col) => {
		const typePart = `${col.dataKind}${col.semanticType ? `/${col.semanticType}` : ''}${col.sqlType ? `, sql:${col.sqlType}` : ''}`;
		const castNote = castNoteFn(col.dataKind, col.sqlType);
		const extras: string[] = [];

		if (col.minVal != null && col.maxVal != null) {
			extras.push(`range: ${col.minVal}–${col.maxVal}`);
		} else if (col.sampleValues && col.sampleValues.length > 0) {
			extras.push(
				`samples: ${col.sampleValues
					.slice(0, 4)
					.map((v) => JSON.stringify(v))
					.join(', ')}`
			);
		}

		if (col.p50Val != null) extras.push(`median: ${col.p50Val}`);
		if (col.dateGranularity) extras.push(`granularity: ${col.dateGranularity}`);

		if (col.topValues && col.topValues.length > 0) {
			const topStr = col.topValues
				.slice(0, 5)
				.map((t) => `${JSON.stringify(t.v)}(${Math.round(t.pct * 100)}%)`)
				.join(', ');
			extras.push(`top: ${topStr}`);
		}

		if (castNote) extras.unshift(`⚠ ${castNote}`);
		const detail = extras.length > 0 ? ` — ${extras.join(', ')}` : '';
		return `  ${quoteIdent(col.name)} (${typePart})${detail}`;
	});

	const mainTableBlock = [`TABLE: ${sourceTable}`, ...colLines].join('\n');

	if (!otherTables || otherTables.length === 0) return mainTableBlock;

	const otherBlocks = otherTables.map((t) => {
		const typedCols = t.columns
			.map((c, i) => `  ${quoteIdent(c)} (${t.columnTypes[i] ?? 'text'})`)
			.join('\n');
		return `TABLE: ${t.name}\n${typedCols}`;
	});

	return [mainTableBlock, ...otherBlocks].join('\n\n');
}

/** Rank columns by relevance: word overlap + semantic type + kind + distinctCount (grouping) + nullRatio penalty.
 *  Generic over `T extends SchemaColumn` so callers with richer column shapes (e.g.
 *  `prompt-stage-plan`'s `LLMPlanningColumnContext`, which is structurally compatible) get their
 *  original type back rather than being narrowed down to the bare `SchemaColumn` fields. */
export function rankColumnsByRelevance<T extends SchemaColumn>(
	query: string,
	columns: T[],
	maxColumns = 20
): T[] {
	if (columns.length <= maxColumns) return columns;

	const queryTokens = new Set(
		query
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.split(/\s+/)
			.filter((t) => t.length > 1)
	);
	const isGroupingQuery = /(group|by|per|each|breakdown|segment|categor|type|top\s*\d|rank)/i.test(
		query
	);

	const scored = columns.map((col) => {
		const colTokens = col.name
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.split(/\s+/);
		const nameOverlap = colTokens.filter((t) => queryTokens.has(t)).length;
		const semanticBoost =
			col.semanticType && queryTokens.has(col.semanticType.toLowerCase()) ? 1 : 0;
		const kindBoost = col.dataKind === 'numeric' || col.dataKind === 'date' ? 0.5 : 0;

		const distinctCount = col.distinctCount ?? 0;
		const nullRatio = col.nullRatio ?? 0;
		const distinctBoost = isGroupingQuery && distinctCount > 3 && distinctCount < 500 ? 0.5 : 0;
		const nullPenalty = nullRatio > 0.5 ? -0.5 : nullRatio > 0.3 ? -0.25 : 0;

		return { col, score: nameOverlap + semanticBoost + kindBoost + distinctBoost + nullPenalty };
	});

	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, maxColumns).map((s) => s.col);
}

export interface OpenAIChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
}

/** Single non-streaming chat completion call, shared by both single-turn LLM endpoints. */
export async function callLLMJson(input: {
	completionUrl: string;
	model: string;
	systemPrompt: string;
	userPrompt: string;
	signal: AbortSignal;
	apiKey?: string;
}): Promise<string> {
	const isQwen3 = /qwen3/i.test(input.model ?? '');
	const systemContent = isQwen3 ? input.systemPrompt + '\n/no_think' : input.systemPrompt;

	const response = await fetch(
		assertSafeOutboundHttpUrl(input.completionUrl, { allowLocalhostInDev: true }),
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
			},
			body: JSON.stringify({
				model: input.model,
				temperature: 0.2,
				top_p: 0.9,
				frequency_penalty: 0.0,
				presence_penalty: 0.0,
				stream: false,
				response_format: { type: 'json_object' },
				...(isQwen3 ? { options: { think: false } } : {}),
				messages: [
					{ role: 'system', content: systemContent },
					{ role: 'user', content: input.userPrompt }
				]
			}),
			signal: input.signal
		}
	);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 400)}`);
	}

	const payload = (await response.json()) as OpenAIChatCompletionResponse;
	const content = payload.choices?.[0]?.message?.content ?? '';
	if (!content.trim()) throw new Error('LLM returned empty content');
	return content;
}

// ── Multi-table, token-budgeted schema selection ──────────────────────────────
// Unifies what used to be: `prioritizeSchema` (chat/+server.ts, table-only, cell-reference
// sort), the inline slicing in `buildSystemPromptXML`/`buildSubagentSystemPrompt`
// (chat/+server.ts), and the duplicated `columnRelevanceScore`/`buildContextBlock` ranking in
// prompt-stage-plan/+server.ts. Operates on the bare-name `AIChatSchemaTable` shape (not the
// richer `SchemaColumn` used by `rankColumnsByRelevance` above, which needs profiling data this
// call path doesn't have) — a lighter lexical-overlap score is the right tool here, not a
// regression: short identifiers don't benefit much from the extra profiling signals anyway.

function tokenizeForRelevance(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 1);
}

function tableRelevanceScore(
	queryTokens: Set<string>,
	table: AIChatSchemaTable,
	isActive: boolean
): number {
	const nameTokens = tokenizeForRelevance(table.name);
	const columnTokens = table.columns.flatMap(tokenizeForRelevance);
	const descriptionTokens = table.description ? tokenizeForRelevance(table.description) : [];
	const nameOverlap = nameTokens.filter((t) => queryTokens.has(t)).length * 2;
	const columnOverlap = columnTokens.filter((t) => queryTokens.has(t)).length;
	const descriptionOverlap = descriptionTokens.filter((t) => queryTokens.has(t)).length;
	// Tables already wired into the notebook are known-relevant regardless of lexical match —
	// mirrors the signal the old `prioritizeSchema` used as its only ranking criterion.
	const activeBoost = isActive ? 5 : 0;
	return nameOverlap + columnOverlap + descriptionOverlap + activeBoost;
}

/** Returns the indices of the top `maxColumns` columns by relevance, in their original order —
 *  callers use these indices to trim parallel arrays (columns, columnTypes) in lock-step. */
function selectColumnIndicesByRelevance(
	queryTokens: Set<string>,
	columns: string[],
	maxColumns: number
): number[] {
	if (columns.length <= maxColumns) return columns.map((_, idx) => idx);
	return columns
		.map((name, idx) => ({
			idx,
			score: tokenizeForRelevance(name).filter((t) => queryTokens.has(t)).length
		}))
		.sort((a, b) => b.score - a.score || a.idx - b.idx)
		.slice(0, maxColumns)
		.sort((a, b) => a.idx - b.idx)
		.map((c) => c.idx);
}

function approximateTableText(table: AIChatSchemaTable): string {
	return `${table.name}${table.description ? ' — ' + table.description : ''} columns: ${table.columns.join(', ')}`;
}

export interface SchemaSelectionInput {
	/** Latest user message / instruction the schema is being selected for. */
	query: string;
	tables: AIChatSchemaTable[];
	tokenBudget: number;
	/** Soft cap on table count, applied after token budgeting. Default 40 (matches the historical window size). */
	maxTables?: number;
	maxColumnsPerTable?: number;
	/** Table names (case-insensitive) already referenced in existing cell code. */
	activeTableNames?: Set<string>;
}

export function selectSchemaForPrompt(input: SchemaSelectionInput): AIChatSchemaTable[] {
	const {
		query,
		tables,
		tokenBudget,
		maxTables = 40,
		maxColumnsPerTable = 30,
		activeTableNames
	} = input;
	if (tables.length === 0) return [];

	const queryTokens = new Set(tokenizeForRelevance(query));
	const ranked = tables
		.map((table, idx) => ({
			table,
			idx,
			score: tableRelevanceScore(
				queryTokens,
				table,
				activeTableNames?.has(table.name.toLowerCase()) ?? false
			)
		}))
		.sort((a, b) => b.score - a.score || a.idx - b.idx)
		.map((r) => r.table);

	const { kept } = fitToTokenBudget(ranked, tokenBudget, (t) =>
		estimateTokens(approximateTableText(t))
	);
	return kept.slice(0, maxTables).map((table) => {
		const indices = selectColumnIndicesByRelevance(queryTokens, table.columns, maxColumnsPerTable);
		return {
			...table,
			columns: indices.map((i) => table.columns[i]),
			columnTypes: table.columnTypes ? indices.map((i) => table.columnTypes![i]) : undefined
		};
	});
}

// ── External warehouse catalog retrieval ──────────────────────────────────────
// Two-stage retrieval over the warehouse catalog, used by `/api/ai/chat` ahead of
// `selectSchemaForPrompt` above. Below a table-count threshold, a Postgres+Ollama round trip
// isn't worth it — the cheap lexical selector already does a fine job ranking a few dozen
// tables. Above it, semantic search over the (already populated, see `/api/ai/embed-schema`)
// `schema_embeddings` index narrows thousands of tables down to the handful actually relevant
// to the user's latest message. Always falls back to whatever the client already had on hand
// (`fallback`) when Postgres/Ollama aren't available — retrieval must never block chat.

const RETRIEVAL_TABLE_COUNT_THRESHOLD = 80;
const RETRIEVAL_LIMIT = 40;
const TABLE_COUNT_CACHE_TTL_MS = 60_000;
const _tableCountCache = new Map<string, { count: number; checkedAt: number }>();

async function cachedSchemaEmbeddingCount(connectionIds: string[]): Promise<number> {
	const key = [...connectionIds].sort().join(',');
	const cached = _tableCountCache.get(key);
	if (cached && Date.now() - cached.checkedAt < TABLE_COUNT_CACHE_TTL_MS) return cached.count;
	const count = await countSchemaEmbeddings(connectionIds);
	_tableCountCache.set(key, { count, checkedAt: Date.now() });
	return count;
}

/** Test-only escape hatch — the table-count cache is module-level and otherwise leaks between
 *  test cases that reuse the same connectionIds. */
export function _resetTableCountCacheForTests(): void {
	_tableCountCache.clear();
}

function schemaEmbeddingRowToTable(row: {
	table_name: string;
	column_names: string;
	column_types: string | null;
}): AIChatSchemaTable {
	return {
		name: row.table_name,
		columns: row.column_names.split(', ').filter(Boolean),
		columnTypes: row.column_types ? row.column_types.split(', ').filter(Boolean) : undefined
	};
}

export async function resolveExternalSchema(input: {
	connectionIds: string[];
	userQuery: string;
	fallback: AIChatSchemaTable[];
}): Promise<AIChatSchemaTable[]> {
	const { connectionIds, userQuery, fallback } = input;
	if (connectionIds.length === 0) return [];

	if (!(await hasPostgres()) || !(await hasOllama())) {
		return fallback;
	}

	const tableCount = await cachedSchemaEmbeddingCount(connectionIds);
	if (tableCount === 0) {
		// Nothing embedded yet for these connections (first backfill still in flight, or
		// Postgres/Ollama only just became available) — fall back rather than return empty.
		return fallback;
	}

	if (tableCount < RETRIEVAL_TABLE_COUNT_THRESHOLD) {
		const rows = await listSchemaEmbeddings(connectionIds);
		const tables = rows.map(schemaEmbeddingRowToTable);
		return selectSchemaForPrompt({
			query: userQuery,
			tables,
			tokenBudget: DEFAULT_SCHEMA_TOKEN_BUDGET,
			maxTables: RETRIEVAL_LIMIT
		});
	}

	const matches = await searchSchemaEmbeddings(userQuery, RETRIEVAL_LIMIT, connectionIds);
	if (matches.length === 0) return fallback;
	return matches.map(schemaEmbeddingRowToTable);
}
