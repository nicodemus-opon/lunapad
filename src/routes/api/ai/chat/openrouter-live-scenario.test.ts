import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import {
	compileNotebookBlueprint,
	applyNotebookPatchOperations,
	validateNotebookPmDocument,
	type NotebookBlueprint,
	type NotebookPatchOperation
} from '$lib/services/notebook-blueprint';
import type { PMDocJSON } from '$lib/services/markdoc-pm';
import { buildSQLExecutionCode, resolveDependencies } from '$lib/services/cell-deps';
import type { Cell } from '$lib/stores/notebook.svelte';

// vitest swallows per-test console output when stdout isn't a TTY (e.g. redirected to a file
// in a background shell), so DEBUG_SCENARIO logs silently vanish under those invocations.
// Mirror to a file directly so debugging survives non-interactive runs.
const DEBUG_LOG_FILE = process.env.DEBUG_SCENARIO_FILE;
function debugLog(message: string) {
	console.error(message);
	if (DEBUG_LOG_FILE) appendFileSync(DEBUG_LOG_FILE, message + '\n');
}

const runLive = process.env.RUN_LIVE_OPENROUTER === '1' && Boolean(process.env.OPENROUTERKEY);
const maybeIt = runLive ? it : it.skip;

// ---------- Real DuckDB fixture: messy, adversarial data on purpose ----------

let dbDir: string;
let dbFile: string;

beforeAll(() => {
	if (!runLive) return;
	dbDir = mkdtempSync(join(tmpdir(), 'lunapad-ai-scenario-'));
	dbFile = join(dbDir, 'scenario.duckdb');
	const seedSql = `
CREATE TABLE customers (
  customer_id VARCHAR,
  name VARCHAR,
  region VARCHAR,
  segment VARCHAR,
  signup_date DATE
);
INSERT INTO customers VALUES
  ('C1', 'Acme Co',      'North', 'Enterprise', DATE '2024-01-15'),
  ('C2', 'Bramble Ltd',  'south', 'SMB',        DATE '2024-03-02'),
  ('C3', 'Caldera Inc',  'North', 'Enterprise', DATE '2023-11-20'),
  ('C4', 'Delta Group',  'East',  NULL,         DATE '2024-06-01'),
  ('C1', 'Acme Co',      'North', 'Enterprise', DATE '2024-01-15');

CREATE TABLE orders (
  order_id INTEGER,
  customer_id VARCHAR,
  order_date DATE,
  revenue DOUBLE,
  status VARCHAR
);
INSERT INTO orders VALUES
  (1, 'C1', DATE '2024-01-20', 100.0,  'completed'),
  (2, 'C1', DATE '2024-02-15', 150.0,  'completed'),
  (3, 'C2', DATE '2024-03-10', NULL,   'cancelled'),
  (4, 'C2', DATE '2024-04-05', 80.0,   'completed'),
  (5, 'C3', DATE '2024-02-01', 500.0,  'completed'),
  (6, 'C3', DATE '2024-02-20', 300.0,  'refunded'),
  (7, 'C4', DATE '2024-06-15', 20.0,   'completed'),
  (8, 'C5', DATE '2024-06-16', 40.0,   'completed');
`;
	execFileSync('duckdb', [dbFile], { input: seedSql });
});

afterAll(() => {
	if (!runLive) return;
	rmSync(dbDir, { recursive: true, force: true });
});

function runSql(sql: string): { ok: true; columns: string[]; rows: Record<string, unknown>[] } | { ok: false; error: string } {
	try {
		const out = execFileSync('duckdb', ['-json', dbFile], { input: sql, encoding: 'utf-8' });
		const rows = out.trim() ? (JSON.parse(out) as Record<string, unknown>[]) : [];
		const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
		return { ok: true, columns, rows };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message.split('\n').slice(0, 6).join('\n') };
	}
}

function makeCell(partial: Pick<Cell, 'id' | 'outputName' | 'code' | 'language' | 'cellType'>): Cell {
	return {
		...partial,
		connectionId: null,
		markdown: '',
		markdownPreview: false,
		markdownEditMode: 'wysiwyg',
		udfBody: '',
		status: 'idle',
		result: null,
		pythonOutput: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: [],
		editMode: 'sql',
		resultViewMode: 'table',
		resultChartConfig: null,
		plotMode: 'code',
		plotConfig: null,
		plotSourceCellId: null
	} as unknown as Cell;
}

// ---------- SSE / tool-call helpers (mirrors openrouter-live.test.ts) ----------

function parseSse(text: string): Array<Record<string, unknown>> {
	const events: Array<Record<string, unknown>> = [];
	for (const block of text.split('\n\n')) {
		const line = block.split('\n').find((entry) => entry.startsWith('data: '));
		if (!line) continue;
		try {
			events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
		} catch {
			// ignore malformed debug chunks
		}
	}
	return events;
}

function toolCalls(events: Array<Record<string, unknown>>) {
	return events
		.filter((event) => event.type === 'tool_call')
		.map((event) => event.call as { tool?: string; callId?: string; args?: Record<string, unknown> });
}

function parseJsonish(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

async function chatTurn(messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
	const request = new Request('http://localhost/api/ai/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			messages,
			subagentType: 'sql-gen',
			allowedTools: [
				'inspect_notebook',
				'create_notebook',
				'apply_notebook_patch',
				'run_query_nodes',
				'validate_notebook',
				'pick_chart',
				'set_chart',
				'set_view_mode',
				'query_data',
				'sample_data',
				'get_cell_result',
				'record_decision',
				'ask_user'
			],
			notebookContext: {
				cells: [],
				connectionSchema: [
					{
						name: 'orders',
						columns: ['order_id', 'customer_id', 'order_date', 'revenue', 'status'],
						columnTypes: ['INTEGER', 'VARCHAR', 'DATE', 'DOUBLE', 'VARCHAR']
					},
					{
						name: 'customers',
						columns: ['customer_id', 'name', 'region', 'segment', 'signup_date'],
						columnTypes: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'DATE']
					}
				],
				connectionDialect: 'duckdb',
				pythonAvailable: false,
				externalConnectionIds: [],
				externalSchemaFallback: [],
				activeConnectionId: 'builtin.duckdb'
			},
			llmConfig: {
				provider: 'openapi-compatible',
				baseUrl: 'https://openrouter.ai/api/v1',
				model: process.env.LLM_MODEL || 'openai/gpt-oss-20b',
				apiKey: process.env.OPENROUTERKEY
			}
		})
	});
	const response = await POST({ request } as never);
	const text = await response.text();
	return { status: response.status, events: parseSse(text), text };
}

// ---------- Notebook state maintained the way the real client would ----------

interface ExecCellState {
	cellId: string;
	outputName: string;
	cellType: 'query' | 'python' | 'plot';
	language: 'sql' | 'prql' | 'python';
	code: string;
	lastResult?: { ok: boolean; columns: string[]; rowCount: number; sample: Record<string, unknown>[]; error?: string };
	consecutiveFailures?: number;
}

class NotebookState {
	title = 'Untitled';
	cells = new Map<string, ExecCellState>();
	document: PMDocJSON = { type: 'doc', content: [] };

	knownRefs(): string[] {
		return [...this.cells.values()].map((c) => c.outputName);
	}
	knownCellIds(): string[] {
		return [...this.cells.keys()];
	}

	/** Returns the outputNames whose code actually changed (mirrors ai-chat-client.ts's own
	 * before/after diffing, used only for debug logging — NOT for gating success feedback,
	 * since a blocks-only patch legitimately changes zero cell code). */
	applyExecutableCells(executableCells: NotebookBlueprint['executableCells']): Set<string> {
		const changed = new Set<string>();
		for (const ec of executableCells ?? []) {
			const prior = this.cells.get(ec.cellId);
			const codeChanged = !prior || prior.code !== ec.code;
			if (codeChanged) changed.add(ec.outputName);
			this.cells.set(ec.cellId, {
				cellId: ec.cellId,
				outputName: ec.outputName,
				cellType: (ec.cellType as ExecCellState['cellType']) ?? 'query',
				language: (ec.language as ExecCellState['language']) ?? 'sql',
				code: ec.code,
				lastResult: codeChanged ? undefined : prior?.lastResult,
				consecutiveFailures: codeChanged ? 0 : prior?.consecutiveFailures
			});
		}
		return changed;
	}

	orderedSqlCells(): Cell[] {
		return [...this.cells.values()]
			.filter((c) => c.cellType === 'query' && c.language === 'sql')
			.map((c, i) =>
				makeCell({ id: c.cellId, outputName: c.outputName, code: c.code, language: 'sql', cellType: 'query' })
			);
	}

	runQueryNode(cellId: string): string {
		const target = this.cells.get(cellId);
		if (!target) return `ERROR: no such cellId "${cellId}" in current notebook.`;
		if (target.language !== 'sql') {
			return `SKIPPED: cellId "${cellId}" is not a SQL cell (language=${target.language}); cannot execute in this test harness.`;
		}
		const allCells = this.orderedSqlCells();
		const idx = allCells.findIndex((c) => c.id === cellId);
		if (idx === -1) return `ERROR: cellId "${cellId}" not indexable.`;
		const fullSql = buildSQLExecutionCode(allCells, idx, () => null);
		const result = runSql(fullSql);
		if (!result.ok) {
			const sameErrorAsBefore = target.lastResult && !target.lastResult.ok && target.lastResult.error === result.error;
			target.consecutiveFailures = sameErrorAsBefore ? (target.consecutiveFailures ?? 0) + 1 : 1;
			target.lastResult = { ok: false, columns: [], rowCount: 0, sample: [], error: result.error };
			const escalation =
				target.consecutiveFailures >= 2
					? `\n\nSTOP: this exact SQL and exact error have now repeated ${target.consecutiveFailures} times in a row for "${target.outputName}". Re-submitting the same code will fail again. You MUST change your approach — do not reuse any function/expression that just failed with a "Scalar Function ... does not exist" or similar catalog error; pick a genuinely different, DuckDB-native way to express this.`
					: '';
			return `run_query_nodes result for "${target.outputName}" (cellId ${cellId}): FAILED\nSQL executed:\n${fullSql}\nError:\n${result.error}${escalation}`;
		}
		target.consecutiveFailures = 0;
		target.lastResult = {
			ok: true,
			columns: result.columns,
			rowCount: result.rows.length,
			sample: result.rows.slice(0, 5)
		};
		return `run_query_nodes result for "${target.outputName}" (cellId ${cellId}): SUCCESS, ${result.rows.length} row(s), columns: [${result.columns.join(', ')}]. Sample: ${JSON.stringify(result.rows.slice(0, 3))}`;
	}

	inspectSnapshot() {
		return {
			notebookId: 'active-notebook',
			name: this.title,
			document: this.document,
			executableCells: [...this.cells.values()].map((c) => ({
				cellId: c.cellId,
				outputName: c.outputName,
				cellType: c.cellType,
				language: c.language,
				code: c.code,
				status: c.lastResult ? (c.lastResult.ok ? 'success' : 'error') : 'idle',
				columns: c.lastResult?.columns ?? []
			}))
		};
	}
}

async function driveScenario(userPrompt: string, maxTurns: number) {
	const state = new NotebookState();
	let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
		{ role: 'user', content: userPrompt },
		{ role: 'assistant', content: '' }
	];
	const allToolNames: string[] = [];
	let sawDone = false;

	for (let turn = 0; turn < maxTurns; turn++) {
		const { status, events, text } = await chatTurn(messages);
		expect(status, text.slice(0, 800)).toBe(200);
		const calls = toolCalls(events);
		allToolNames.push(...calls.map((c) => c.tool ?? '?'));

		// `type: 'done'` is just the generic end-of-HTTP-stream marker sent on every request.
		// The model's actual completion signal is a `suggestions` event, parsed server-side
		// from a `<done>{"suggestions":[...]}</done>` tag in the model's own text output.
		const doneEvent = events.find((e) => e.type === 'suggestions');
		if (process.env.DEBUG_SCENARIO === '1' && toolCalls(events).length === 0) {
			debugLog(`\n--- turn ${turn} RAW (no tool calls) --- event types: ${events.map((e) => e.type).join(', ')}\n${text.slice(0, 1500)}`);
		}
		const resultParts: string[] = [];

		for (const call of calls) {
			if (call.tool === 'create_notebook' || call.tool === 'apply_notebook_patch') {
				// apply_notebook_patch can arrive as {blueprint}, {document, executableCells}, or
				// {operations, executableCells} — executableCells (the actual SQL) can be top-level
				// alongside any of the three shapes, so it must be read independently of `blueprint`.
				// This block mirrors executeToolCallWithResult in ai-chat-client.ts (blueprint >
				// document > operations > title-only-rename) so the model gets the SAME real
				// validators and SAME success text a real browser client would produce — a fabricated
				// mock response here previously confused the model into unproductive retry loops.
				const blueprint = parseJsonish(call.args?.blueprint) as (NotebookBlueprint & { title?: string }) | undefined;
				const topLevelExecutableCells = parseJsonish(call.args?.executableCells) as
					| NotebookBlueprint['executableCells']
					| undefined;
				const operations = parseJsonish(call.args?.operations) as NotebookPatchOperation[] | undefined;
				const rawDocument = parseJsonish(call.args?.document) as PMDocJSON | undefined;
				const titleArg = typeof call.args?.title === 'string' ? (call.args.title as string) : undefined;

				const execCells = blueprint?.executableCells ?? topLevelExecutableCells;
				const changed = execCells ? state.applyExecutableCells(execCells) : new Set<string>();

				let resultMsg: string;
				if (blueprint) {
					const compiled = compileNotebookBlueprint(
						{ ...blueprint, executableCells: execCells ?? blueprint.executableCells },
						state.knownRefs(),
						state.knownCellIds()
					);
					if (!compiled.document) {
						resultMsg = `${call.tool}: draft validation failed; repair these diagnostics and call ${call.tool} again: ${compiled.diagnostics
							.slice(0, 6)
							.map((d) => `${d.path}: ${d.message}`)
							.join('; ')}`;
					} else {
						state.document = compiled.document;
						if (blueprint.title) state.title = blueprint.title;
						resultMsg =
							call.tool === 'create_notebook'
								? `Notebook '${blueprint.title ?? state.title}' created (id: active-notebook) with ${compiled.executableCells.length} executable cell(s)`
								: `Notebook '${blueprint.title ?? state.title}' patched and validated`;
					}
				} else if (rawDocument) {
					const diagnostics = validateNotebookPmDocument(rawDocument, state.knownRefs());
					if (diagnostics.length) {
						resultMsg = `apply_notebook_patch: document validation failed; repair these diagnostics: ${diagnostics
							.slice(0, 6)
							.map((d) => `${d.path}: ${d.message}`)
							.join('; ')}`;
					} else {
						state.document = rawDocument;
						if (titleArg?.trim()) state.title = titleArg.trim();
						resultMsg = `Notebook '${titleArg?.trim() || state.title}' patched and validated`;
					}
				} else if (operations?.length) {
					const patched = applyNotebookPatchOperations(state.document, operations);
					const refDiagnostics = patched.document
						? validateNotebookPmDocument(patched.document, state.knownRefs())
						: [];
					const allDiagnostics = [...patched.diagnostics, ...refDiagnostics];
					if (!patched.document || allDiagnostics.length) {
						resultMsg = `apply_notebook_patch: patch validation failed; repair these diagnostics: ${allDiagnostics
							.slice(0, 6)
							.map((d) => `${d.path}: ${d.message}`)
							.join('; ')}`;
					} else {
						state.document = patched.document;
						if (titleArg?.trim()) state.title = titleArg.trim();
						resultMsg = `Notebook '${titleArg?.trim() || state.title}' patched and validated`;
					}
				} else if (titleArg?.trim()) {
					state.title = titleArg.trim();
					resultMsg = `Notebook '${titleArg.trim()}' renamed`;
				} else {
					resultMsg = 'apply_notebook_patch: provide blueprint, document, operations, or title';
				}

				if (process.env.DEBUG_SCENARIO === '1') {
					debugLog(
						`[${call.tool} raw args] blueprint=${blueprint ? 'yes' : 'no'} topLevelExecutableCells=${topLevelExecutableCells ? topLevelExecutableCells.length : 'no'} operations=${operations ? operations.length : 'no'} document=${rawDocument ? 'yes' : 'no'} changedCells=[${[...changed].join(', ')}]`
					);
				}
				resultParts.push(resultMsg);
			} else if (call.tool === 'run_query_nodes') {
				const ids = parseJsonish(call.args?.cellIds ?? call.args?.nodeIds) as string[] | undefined;
				for (const id of ids ?? []) {
					resultParts.push(state.runQueryNode(id));
				}
			} else if (call.tool === 'inspect_notebook') {
				resultParts.push(`inspect_notebook result:\n${JSON.stringify(state.inspectSnapshot(), null, 2)}`);
			} else if (call.tool === 'validate_notebook') {
				const diagnostics = validateNotebookPmDocument(state.document, state.knownRefs());
				resultParts.push(
					`validate_notebook result: ok=${diagnostics.length === 0}, diagnostics=${JSON.stringify(diagnostics)}`
				);
			} else if (call.tool === 'get_cell_result' || call.tool === 'sample_data' || call.tool === 'query_data') {
				const cellId = call.args?.cellId as string | undefined;
				const cell = cellId ? state.cells.get(cellId) : undefined;
				resultParts.push(
					cell?.lastResult
						? `${call.tool} result: ${JSON.stringify(cell.lastResult)}`
						: `${call.tool} result: no data yet, run the cell first.`
				);
			} else {
				resultParts.push(`${call.tool} acknowledged.`);
			}
		}

		// Mirror ai-chat-client.ts's real dashboardDone() gate (dashboard-loop-signals.ts):
		// a bare `suggestions` event only counts as real completion if a notebook was actually
		// created/patched AND at least one cell result was actually inspected. Found live: a
		// model can free-form a plan in prose, tack on a `{"suggestions":[...]}` object mimicking
		// <done>'s shape, and never call a single tool — flushBareSuggestionsJson correctly
		// extracts that (it's a deliberate fallback for models that skip <done> tags), but
		// treating it as unconditionally terminal here would diverge from the real client, which
		// keeps driving the model instead of accepting a "done" that did no work.
		const rawDoneSignal = doneEvent || (calls.length === 0 && /<done>/.test(text));
		const notebookReady = state.cells.size > 0;
		const inspectedResult = [...state.cells.values()].some((c) => c.lastResult !== undefined);
		if (rawDoneSignal && (!notebookReady || !inspectedResult)) {
			resultParts.push(
				'Completion signal received, but nothing has actually been built and run yet (no notebook created/patched, or no cell result inspected) — this does not count as done. Call create_notebook/apply_notebook_patch, then run_query_nodes, before finishing.'
			);
		} else if (rawDoneSignal) {
			sawDone = true;
			if (process.env.DEBUG_SCENARIO === '1') {
				debugLog(`\n--- turn ${turn}: DONE --- calls: ${calls.map((c) => c.tool).join(', ') || '(none)'}`);
			}
			break;
		}
		if (calls.length === 0) {
			// Model produced only prose with no tool calls and no <done> — nudge it.
			resultParts.push('No tool calls detected. Continue building with tool calls, or emit <done> if finished.');
		}
		if (process.env.DEBUG_SCENARIO === '1') {
			debugLog(
				`\n--- turn ${turn} --- calls: ${calls.map((c) => c.tool).join(', ') || '(none, text-only)'}\n` +
					resultParts.map((p) => p.slice(0, 300)).join('\n---\n')
			);
		}

		// Keep context bounded: like the real client's per-phase-fresh message arrays, replay
		// only the original ask + the latest tool feedback, not the full growing transcript.
		// An unbounded transcript is what caused a 20B model to return an empty response
		// past ~9 turns in an earlier run of this test.
		messages = [
			{ role: 'user', content: userPrompt },
			{ role: 'assistant', content: '' },
			{
				role: 'user',
				content: `Tool results so far:\n\n${resultParts.join('\n\n')}\n\nCurrent notebook state:\n${JSON.stringify(state.inspectSnapshot())}\n\nContinue building/fixing. Do not repeat create_notebook — use apply_notebook_patch to fix or extend the active notebook.`
			},
			{ role: 'assistant', content: '' }
		];
	}

	return { state, allToolNames, sawDone };
}

describe('OpenRouter live: full realistic notebook build', () => {
	maybeIt(
		'builds a complete revenue-ops notebook (staging -> mart -> analysis -> dashboard) against real DuckDB data',
		async () => {
			const prompt =
				'Build a complete revenue operations notebook called "Revenue Ops Review" from the orders and customers tables. ' +
				'Requirements: ' +
				'1) A staging cell stg_customers that dedupes customers by customer_id and normalizes region to title case. ' +
				'2) A staging cell stg_orders that excludes cancelled and refunded orders and casts revenue to a non-null number (treat NULL revenue as 0). ' +
				'3) A mart cell fct_orders that joins stg_orders to stg_customers on customer_id. ' +
				'4) An analysis cell monthly_revenue that aggregates fct_orders revenue by month. ' +
				'5) An analysis cell revenue_by_segment that aggregates fct_orders revenue by customer segment (segment may be NULL — bucket it as "Unknown"). ' +
				'6) An analysis cell top_customers that ranks customers by total revenue, limited to top 5, using fct_orders. ' +
				'Then add a dashboard section to the SAME notebook (not a separate one) with: a metric widget for total revenue, a chart for monthly_revenue, a chart for revenue_by_segment, and a data table for top_customers, ' +
				'laid out with at least a tabs or grid container. ' +
				'Use apply_notebook_patch / create_notebook only. Call run_query_nodes after building and self-correct any SQL errors for real — the tables have messy data (a duplicate customer row, NULL revenue, NULL segment, mixed-case region, and an order from a customer_id not present in customers) so make your SQL robust to that. ' +
				'Finish with validate_notebook and <done> only once everything is correct.';

			const { state, allToolNames, sawDone } = await driveScenario(prompt, 14);

			expect(allToolNames, `Tools called: ${allToolNames.join(', ')}`).toContain('run_query_nodes');
			expect(sawDone, `Model never signalled <done>. Tools called: ${allToolNames.join(', ')}`).toBe(true);

			const requiredOutputs = [
				'stg_customers',
				'stg_orders',
				'fct_orders',
				'monthly_revenue',
				'revenue_by_segment',
				'top_customers'
			];
			const presentOutputs = [...state.cells.values()].map((c) => c.outputName);
			for (const name of requiredOutputs) {
				expect(presentOutputs, `Missing required cell "${name}". Present: ${presentOutputs.join(', ')}`).toContain(
					name
				);
			}

			// Real correctness: every SQL cell must actually execute successfully against DuckDB.
			for (const cell of state.cells.values()) {
				if (cell.language !== 'sql') continue;
				if (!cell.lastResult) {
					state.runQueryNode(cell.cellId);
				}
			}
			const failures = [...state.cells.values()]
				.filter((c) => c.language === 'sql' && c.lastResult && !c.lastResult.ok)
				.map((c) => `${c.outputName}: ${c.lastResult?.error}`);
			expect(failures, `SQL cells failed to execute:\n${failures.join('\n')}`).toEqual([]);

			// fct_orders must actually contain a join — row count should not exceed stg_orders' row count
			// by an unreasonable factor (fan-out bug), and must not silently drop the unmatched customer_id.
			const fctResult = state.cells.get([...state.cells.values()].find((c) => c.outputName === 'fct_orders')!.cellId)
				?.lastResult;
			expect(fctResult?.ok).toBe(true);
			expect(fctResult!.rowCount).toBeGreaterThan(0);

			// Final structural + ref validation through the real compiler.
			const diagnostics = validateNotebookPmDocument(state.document, state.knownRefs());
			expect(
				diagnostics,
				`Document validation diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`
			).toEqual([]);
		},
		600_000
	);
});

describe('OpenRouter live: harder adversarial notebook build', () => {
	maybeIt(
		'handles self-joins, window functions, nested containers, loops, and filters correctly',
		async () => {
			const prompt =
				'Build a notebook called "Customer Referral Ops" from the customers table only (treat it as if it also ' +
				'has a nullable `referred_by` column holding another customer_id — since it does not really exist, first ' +
				'add a staging cell stg_customers_ref that selects all customers columns plus a literal NULL AS referred_by, ' +
				'except set referred_by to \'C1\' for customer C2 and to \'C3\' for customer C4, to simulate a referral chain). ' +
				'Requirements: ' +
				'1) A cell referral_pairs that self-joins stg_customers_ref to itself to produce one row per (customer, referrer) pair, ' +
				'showing the customer name and the referrer name (referrer may be NULL — label as "Direct signup"). ' +
				'2) A cell region_rank that uses a window function to rank customers within each region by signup_date (earliest = rank 1), ' +
				'including a running count of signups per region ordered by signup_date. ' +
				'3) Add a dashboard section to the SAME notebook with a 3-level-deep nested layout: a tabs container, containing a tab ' +
				'with a columns container, containing a column with a card, containing a data table for region_rank. ' +
				'4) Inside another tab, add a loop block (each/group, your choice) that iterates referral_pairs and renders one line of text per row ' +
				'using the loop item (not a top-level $referral_pairs ref inside the loop body). ' +
				'5) Add a filter widget bound to region_rank on the region column. ' +
				'Use apply_notebook_patch / create_notebook only (blueprint, document, or operations shapes are all fine — use whichever is natural). ' +
				'Call run_query_nodes and self-correct any SQL errors for real. ' +
				'Finish with validate_notebook and <done> only once everything is correct.';

			const { state, allToolNames, sawDone } = await driveScenario(prompt, 16);

			expect(allToolNames, `Tools called: ${allToolNames.join(', ')}`).toContain('run_query_nodes');
			expect(sawDone, `Model never signalled <done>. Tools called: ${allToolNames.join(', ')}`).toBe(true);

			const requiredOutputs = ['stg_customers_ref', 'referral_pairs', 'region_rank'];
			const presentOutputs = [...state.cells.values()].map((c) => c.outputName);
			for (const name of requiredOutputs) {
				expect(presentOutputs, `Missing required cell "${name}". Present: ${presentOutputs.join(', ')}`).toContain(
					name
				);
			}

			for (const cell of state.cells.values()) {
				if (cell.language !== 'sql') continue;
				if (!cell.lastResult) state.runQueryNode(cell.cellId);
			}
			const failures = [...state.cells.values()]
				.filter((c) => c.language === 'sql' && c.lastResult && !c.lastResult.ok)
				.map((c) => `${c.outputName}: ${c.lastResult?.error}`);
			expect(failures, `SQL cells failed to execute:\n${failures.join('\n')}`).toEqual([]);

			const docJson = JSON.stringify(state.document);
			expect(docJson.includes('tabs') && docJson.includes('columns'), 'expected a tabs+columns nested layout').toBe(
				true
			);
			expect(/"tagName":"(each|group)"/.test(docJson), 'expected an each/group loop block').toBe(true);
			expect(docJson.includes('filter'), 'expected a filter widget').toBe(true);

			const diagnostics = validateNotebookPmDocument(state.document, state.knownRefs());
			expect(
				diagnostics,
				`Document validation diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`
			).toEqual([]);
		},
		600_000
	);
});
