import { describe, expect, it } from 'vitest';
import { POST } from './+server';

const runLive = process.env.RUN_LIVE_NVIDIA === '1' && Boolean(process.env.NVAPI_KEY);
const maybeIt = runLive ? it : it.skip;

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
				cells: [
					{
						id: 'starter',
						outputName: 'starter',
						cellType: 'query',
						language: 'sql',
						status: 'idle',
						code: 'select 0 as seed',
						resultColumns: [],
						resultSample: [],
						belongsToActiveNotebook: true
					}
				],
				connectionSchema: [],
				connectionDialect: 'duckdb',
				pythonAvailable: false,
				externalConnectionIds: [],
				externalSchemaFallback: [],
				activeConnectionId: 'builtin.duckdb'
			},
			llmConfig: {
				provider: 'openapi-compatible',
				baseUrl: 'https://integrate.api.nvidia.com/v1',
				model: process.env.LLM_MODEL || 'meta/llama-3.1-8b-instruct',
				apiKey: process.env.NVAPI_KEY
			}
		})
	});
	const response = await POST({ request } as never);
	const text = await response.text();
	return { status: response.status, events: parseSse(text), text };
}

function toolCalls(events: Array<Record<string, unknown>>) {
	return events
		.filter((event) => event.type === 'tool_call')
		.map((event) => event.call as { tool?: string; args?: Record<string, unknown> });
}

function parseJsonish(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function asArray(value: unknown): unknown[] {
	const parsed = parseJsonish(value);
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === 'object') return [parsed];
	return [];
}

function nestedBlocks(value: unknown): Array<Record<string, unknown>> {
	if (!value || typeof value !== 'object') return [];
	const block = value as Record<string, unknown>;
	const out = [block];
	for (const key of ['blocks', 'items', 'then', 'else']) {
		const children = block[key];
		if (Array.isArray(children)) out.push(...children.flatMap(nestedBlocks));
	}
	const columns = block.columns;
	if (Array.isArray(columns)) {
		for (const column of columns) {
			if (column && typeof column === 'object' && Array.isArray((column as { blocks?: unknown }).blocks)) {
				out.push(...((column as { blocks: unknown[] }).blocks).flatMap(nestedBlocks));
			}
		}
	}
	const tabs = block.tabs;
	if (Array.isArray(tabs)) {
		for (const tab of tabs) {
			if (tab && typeof tab === 'object' && Array.isArray((tab as { blocks?: unknown }).blocks)) {
				out.push(...((tab as { blocks: unknown[] }).blocks).flatMap(nestedBlocks));
			}
		}
	}
	return out;
}

function executableCellsFromPatch(call: { args?: Record<string, unknown> }): unknown[] {
	const blueprint = parseJsonish(call.args?.blueprint) as
		| { executableCells?: unknown[] | string }
		| undefined;
	return asArray(call.args?.executableCells ?? blueprint?.executableCells);
}

function blueprintBlocksFromPatch(call: { args?: Record<string, unknown> }): unknown[] {
	const blueprint = parseJsonish(call.args?.blueprint) as { blocks?: unknown[] | string } | undefined;
	return asArray(blueprint?.blocks);
}

describe('NVIDIA live AI notebook editing', () => {
	maybeIt(
		'edits the active notebook with apply_notebook_patch instead of creating a new notebook',
		async () => {
			let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
				{
					role: 'user',
					content:
						'Rename the active notebook to Revenue Check and add a SQL query node named revenue_check that selects 1 as revenue. Edit the current notebook; do not create a separate notebook.'
				},
				{ role: 'assistant', content: '' }
			];
			const allCalls: Array<{ tool?: string; args?: Record<string, unknown> }> = [];

			for (let turn = 0; turn < 4; turn++) {
				const { status, events, text } = await chatTurn(messages);
				expect(status, text.slice(0, 500)).toBe(200);
				const calls = toolCalls(events);
				allCalls.push(...calls);
				expect(calls.some((call) => call.tool === 'create_notebook')).toBe(false);

				const patch = calls.find((call) => call.tool === 'apply_notebook_patch');
				if (patch) {
					expect(patch.args?.title ?? patch.args?.blueprint).toBeTruthy();
					const executableCells = executableCellsFromPatch(patch);
					expect(JSON.stringify(executableCells)).toContain('revenue_check');
					return;
				}

				const inspected = calls.some((call) => call.tool === 'inspect_notebook');
				const toolResult = inspected
					? JSON.stringify(
							{
								notebookId: 'active-notebook',
								name: 'Untitled',
								document: {
									type: 'doc',
									content: [
										{
											type: 'queryBlock',
											attrs: { cellId: 'starter', cellType: 'query', pinned: true }
										}
									]
								},
								executableCells: [
									{
										cellId: 'starter',
										outputName: 'starter',
										cellType: 'query',
										language: 'sql',
										code: 'select 0 as seed',
										status: 'idle',
										columns: []
									}
								]
							},
							null,
							2
						)
					: `Tool results: no notebook mutation yet. Use apply_notebook_patch with title, executableCells, and queryBlock blocks.`;
				messages = [
					...messages,
					{
						role: 'user',
						content: `Tool results:\n\n${toolResult}\n\nNow edit the active notebook with apply_notebook_patch. Do not call create_notebook.`
					},
					{ role: 'assistant', content: '' }
				];
			}

			throw new Error(
				`NVIDIA model did not emit apply_notebook_patch. Tools: ${allCalls
					.map((call) => call.tool)
					.join(', ')}`
			);
		},
		240_000
	);

	maybeIt(
		'can plan a complex active-notebook patch with multiple query nodes and nested blocks',
		async () => {
			let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
				{
					role: 'user',
					content:
						'Edit the active notebook into a complex notebook named Revenue Ops Review. Call apply_notebook_patch only. Do not create a separate notebook. Use JSON arrays as arrays, not strings. Add exactly three SQL executableCells with these short SQL bodies: revenue_by_month = SELECT 1 AS month, 100 AS revenue; region_performance = SELECT \'North\' AS region, 100 AS revenue; product_mix = SELECT \'Widget\' AS product, 42 AS units. In blueprint.blocks include nested tabs, a grid or columns layout, and three matching queryBlock placements for those cellIds.'
				},
				{ role: 'assistant', content: '' }
			];
			const allCalls: Array<{ tool?: string; args?: Record<string, unknown> }> = [];

			for (let turn = 0; turn < 5; turn++) {
				const { status, events, text } = await chatTurn(messages);
				expect(status, text.slice(0, 500)).toBe(200);
				const calls = toolCalls(events);
				allCalls.push(...calls);
				expect(calls.some((call) => call.tool === 'create_notebook')).toBe(false);

				const patch = calls.find((call) => call.tool === 'apply_notebook_patch');
				if (patch) {
					const executableCells = executableCellsFromPatch(patch);
					const serializedCells = JSON.stringify(executableCells);
					const blocks = blueprintBlocksFromPatch(patch);
					const flatBlocks = blocks.flatMap(nestedBlocks);
					const blockTypes = flatBlocks.map((block) => String(block.type ?? ''));
					const queryBlockCount = flatBlocks.filter((block) => block.type === 'queryBlock').length;
					const complete =
						executableCells.length >= 3 &&
						serializedCells.includes('revenue_by_month') &&
						serializedCells.includes('region_performance') &&
						serializedCells.includes('product_mix') &&
						blockTypes.includes('queryBlock') &&
						blockTypes.includes('tabs') &&
						blockTypes.some((type) => ['grid', 'columns', 'card'].includes(type)) &&
						queryBlockCount >= 3;
					if (complete) return;

					messages = [
						...messages,
						{
							role: 'user',
							content:
								`Tool results:\n\napply_notebook_patch was incomplete. It had ${executableCells.length} executable cell(s), ` +
								`${queryBlockCount} queryBlock placement(s), and block types: ${[...new Set(blockTypes)].join(', ')}.\n\n` +
								'Repair it now with apply_notebook_patch. Keep SQL one-line and short. Use arrays as arrays, not JSON strings. Include executableCells for revenue_by_month, region_performance, and product_mix, and include at least three matching queryBlock blocks inside nested tabs plus grid or columns. Do not call create_notebook.'
						},
						{ role: 'assistant', content: '' }
					];
					continue;
				}

				const inspected = calls.some((call) => call.tool === 'inspect_notebook');
				const toolResult = inspected
					? JSON.stringify(
							{
								notebookId: 'active-notebook',
								name: 'Untitled',
								document: {
									type: 'doc',
									content: [
										{
											type: 'queryBlock',
											attrs: { cellId: 'starter', cellType: 'query', pinned: true }
										}
									]
								},
								executableCells: [
									{
										cellId: 'starter',
										outputName: 'starter',
										cellType: 'query',
										language: 'sql',
										code: 'select 0 as seed',
										status: 'idle',
										columns: []
									}
								]
							},
							null,
							2
						)
					: 'No notebook mutation yet.';
				messages = [
					...messages,
					{
						role: 'user',
						content: `Tool results:\n\n${toolResult}\n\nNow call apply_notebook_patch with blueprint.executableCells as an array of three short SQL cells and blueprint.blocks as an array with nested tabs plus grid or columns and three queryBlock placements. Do not stringify arrays. Do not call create_notebook.`
					},
					{ role: 'assistant', content: '' }
				];
			}

			throw new Error(
				`NVIDIA model did not emit a complex apply_notebook_patch. Tools: ${allCalls
					.map((call) => call.tool)
					.join(', ')}`
			);
		},
		240_000
	);
});
