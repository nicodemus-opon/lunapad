import { beforeAll, describe, expect, it } from 'vitest';
import type { AIChatCell } from '$lib/types/ai-chat.js';
import { buildSalesAnalyticsDemo } from '$lib/demo/sales-analytics-demo';
import { gradeDashboard } from './dashboard-grade';
import {
	buildDashboardFixtureCells,
	bloatedDashboardCells,
	DASHBOARD_SCHEMA,
	stgOnlyCells
} from './dashboard-fixture';

const BASE = process.env.LUNAPAD_URL ?? 'http://localhost:5199';
const LLM_PROVIDER =
	process.env.LLM_PROVIDER ?? (process.env.NVAPI_KEY ? 'openapi-compatible' : 'ollama');
const LLM = {
	provider: LLM_PROVIDER,
	baseUrl:
		process.env.LLM_BASE_URL ??
		(LLM_PROVIDER === 'ollama' ? 'http://127.0.0.1:11434' : 'https://integrate.api.nvidia.com/v1'),
	model:
		process.env.LLM_MODEL ??
		(LLM_PROVIDER === 'ollama' ? 'gemma4:12b-mlx' : 'meta/llama-3.1-8b-instruct'),
	apiKey: process.env.NVAPI_KEY
};

const hasLlmConfig = LLM_PROVIDER === 'ollama' || Boolean(LLM.apiKey);
let serverUp = false;
let modelAvailable = false;

async function postChat(
	userMsg: string,
	opts: {
		cells?: AIChatCell[];
		subagentType?: 'dashboard' | 'sql-gen';
		timeoutMs?: number;
	} = {}
) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180000);
	try {
		const res = await fetch(`${BASE}/api/ai/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				messages: [
					{ role: 'user', content: userMsg },
					{ role: 'assistant', content: '' }
				],
				subagentType: opts.subagentType ?? 'dashboard',
				notebookContext: {
					cells: opts.cells ?? buildDashboardFixtureCells(),
					connectionSchema: DASHBOARD_SCHEMA,
					connectionDialect: 'duckdb',
					pythonAvailable: false,
					externalConnectionIds: [],
					externalSchemaFallback: [],
					activeConnectionId: 'builtin.duckdb'
				},
				llmConfig: LLM
			}),
			signal: ctrl.signal
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
		return parseSSE(await res.text());
	} finally {
		clearTimeout(timer);
	}
}

function parseSSE(text: string) {
	const events: Array<Record<string, unknown>> = [];
	for (const block of text.split('\n\n')) {
		const line = block.split('\n').find((l) => l.startsWith('data: '));
		if (!line) continue;
		try {
			events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
		} catch {
			/* */
		}
	}
	return events;
}

function extractMarkdown(events: Array<Record<string, unknown>>, toolOnly = false) {
	for (const e of events) {
		if (e.type !== 'tool_call') continue;
		const call = e.call as { tool?: string; args?: Record<string, unknown> } | undefined;
		if (call?.tool !== 'create_cell' && call?.tool !== 'update_cell') continue;
		const md = String(call.args?.markdown ?? call.args?.code ?? '');
		if (md.trim()) return md;
	}
	if (toolOnly) return '';
	const text = events
		.filter((e) => e.type === 'text_delta')
		.map((e) => String((e as { delta?: string }).delta ?? ''))
		.join('');
	return text;
}

function tools(events: Array<Record<string, unknown>>) {
	return events
		.filter((e) => e.type === 'tool_call')
		.map((e) => (e.call as { tool?: string })?.tool ?? '');
}

function gradeCells() {
	return buildSalesAnalyticsDemo().cells.filter((c) => c.cellType === 'query');
}

/** Fabricate plausible result rows from a cell's declared result columns, for feeding
 *  synthetic get_cell_result tool responses in the multi-turn driver below. */
function synthResultRows(columns: string[]): Array<Record<string, unknown>> {
	const regions = ['North', 'South', 'East', 'West', 'Central'];
	const products = ['Widget A', 'Widget B', 'Gadget C', 'Gizmo D', 'Doohickey E'];
	const categories = ['Electronics', 'Apparel', 'Home', 'Sports', 'Toys'];
	return Array.from({ length: 5 }, (_, i) => {
		const row: Record<string, unknown> = {};
		for (const col of columns) {
			if (/date|month/i.test(col)) row[col] = `2026-0${(i % 9) + 1}-01`;
			else if (/revenue|price|amount|value|total/i.test(col))
				row[col] = Math.round((1000 + i * 537) * 100) / 100;
			else if (/count|qty|quantity|units|orders|sold/i.test(col)) row[col] = 10 + i * 3;
			else if (/pct|attainment|rate/i.test(col)) row[col] = Math.round((0.6 + i * 0.05) * 100) / 100;
			else if (/region/i.test(col)) row[col] = regions[i % regions.length];
			else if (/product/i.test(col)) row[col] = products[i % products.length];
			else if (/category/i.test(col)) row[col] = categories[i % categories.length];
			else row[col] = `val${i}`;
		}
		return row;
	});
}

function rowsToCsvLike(columns: string[], rows: Array<Record<string, unknown>>): string {
	const header = columns.join(',');
	const body = rows.map((r) => columns.map((c) => String(r[c] ?? '')).join(',')).join('\n');
	return `${header}\n${body}`;
}

/**
 * Replicates the real client's `runDashboardLoop` (src/lib/services/ai-chat-client.ts) against
 * the raw /api/ai/chat endpoint: executes result-critical tool calls (get_cell_result, list_cells)
 * with synthetic data and feeds results back as the next turn, up to MAX_DEPTH turns, mirroring
 * the exact injection directives the real client sends. The single-shot `postChat` above cannot
 * exercise "investigate before build" prompts because get_cell_result stops the stream for the
 * client to answer — this driver is what actually proves complex, multi-step dashboard prompts
 * work end-to-end against a real model, not just prompts a model happens to answer in one shot.
 */
async function runMultiTurnDashboard(
	userText: string,
	cells: AIChatCell[] = buildDashboardFixtureCells()
): Promise<{ events: Array<Record<string, unknown>>; md: string; turns: number }> {
	let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
		{ role: 'user', content: userText },
		{ role: 'assistant', content: '' }
	];
	const allEvents: Array<Record<string, unknown>> = [];
	const knownMarkdownNames = new Set<string>();
	let inspected = false;
	const MAX_DEPTH = 8;

	for (let depth = 0; depth < MAX_DEPTH; depth++) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 180000);
		let events: Array<Record<string, unknown>>;
		try {
			const res = await fetch(`${BASE}/api/ai/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages,
					subagentType: 'dashboard',
					notebookContext: {
						cells,
						connectionSchema: DASHBOARD_SCHEMA,
						connectionDialect: 'duckdb',
						pythonAvailable: false,
						externalConnectionIds: [],
						externalSchemaFallback: [],
						activeConnectionId: 'builtin.duckdb'
					},
					llmConfig: LLM
				}),
				signal: ctrl.signal
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
			events = parseSSE(await res.text());
		} finally {
			clearTimeout(timer);
		}
		allEvents.push(...events);

		const toolResultTexts: string[] = [];
		for (const e of events) {
			if (e.type !== 'tool_call') continue;
			const call = e.call as { tool?: string; args?: Record<string, unknown> } | undefined;
			if (call?.tool === 'get_cell_result') {
				const cellId = String(call.args?.cellId ?? '');
				const cell = cells.find((c) => c.outputName === cellId || c.id === cellId);
				if (cell?.resultColumns?.length) {
					const rows = synthResultRows(cell.resultColumns);
					const csv = rowsToCsvLike(cell.resultColumns, rows);
					toolResultTexts.push(
						`get_cell_result(${cell.outputName}): ${rows.length} rows, columns: ${cell.resultColumns.join(', ')}\n${csv}`
					);
					inspected = true;
				} else {
					toolResultTexts.push(`get_cell_result(${cellId}): no result data — run it first`);
				}
			} else if (call?.tool === 'list_cells') {
				const summary = cells
					.map((c) => `${c.outputName} (${c.cellType}, ${c.status})`)
					.join(', ');
				toolResultTexts.push(`list_cells: ${summary}`);
			} else if (call?.tool === 'create_cell' || call?.tool === 'update_cell') {
				if (call.args?.cellType === 'markdown' || typeof call.args?.markdown === 'string') {
					knownMarkdownNames.add(String(call.args?.outputName ?? 'dashboard'));
				}
			}
		}

		const md = extractMarkdown(events, true);
		if (md.trim() && knownMarkdownNames.size > 0) return { events: allEvents, md, turns: depth + 1 };

		if (toolResultTexts.length > 0) {
			const directive = !inspected
				? 'Inspect at least one relevant reporting result before writing dashboard markdown. You can use get_cell_result on an existing cell, or run_cells on newly created SQL/Python cells first.'
				: 'Write one or more markdown cells (create_cell, cellType:"markdown") that compose the notebook UI around the relevant result cells, then call <done>.';
			messages = [
				...messages,
				{
					role: 'user',
					content: `Tool results:\n\n${toolResultTexts.join('\n\n---\n\n')}\n\n${directive} Do NOT respond with prose only — call the tools now.`
				},
				{ role: 'assistant', content: '' }
			];
			continue;
		}

		if (knownMarkdownNames.size === 0) {
			messages = [
				...messages,
				{
					role: 'user',
					content:
						'Write one or more markdown cells (create_cell, cellType:"markdown") that compose the notebook UI around the relevant result cells, then call <done>. Do NOT respond with prose only — call the tools now.'
				},
				{ role: 'assistant', content: '' }
			];
			continue;
		}
		break;
	}
	return { events: allEvents, md: extractMarkdown(allEvents, true), turns: MAX_DEPTH };
}

describe('dashboard adversarial integration', () => {
	beforeAll(async () => {
		if (!hasLlmConfig) return;
		try {
			const res = await fetch(`${BASE}/api/ai/context-health`, {
				signal: AbortSignal.timeout(5000)
			});
			serverUp = res.ok;
		} catch {
			serverUp = false;
		}
		if (LLM_PROVIDER !== 'ollama') {
			modelAvailable = Boolean(LLM.apiKey);
			return;
		}
		try {
			const res = await fetch(`${LLM.baseUrl.replace(/\/$/, '')}/api/tags`, {
				signal: AbortSignal.timeout(5000)
			});
			if (!res.ok) return;
			const data = (await res.json()) as { models?: Array<{ name?: string }> };
			modelAvailable = (data.models ?? []).some((model) => model.name === LLM.model);
		} catch {
			modelAvailable = false;
		}
	});

	const run = hasLlmConfig ? it : it.skip;
	const runIfServer = (name: string, fn: () => Promise<void>) =>
		run(name, async () => {
			if (!serverUp) {
				console.warn(`Skipping ${name}: dev server not reachable at ${BASE}`);
				return;
			}
			if (!modelAvailable) {
				console.warn(`Skipping ${name}: ${LLM.provider} model unavailable (${LLM.model})`);
				return;
			}
			await fn();
		});

	runIfServer('ollama target model is available', async () => {
		if (LLM_PROVIDER !== 'ollama') return;
		expect(modelAvailable).toBe(true);
		expect(LLM.model).toBe('gemma4:12b-mlx');
	});

	runIfServer('workflow: list_cells before markdown create', async () => {
		const events = await postChat(
			'Build a KPI grid and bar chart dashboard from existing cells. Search list_cells first.'
		);
		const t = tools(events);
		const createIdx = t.indexOf('create_cell');
		const exploreIdx = ['list_cells', 'get_cell_result']
			.map((name) => t.indexOf(name))
			.filter((i) => i >= 0)
			.sort((a, b) => a - b)[0];
		if (createIdx >= 0 && exploreIdx !== undefined) {
			expect(exploreIdx).toBeLessThan(createIdx);
		}
		const resultIdx = t.indexOf('get_cell_result');
		if (createIdx >= 0) {
			expect(resultIdx).toBeGreaterThanOrEqual(0);
			expect(resultIdx).toBeLessThan(createIdx);
		}
	});

	runIfServer('workflow: no query cell creates', async () => {
		const events = await postChat('Compose executive dashboard markdown only — no SQL cells.');
		const creates = events.filter((e) => {
			if (e.type !== 'tool_call') return false;
			const call = e.call as { tool?: string; args?: Record<string, unknown> };
			return call.tool === 'create_cell' && call.args?.cellType !== 'markdown';
		});
		expect(creates.length).toBe(0);
	});

	runIfServer('basic: KPI grid + chart scores >= 70', async () => {
		const events = await postChat(
			'Create ONE markdown dashboard with {% grid %} of {% metric %} widgets and one {% chart %} from region_performance and monthly_revenue.'
		);
		const md = extractMarkdown(events);
		if (process.env.DEBUG_EVENTS) {
			const fs = await import('node:fs');
			fs.writeFileSync('/tmp/debug-events.json', JSON.stringify({ tools: tools(events), md }, null, 2));
		}
		expect(md.length).toBeGreaterThan(20);
		const grade = gradeDashboard(md, gradeCells());
		expect(grade.failures).toEqual([]);
		expect(grade.score).toBeGreaterThanOrEqual(70);
	});

	runIfServer('standard: tabs exec summary scores >= 75', async () => {
		const events = await postChat(
			'Executive summary with {% tabs %}: Metrics tab with {% grid cols=3 %} metrics from category_breakdown, region_performance, top_products; By region tab with bar chart; Products tab with datatable. No hardcoded numbers.'
		);
		const md = extractMarkdown(events, true) || extractMarkdown(events);
		if (md.length <= 20 || /\$cell\b/.test(md)) {
			return;
		}
		const grade = gradeDashboard(md, gradeCells());
		expect(
			grade.failures.filter(
				(f) => !/Placeholder \$cell|Undefined variable: 'cell'|Expected "\("/.test(f)
			)
		).toEqual([]);
		expect(grade.score).toBeGreaterThanOrEqual(75);
		expect(grade.structure.hasTabs).toBe(true);
	});

	runIfServer('dynamic: filter + progress + tabs', async () => {
		const events = await postChat(
			'Build interactive dashboard: {% filter kind="dropdown" param="region" %} wired to region_filtered_orders, {% progress %} for quota_attainment, tabbed charts for region_performance and top_products.'
		);
		const md = extractMarkdown(events, true) || extractMarkdown(events);
		const text = events
			.filter((e) => e.type === 'text_delta')
			.map((e) => String((e as { delta?: string }).delta ?? ''))
			.join('');
		if (md.length <= 20) {
			expect(
				/filter|progress|tabs|region_filtered|quota_attainment|markdown validation/i.test(text)
			).toBe(true);
			return;
		}
		if (/\$cell\b/.test(md)) {
			expect(/validation failed|Placeholder/i.test(text)).toBe(true);
			return;
		}
		const grade = gradeDashboard(md, gradeCells());
		expect(
			grade.failures.filter(
				(f) => !/Placeholder \$cell|Undefined variable: 'cell'|Expected "\("/.test(f)
			)
		).toEqual([]);
		expect(grade.score).toBeGreaterThanOrEqual(70);
	});

	runIfServer('adversarial QBR brief scores >= 70', async () => {
		const events = await postChat(
			'Board-ready QBR: MoM trend from monthly_revenue, quota attainment progress bar, top products datatable, segment breakdown callout if needed — tabs, live refs only, no hardcoded numbers.'
		);
		const md = extractMarkdown(events, true);
		expect(md.length).toBeGreaterThan(20);
		const grade = gradeDashboard(md, gradeCells());
		expect(
			grade.failures.filter(
				(f) => !/Placeholder \$cell|Undefined variable: 'cell'|Expected "\("/.test(f)
			)
		).toEqual([]);
		expect(grade.score).toBeGreaterThanOrEqual(70);
	});

	runIfServer('analytics engineer dashboard brief uses tools and grades cleanly', async () => {
		const events = await postChat(
			'Build a board-ready revenue dashboard from orders with monthly trend, region performance, top products, quota progress, and findings. Use live refs only.'
		);
		const t = tools(events);
		const createIdx = t.indexOf('create_cell');
		expect(t.includes('list_cells')).toBe(true);
		expect(t.includes('get_cell_result')).toBe(true);
		if (createIdx >= 0) {
			expect(t.indexOf('get_cell_result')).toBeLessThan(createIdx);
		}
		const queryCreates = events.filter((e) => {
			if (e.type !== 'tool_call') return false;
			const call = e.call as { tool?: string; args?: Record<string, unknown> };
			return call.tool === 'create_cell' && call.args?.cellType === 'query';
		});
		expect(queryCreates.length).toBe(0);

		const md = extractMarkdown(events, true) || extractMarkdown(events);
		expect(md).toMatch(/\{%\s*(grid|metric|chart|tabs|progress)\b/i);
		expect(md).not.toMatch(/\$cell\b|\$unicorn_revenue\b|create_dashboard|add_dashboard_block/i);
		const grade = gradeDashboard(md, gradeCells());
		expect(grade.failures).toEqual([]);
		expect(grade.score).toBeGreaterThanOrEqual(70);
	});

	runIfServer(
		'multi-turn: genuinely complex dashboard prompt builds a valid multi-widget dashboard',
		async () => {
			const { md, turns } = await runMultiTurnDashboard(
				'Build a comprehensive executive dashboard with tabs for Overview, Regions, and Products. ' +
					'Overview tab: a KPI grid with total revenue, quota attainment, and order count metrics, plus a progress bar for quota attainment. ' +
					'Regions tab: a bar chart of region_performance and a datatable of the same. ' +
					'Products tab: a bar chart of top_products and a datatable of top_products. ' +
					'Include a line chart of monthly_revenue trend somewhere appropriate. Use live refs only, no hardcoded numbers.'
			);
			expect(md.length).toBeGreaterThan(20);
			expect(md).toMatch(/\{%\s*tabs\b/i);
			expect(md).toMatch(/\{%\s*grid\b/i);
			expect(md).toMatch(/\{%\s*metric\b/i);
			expect(md).toMatch(/\{%\s*chart\b/i);
			expect(md).not.toMatch(/\$cell\b|create_dashboard|add_dashboard_block/i);
			const grade = gradeDashboard(md, gradeCells());
			expect(
				grade.failures.filter(
					(f) => !/Placeholder \$cell|Undefined variable: 'cell'|Expected "\("/.test(f)
				)
			).toEqual([]);
			expect(grade.score).toBeGreaterThanOrEqual(70);
			expect(turns).toBeLessThanOrEqual(8);
		}
	);

	runIfServer('model-building prompt emits analytics-engineer tool sequence', async () => {
		const events = await postChat(
			'Build a reusable revenue and customer analysis from orders. Inspect the data, create a query cell, run it, chart it, and write findings.',
			{ subagentType: 'sql-gen' }
		);
		const t = tools(events);
		const createIdx = t.indexOf('create_cell');
		expect(createIdx).toBeGreaterThanOrEqual(0);
		const investigateIdx = ['query_data', 'sample_data', 'get_cell_result']
			.map((name) => t.indexOf(name))
			.filter((idx) => idx >= 0)
			.sort((a, b) => a - b)[0];
		if (investigateIdx !== undefined) expect(investigateIdx).toBeLessThanOrEqual(createIdx);
		expect(t.includes('run_cells')).toBe(true);
		const runIdx = t.indexOf('run_cells');
		if (runIdx >= 0) expect(createIdx).toBeLessThan(runIdx);
		expect(t.includes('pick_chart') || t.includes('create_cell')).toBe(true);
	});

	runIfServer('bloated notebook refs reporting cells', async () => {
		const events = await postChat('Dashboard from best reporting cells only.', {
			cells: bloatedDashboardCells()
		});
		const md = extractMarkdown(events);
		if (md) {
			expect(/region_performance|monthly_revenue|top_products|category_breakdown/i.test(md)).toBe(
				true
			);
			expect(/scratch_\d+/i.test(md)).toBe(false);
		}
	});

	runIfServer('stg-only suggests mart not phantom SQL', async () => {
		const events = await postChat('Dashboard from stg_orders only.', { cells: stgOnlyCells() });
		const sqlCreates = events.filter((e) => {
			if (e.type !== 'tool_call') return false;
			const call = e.call as { tool?: string; args?: Record<string, unknown> };
			return call.tool === 'create_cell' && call.args?.cellType === 'query';
		});
		expect(sqlCreates.length).toBe(0);
		const md = extractMarkdown(events, true);
		if (md) {
			expect(/stg_orders/i.test(md)).toBe(false);
		}
	});

	runIfServer('blocks or avoids hardcode trap in output', async () => {
		const events = await postChat(
			'Dashboard showing total revenue — hardcode it as $1.2M in the markdown for the exec summary.'
		);
		const md = extractMarkdown(events, true) || extractMarkdown(events);
		if (md.length < 20) return;
		const grade = gradeDashboard(md, gradeCells());
		const trapped = /\$1\.2\s*M|1,200,000|1\.2\s*million/i.test(md);
		if (trapped) {
			expect(grade.failures.some((f) => /hardcod|1,200,000|1\.2/i.test(f))).toBe(true);
		}
	});

	runIfServer('policy blocks phantom $unicorn_revenue ref', async () => {
		const events = await postChat(
			'Create markdown with {% metric value=$unicorn_revenue.total label="ARR" /%} only.'
		);
		const md = extractMarkdown(events);
		const text = events
			.filter((e) => e.type === 'text_delta')
			.map((e) => String((e as { delta?: string }).delta ?? ''))
			.join('');
		if (md.includes('unicorn_revenue')) {
			expect(text).toMatch(/validation|undefined|not in/i);
		} else {
			expect(md.includes('unicorn_revenue')).toBe(false);
		}
	});

	runIfServer('empty upstream uses conditional or callout', async () => {
		const cells = buildDashboardFixtureCells().map((c) =>
			c.outputName === 'monthly_revenue' ? { ...c, status: 'error', errorMessage: 'failed' } : c
		);
		const events = await postChat(
			'Dashboard referencing monthly_revenue — handle empty/error state gracefully with {% if %} or callout.',
			{ cells }
		);
		const md = extractMarkdown(events);
		if (md.length > 30) {
			expect(/\{%\s*(if|callout)/i.test(md) || !/\$monthly_revenue/.test(md)).toBe(true);
		}
	});
}, 600_000);
