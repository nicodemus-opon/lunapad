// Shared client-side execution for the 5 read-only investigation tools (sample_data,
// profile_column, get_cell_result, get_lineage, search_workspace). Notebook/connection state
// lives only in the browser store, so these always run client-side regardless of which surface
// (sidebar chat agent or inline ⌘⇧K agent) requested them — see `$lib/server/ai-tools.ts` for
// the matching tool schemas sent to the LLM.

import { executeSQL } from '$lib/services/duckdb.js';
import { queryConnectionSQL } from '$lib/services/connections.js';
import {
	getCells,
	getTables,
	getExternalSchemaTables,
	getConnections,
	getCellConnection,
	compilePRQLCached,
	getActiveTabId,
	getProjectFolder,
	AUTO_LIMIT,
	type Cell
} from '$lib/stores/notebook.svelte.js';
import {
	buildExecutionCode,
	buildSQLExecutionCode,
	resolvePythonDataRefs
} from '$lib/services/cell-deps.js';
import {
	runPython,
	watchPythonLogs,
	cancelPython,
	isPythonWorkerWarm,
	type PythonTablePayload
} from '$lib/services/python-client.js';
import { rowsToCsv } from '$lib/utils.js';
import {
	type Connection,
	BUILTIN_DUCKDB_CONNECTION,
	BUILTIN_DUCKDB_CONNECTION_ID,
	isBuiltinDuckDBConnection,
	getPRQLTargetForConnection
} from '$lib/types/connection.js';
import type { ReadonlyInvestigationToolName } from '$lib/server/ai-tools.js';

export interface InvestigationToolCall {
	tool: ReadonlyInvestigationToolName;
	args: Record<string, unknown>;
}

export interface InvestigationToolResult {
	/** Markdown/CSV text to feed back to the LLM as the tool result. */
	text: string;
	/** Short activity label for UI display (e.g. "Sampled orders -> 10 rows"). */
	label: string;
}

export function quoteIdent(name: string): string {
	if (name.includes('.')) {
		return name
			.split('.')
			.map((p) => `"${p.replace(/"/g, '""')}"`)
			.join('.');
	}
	return `"${name.replace(/"/g, '""')}"`;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toMarkdownTable(columns: string[], rows: Record<string, unknown>[]): string {
	if (rows.length === 0) return '(no rows)';
	const header = `| ${columns.join(' | ')} |`;
	const sep = `| ${columns.map(() => '---').join(' | ')} |`;
	const data = rows
		.slice(0, 15)
		.map((r) => `| ${columns.map((c) => String(r[c] ?? '')).join(' | ')} |`);
	return [header, sep, ...data].join('\n');
}

export function getDefaultConnection(): { isBuiltin: boolean; connection: Connection } {
	const cells = getCells();
	const connections = getConnections();
	const externalId = cells.find(
		(c) => c.connectionId && c.connectionId !== BUILTIN_DUCKDB_CONNECTION_ID
	)?.connectionId;
	if (externalId) {
		const conn = connections.find((c) => c.id === externalId);
		if (conn && !isBuiltinDuckDBConnection(conn)) {
			return { isBuiltin: false, connection: conn };
		}
	}
	return { isBuiltin: true, connection: BUILTIN_DUCKDB_CONNECTION };
}

// Resolves the connection a specific table actually lives on, rather than guessing from
// notebook cells — without this, a table lookup would silently run against DuckDB whenever
// the notebook's cells happened not to reveal an external connection.
export function getConnectionForTable(
	table: string
): { isBuiltin: boolean; connection: Connection } | null {
	const norm = (s: string) => s.toLowerCase().replace(/^"(.+)"$/, '$1');
	const target = norm(table);
	const match = getExternalSchemaTables().find((t) => {
		const qualified = t.schema ? `${t.schema}.${t.name}` : t.name;
		return norm(qualified) === target || norm(t.name) === target;
	});
	if (!match) return null;
	const conn = getConnections().find((c) => c.id === match.connectionId);
	if (!conn) return null;
	return { isBuiltin: false, connection: conn };
}

export async function runRawQuery(
	sql: string,
	table?: string
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
	const { isBuiltin, connection } =
		(table && getConnectionForTable(table)) || getDefaultConnection();
	if (isBuiltin) return executeSQL(sql);
	return queryConnectionSQL(connection, sql);
}

export function knownTableNames(): string[] {
	const local = getTables().map((t) => t.name);
	const external = getExternalSchemaTables().map((t) =>
		t.schema ? `${t.schema}.${t.name}` : t.name
	);
	return [...local, ...external];
}

export function assertKnownTable(table: string): string | null {
	const known = knownTableNames();
	if (known.length === 0) return 'No tables are loaded — upload data first.';
	const norm = (s: string) => s.toLowerCase().replace(/^"(.+)"$/, '$1');
	if (known.some((n) => norm(n) === norm(table))) return null;
	return `Table "${table}" not found. Available tables: ${known.slice(0, 10).join(', ')}`;
}

export function resolveCellId(ref: string): string | null {
	const cells = getCells();
	const byId = cells.find((c) => c.id === ref);
	if (byId) return byId.id;
	const byName = cells.find((c) => c.outputName === ref);
	if (byName) return byName.id;
	return null;
}

// Resolves a notebook cell (by outputName) into runnable SQL with its own upstream
// deps inlined as CTEs — the same resolution `Run cell` uses. Needed because
// `sample_data`/`profile_column` accept a `table` name from the LLM, and in most
// notebooks the "table" it means is actually an un-promoted cell (e.g. `orders` in
// the .luna demo notebooks), not a physical/external table `assertKnownTable` knows
// about. Without this, those tools always fail with "Unknown table" for any cell
// that hasn't been promoted to a real dbt model.
export function resolveCellSourceSQL(
	outputName: string
): { sql: string; isBuiltin: boolean; connection: Connection } | { error: string } {
	const cells = getCells();
	const idx = cells.findIndex((c) => c.outputName === outputName && c.cellType === 'query');
	if (idx === -1) return { error: `Cell '${outputName}' not found` };
	const cell = cells[idx];
	const connection = getCellConnection(cell);
	const isBuiltin = isBuiltinDuckDBConnection(connection);
	const target = getPRQLTargetForConnection(connection);
	const compile = (prql: string): string | null => compilePRQLCached(prql, target).sql;

	let sql: string | null;
	if (cell.language === 'sql') {
		sql = buildSQLExecutionCode(cells, idx, compile);
	} else {
		const fullPrql = buildExecutionCode(cells, idx);
		const compiled = compilePRQLCached(fullPrql, target);
		if (compiled.errors.length > 0 || !compiled.sql) {
			return {
				error:
					compiled.errors.map((e) => e.display ?? e.reason).join('; ') || 'PRQL compile error'
			};
		}
		sql = compiled.sql;
	}
	if (!sql) return { error: 'Could not build execution SQL for cell' };
	return { sql, isBuiltin, connection };
}

export async function executeInvestigationTool(
	call: InvestigationToolCall
): Promise<InvestigationToolResult> {
	try {
		switch (call.tool) {
			case 'sample_data': {
				const table = String(call.args.table ?? '');
				const n = Math.min(Number(call.args.n ?? 10) || 10, 50);
				const tableError = assertKnownTable(table);
				let fromExpr: string;
				let isBuiltin: boolean;
				let connection: Connection;
				if (tableError) {
					const cellSrc = resolveCellSourceSQL(table);
					if ('error' in cellSrc)
						return { text: `sample_data failed: ${tableError}`, label: `Unknown table: ${table}` };
					fromExpr = `(\n${cellSrc.sql}\n) AS _src`;
					isBuiltin = cellSrc.isBuiltin;
					connection = cellSrc.connection;
				} else {
					({ isBuiltin, connection } = getConnectionForTable(table) ?? getDefaultConnection());
					fromExpr = quoteIdent(table);
				}
				const sampleSql = isBuiltin
					? `SELECT * FROM ${fromExpr} USING SAMPLE ${n} ROWS`
					: connection.type === 'clickhouse'
						? `SELECT * FROM ${fromExpr} ORDER BY rand() LIMIT ${n}`
						: `SELECT * FROM ${fromExpr} ORDER BY RANDOM() LIMIT ${n}`;
				const result = isBuiltin
					? await executeSQL(sampleSql)
					: await queryConnectionSQL(connection, sampleSql);
				const csv = rowsToCsv(result.columns, result.rows);
				return {
					text: `sample_data(${table}, ${n}) -> ${result.rows.length} rows:\n${csv}`,
					label: `Sampled ${table} -> ${result.rows.length} rows`
				};
			}
			case 'profile_column': {
				const table = String(call.args.table ?? '');
				const column = String(call.args.column ?? '');
				const tableError = assertKnownTable(table);
				let fromExpr: string;
				let isBuiltin: boolean;
				let connection: Connection;
				if (tableError) {
					const cellSrc = resolveCellSourceSQL(table);
					if ('error' in cellSrc)
						return {
							text: `profile_column failed: ${tableError}`,
							label: `Unknown table: ${table}`
						};
					fromExpr = `(\n${cellSrc.sql}\n) AS _src`;
					isBuiltin = cellSrc.isBuiltin;
					connection = cellSrc.connection;
				} else {
					({ isBuiltin, connection } = getConnectionForTable(table) ?? getDefaultConnection());
					fromExpr = quoteIdent(table);
				}
				const qCol = quoteIdent(column);
				const runProfileQuery = (sql: string) =>
					isBuiltin ? executeSQL(sql) : queryConnectionSQL(connection, sql);
				const [nullRes, statsRes, topRes] = await Promise.all([
					runProfileQuery(
						`SELECT COUNT(*) AS _total, COUNT(${qCol}) AS _non_null FROM ${fromExpr}`
					),
					runProfileQuery(
						`SELECT MIN(${qCol}) AS _min, MAX(${qCol}) AS _max, COUNT(DISTINCT ${qCol}) AS _distinct FROM ${fromExpr}`
					),
					runProfileQuery(
						`SELECT ${qCol} AS _val, COUNT(*) AS _cnt FROM ${fromExpr} WHERE ${qCol} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`
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
					text: `profile_column(${table}.${column}): ${statsText}`,
					label: `Profiled ${table}.${column}`
				};
			}
			case 'get_cell_result': {
				const cellId = String(call.args.cellId ?? '');
				const limit = Math.min(Number(call.args.limit ?? 50) || 50, 100);
				const resolvedId = resolveCellId(cellId);
				const cell = getCells().find((c) => c.id === (resolvedId ?? cellId));
				if (!cell?.result?.rows?.length) {
					if (cell?.errors?.length) {
						const errMsg = cell.errors.map((e) => e.display ?? e.reason).join('\n');
						return {
							text: `Cell \`${cell.outputName ?? cellId}\` is in error state:\n${errMsg}`,
							label: `${cell.outputName ?? cellId}: error`
						};
					}
					return {
						text: `Cell \`${cellId}\`: no result data — not run yet`,
						label: `${cellId}: no result`
					};
				}
				const rows = cell.result.rows.slice(0, limit);
				const csv = rowsToCsv(cell.result.columns, rows);
				return {
					text: `get_cell_result(${cell.outputName}): ${cell.result.rows.length} rows, columns: ${cell.result.columns.join(', ')}\n${csv}`,
					label: `Read ${cell.outputName} -> ${cell.result.rows.length} rows`
				};
			}
			case 'get_lineage': {
				const outputName = String(call.args.outputName ?? '');
				const cells = getCells();
				const re = new RegExp(`\\b${escapeRegExp(outputName)}\\b`);
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
				const downstream = cells
					.filter((c) => c.outputName !== outputName && re.test(c.code))
					.map((c) => c.outputName);
				if (!target) {
					return {
						text: `Lineage: \`${outputName}\` not found in notebook`,
						label: `${outputName}: not found`
					};
				}
				return {
					text: `Lineage of \`${outputName}\`:\n- Upstream: ${upstream.join(', ') || 'none'}\n- Downstream: ${downstream.join(', ') || 'none'}`,
					label: `Lineage: ${outputName}`
				};
			}
			case 'search_workspace': {
				const query = String(call.args.query ?? '');
				try {
					const res = await fetch('/api/ai/search', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ query, folder: getProjectFolder() ?? undefined })
					});
					if (!res.ok) throw new Error(`search failed: ${res.status}`);
					const data = (await res.json()) as {
						cells: Array<{ output_name: string; code_snippet: string; similarity: number }>;
						tables: Array<{ table_name: string; column_names: string; similarity: number }>;
						memories?: Array<{
							slug: string;
							description: string;
							type: string;
							similarity: number;
						}>;
					};
					const cellLines = data.cells.map((c) =>
						c.code_snippet?.trim()
							? `\`${c.output_name}\` (${(c.similarity * 100).toFixed(0)}% match):\n\`\`\`sql\n${c.code_snippet.trim()}\n\`\`\``
							: `\`${c.output_name}\` (${(c.similarity * 100).toFixed(0)}% match)`
					);
					const tableLines = data.tables.map((t) => `- \`${t.table_name}\`: ${t.column_names}`);
					const memoryLines = (data.memories ?? []).map((m) => `- (${m.type}) ${m.description}`);
					const text =
						`Search "${query}":\n` +
						(cellLines.length ? `Relevant cells:\n${cellLines.join('\n\n')}\n` : '') +
						(tableLines.length ? `Relevant tables:\n${tableLines.join('\n')}\n` : '') +
						(memoryLines.length
							? `Relevant past decisions/discoveries:\n${memoryLines.join('\n')}\n`
							: '') +
						(!cellLines.length && !tableLines.length && !memoryLines.length
							? 'No matches found.\n'
							: '');
					return { text, label: `Searched "${query}"` };
				} catch {
					return {
						text: 'search_workspace unavailable — vector index not set up yet. Use get_lineage instead.',
						label: 'Search unavailable'
					};
				}
			}
			default:
				return { text: `Unknown tool: ${call.tool}`, label: `Unknown tool` };
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Tool failed';
		return { text: `${call.tool} failed: ${msg}`, label: `Failed: ${msg.slice(0, 50)}` };
	}
}

// ── Trial execution (self-correction) ──────────────────────────────────────────
// Actually runs candidate code with upstream deps resolved exactly like a real
// "Run cell" would, but without writing to cell.result/cell.status or registering
// any tables/views — used by the inline ⌘⇧K agent to catch real runtime errors
// (not just PRQL static-compile errors) before handing code back to the user.

export interface TrialRunResult {
	ok: boolean;
	error?: string;
	rows?: Record<string, unknown>[];
	columns?: string[];
}

function wrapForTrial(sql: string): string {
	if (/\bLIMIT\s+\d+/i.test(sql)) return sql;
	return `SELECT * FROM (${sql}) _trial LIMIT 5`;
}

async function trialRunQuery(
	cellId: string,
	candidateCode: string,
	language: 'prql' | 'sql'
): Promise<TrialRunResult> {
	const cells = getCells();
	const idx = cells.findIndex((c) => c.id === cellId);
	if (idx === -1) return { ok: false, error: 'Cell not found' };

	const trialCells: Cell[] = cells.slice();
	trialCells[idx] = { ...cells[idx], code: candidateCode, language };

	const connection = getCellConnection(trialCells[idx]);
	const isBuiltin = isBuiltinDuckDBConnection(connection);
	const target = getPRQLTargetForConnection(connection);
	const compile = (prql: string): string | null => compilePRQLCached(prql, target).sql;

	let sql: string | null;
	if (language === 'sql') {
		sql = buildSQLExecutionCode(trialCells, idx, compile);
	} else {
		const fullPrql = buildExecutionCode(trialCells, idx);
		const compiled = compilePRQLCached(fullPrql, target);
		if (compiled.errors.length > 0 || !compiled.sql) {
			const msg =
				compiled.errors.map((e) => e.display ?? e.reason).join('; ') || 'PRQL compile error';
			return { ok: false, error: msg };
		}
		sql = compiled.sql;
	}
	if (!sql) return { ok: false, error: 'Could not build execution SQL' };

	try {
		const limited = wrapForTrial(sql);
		const TRIAL_TIMEOUT_MS = isBuiltin ? 10_000 : 12_000;
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('Trial run timed out')), TRIAL_TIMEOUT_MS)
		);
		const queryPromise = isBuiltin ? executeSQL(limited) : queryConnectionSQL(connection, limited);
		const result = await Promise.race([queryPromise, timeoutPromise]);
		return { ok: true, rows: result.rows, columns: result.columns };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Query failed' };
	}
}

async function trialRunPython(cellId: string, candidateCode: string): Promise<TrialRunResult> {
	const cells = getCells();
	const idx = cells.findIndex((c) => c.id === cellId);
	if (idx === -1) return { ok: false, error: 'Cell not found' };

	const notebookId = getActiveTabId();
	const warm = await isPythonWorkerWarm(notebookId);
	if (!warm) return { ok: true };

	const trialCells: Cell[] = cells.slice();
	trialCells[idx] = { ...cells[idx], code: candidateCode };

	const deps = resolvePythonDataRefs(trialCells, idx);
	const tables: Record<string, PythonTablePayload> = {};
	for (const dep of deps) {
		if (!dep.result) continue;
		tables[dep.outputName] = {
			rows: dep.result.rows.slice(0, AUTO_LIMIT),
			columns: dep.result.columns
		};
	}

	try {
		const jobId = await runPython(notebookId, candidateCode, tables, [], getProjectFolder());
		return await new Promise<TrialRunResult>((resolve) => {
			const timeout = setTimeout(() => {
				void cancelPython(notebookId, jobId);
				resolve({ ok: false, error: 'Trial run timed out after 20s' });
			}, 20_000);
			watchPythonLogs(
				jobId,
				() => {
					/* discard stdout — not needed for a pass/fail trial */
				},
				(_exitCode, result) => {
					clearTimeout(timeout);
					if (result?.error) {
						resolve({ ok: false, error: result.error });
					} else {
						resolve({
							ok: true,
							rows: result?.dataframe?.rows,
							columns: result?.dataframe?.columns
						});
					}
				}
			);
		});
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Python execution failed' };
	}
}

export async function trialRunCandidateCode(
	cellId: string,
	candidateCode: string,
	cellType: 'query' | 'python',
	language?: 'prql' | 'sql'
): Promise<TrialRunResult> {
	if (cellType === 'python') return trialRunPython(cellId, candidateCode);
	return trialRunQuery(cellId, candidateCode, language ?? 'sql');
}
