import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	__executeToolCallWithResultForTests,
	wantsNotebookRendering
} from './ai-chat-client.js';
import {
	__resetStateForTests,
	addNotebook,
	getActiveTabId,
	getNotebooks,
	getOpenNotebookTabIds,
	openNotebookTab
} from '$lib/stores/notebook.svelte.js';
import { clearAIToolAuthCache } from '$lib/agent/tools/authorize.js';
import type { AIChatToolCall } from '$lib/types/ai-chat.js';
import { cellsToPmDocument } from './notebook-pm.js';
import type { PMDocJSON, PMNodeJSON } from './markdoc-pm.js';
import type { NotebookBlueprint } from './notebook-blueprint.js';

beforeEach(() => {
	__resetStateForTests();
	clearAIToolAuthCache();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			return new Response(JSON.stringify({ allowed: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		})
	);
});

describe('wantsNotebookRendering', () => {
	it('recognizes notebook composition requests beyond dashboard/chart wording', () => {
		for (const prompt of [
			'build a notebook report for revenue',
			'create docs for this analysis',
			'document the findings from these cells',
			'compose a notebook summary around the results',
			'add insights sections after building the models'
		]) {
			expect(wantsNotebookRendering(prompt), prompt).toBe(true);
		}
	});

	it('does not trigger for plain model-building requests with no presentation ask', () => {
		for (const prompt of [
			'build a staging model for orders',
			'create a fact table for sessions',
			'generate a revenue metric'
		]) {
			expect(wantsNotebookRendering(prompt), prompt).toBe(false);
		}
	});
});

describe('AI notebook patch executor', () => {
	function countNodes(doc: PMDocJSON, predicate: (node: PMNodeJSON) => boolean): number {
		const visit = (node: PMNodeJSON): number =>
			(predicate(node) ? 1 : 0) + (node.content ?? []).reduce((sum, child) => sum + visit(child), 0);
		return (doc.content ?? []).reduce((sum, node) => sum + visit(node), 0);
	}

	it('adds a new executable query node to the active notebook and renames it', async () => {
		const beforeNotebookId = getActiveTabId();
		const beforeCount = getNotebooks().length;
		const call: AIChatToolCall = {
			callId: 'patch-1',
			tool: 'apply_notebook_patch',
			args: {
				title: 'Revenue Notebook',
				blueprint: {
					executableCells: [
						{
							cellId: 'q_revenue_by_month',
							outputName: 'revenue_by_month',
							cellType: 'query',
							language: 'sql',
							code: 'select 1 as month, 100 as revenue'
						}
					],
					blocks: [
						{ type: 'text', content: '# Revenue Notebook\n\nA fresh revenue query.' },
						{ type: 'queryBlock', cellId: 'q_revenue_by_month' }
					]
				}
			}
		};

		const result = await __executeToolCallWithResultForTests(call, 'ai-test-message');

		expect(result).toMatch(/patched and validated/);
		expect(getNotebooks()).toHaveLength(beforeCount);
		const notebook = getNotebooks().find((entry) => entry.id === beforeNotebookId)!;
		expect(notebook.name).toBe('Revenue Notebook');
		const created = notebook.cells.find((cell) => cell.id === 'q_revenue_by_month');
		expect(created?.outputName).toBe('revenue_by_month');
		expect(created?.code).toBe('select 1 as month, 100 as revenue');
	});

	it('renames the active notebook without creating a second notebook', async () => {
		const notebookId = getActiveTabId();
		const beforeCount = getNotebooks().length;
		const call: AIChatToolCall = {
			callId: 'rename-1',
			tool: 'apply_notebook_patch',
			args: { title: 'Renamed Analysis' }
		};

		const result = await __executeToolCallWithResultForTests(call, 'ai-test-message');

		expect(result).toBe("Notebook 'Renamed Analysis' renamed");
		expect(getNotebooks()).toHaveLength(beforeCount);
		expect(getNotebooks().find((entry) => entry.id === notebookId)?.name).toBe('Renamed Analysis');
	});

	it('opens and focuses the patched notebook tab when it is not already active', async () => {
		const originalActiveId = getActiveTabId();
		addNotebook();
		const backgroundNotebookId = getActiveTabId();
		expect(backgroundNotebookId).not.toBe(originalActiveId);
		// Switch focus back so the patched notebook is a background tab.
		openNotebookTab(originalActiveId);
		expect(getActiveTabId()).toBe(originalActiveId);

		const call: AIChatToolCall = {
			callId: 'patch-focus-1',
			tool: 'apply_notebook_patch',
			args: {
				notebookId: backgroundNotebookId,
				title: 'Background Patch Target'
			}
		};

		const result = await __executeToolCallWithResultForTests(call, 'ai-test-message');

		expect(result).toBe("Notebook 'Background Patch Target' renamed");
		expect(getActiveTabId()).toBe(backgroundNotebookId);
		expect(getOpenNotebookTabIds()).toContain(backgroundNotebookId);
	});

	it('updates an existing cell in a background notebook, not the active one', async () => {
		const activeNotebookId = getActiveTabId();

		// Create a second notebook and give it a query cell via apply_notebook_patch while
		// it's active.
		addNotebook();
		const backgroundNotebookId = getActiveTabId();
		expect(backgroundNotebookId).not.toBe(activeNotebookId);
		const createCall: AIChatToolCall = {
			callId: 'setup-1',
			tool: 'apply_notebook_patch',
			args: {
				title: 'Background Target',
				blueprint: {
					executableCells: [
						{
							cellId: 'q_target',
							outputName: 'q_target',
							cellType: 'query',
							language: 'sql',
							code: 'select 1 as stale_value'
						}
					],
					blocks: [{ type: 'queryBlock', cellId: 'q_target' }]
				}
			}
		};
		await __executeToolCallWithResultForTests(createCall, 'ai-test-message');
		const backgroundCellBefore = getNotebooks()
			.find((nb) => nb.id === backgroundNotebookId)
			?.cells.find((c) => c.id === 'q_target');
		expect(backgroundCellBefore?.code).toBe('select 1 as stale_value');

		// Switch focus back to the original notebook — the background notebook is no longer
		// active — then patch its existing cell's code via an explicit notebookId.
		openNotebookTab(activeNotebookId);
		expect(getActiveTabId()).toBe(activeNotebookId);

		const activeCellsBefore = getNotebooks()
			.find((nb) => nb.id === activeNotebookId)
			?.cells.map((c) => c.code);

		const updateCall: AIChatToolCall = {
			callId: 'update-1',
			tool: 'apply_notebook_patch',
			args: {
				notebookId: backgroundNotebookId,
				blueprint: {
					executableCells: [
						{
							cellId: 'q_target',
							outputName: 'q_target',
							cellType: 'query',
							language: 'sql',
							code: 'select 2 as fresh_value'
						}
					],
					blocks: [{ type: 'queryBlock', cellId: 'q_target' }]
				}
			}
		};
		const result = await __executeToolCallWithResultForTests(updateCall, 'ai-test-message');
		expect(result).toMatch(/patched and validated/);

		const backgroundCellAfter = getNotebooks()
			.find((nb) => nb.id === backgroundNotebookId)
			?.cells.find((c) => c.id === 'q_target');
		expect(backgroundCellAfter?.code).toBe('select 2 as fresh_value');

		// The originally-active notebook's cells must be untouched by the background patch.
		const activeCellsAfter = getNotebooks()
			.find((nb) => nb.id === activeNotebookId)
			?.cells.map((c) => c.code);
		expect(activeCellsAfter).toEqual(activeCellsBefore);
	});

	it('materializes a complex nested notebook with multiple executable query nodes', async () => {
		const notebookId = getActiveTabId();
		const beforeCount = getNotebooks().length;
		const blocks = [
			{
				type: 'text',
				content:
					'# Executive Revenue Deep Dive\n\nFinding: revenue, region, and product views are ready.'
			},
			{
				type: 'tabs',
				tabs: [
					{
						label: 'Overview',
						blocks: [
							{
								type: 'grid',
								cols: 2,
								items: [
									{
										type: 'metric',
										value: '$revenue_by_month.revenue',
										label: 'Revenue'
									},
									{
										type: 'chart',
										ref: '$region_performance',
										chartType: 'bar'
									}
								]
							}
						]
					},
					{
						label: 'Details',
						blocks: [
							{
								type: 'columns',
								columns: [
									{
										blocks: [
											{ type: 'queryBlock', cellId: 'q_revenue_by_month' },
											{ type: 'queryBlock', cellId: 'q_region_performance' }
										]
									},
									{
										blocks: [
											{
												type: 'card',
												title: 'Products',
												blocks: [
													{ type: 'queryBlock', cellId: 'q_top_products' },
													{
														type: 'datatable',
														data: '$top_products'
													}
												]
											}
										]
									}
								]
							}
						]
					}
				]
			}
		] as unknown as NotebookBlueprint['blocks'];
		const call: AIChatToolCall = {
			callId: 'complex-patch-1',
			tool: 'apply_notebook_patch',
			args: {
				title: 'Executive Revenue Deep Dive',
				blueprint: {
					executableCells: [
						{
							cellId: 'q_revenue_by_month',
							outputName: 'revenue_by_month',
							cellType: 'query',
							language: 'sql',
							code: 'select date \'2026-01-01\' as month, 100 as revenue'
						},
						{
							cellId: 'q_region_performance',
							outputName: 'region_performance',
							cellType: 'query',
							language: 'sql',
							code: "select 'North' as region, 100 as revenue"
						},
						{
							cellId: 'q_top_products',
							outputName: 'top_products',
							cellType: 'query',
							language: 'sql',
							code: "select 'Widget' as product, 42 as units"
						}
					],
					blocks
				}
			}
		};

		const result = await __executeToolCallWithResultForTests(call, 'ai-test-message');

		expect(result).toMatch(/patched and validated/);
		expect(getNotebooks()).toHaveLength(beforeCount);
		const notebook = getNotebooks().find((entry) => entry.id === notebookId)!;
		expect(notebook.name).toBe('Executive Revenue Deep Dive');
		expect(notebook.cells.map((cell) => cell.outputName)).toEqual(
			expect.arrayContaining(['revenue_by_month', 'region_performance', 'top_products'])
		);
		expect(notebook.cells.find((cell) => cell.id === 'q_top_products')?.code).toContain(
			'Widget'
		);
		const doc = cellsToPmDocument(notebook.cells);
		expect(countNodes(doc, (node) => node.type === 'queryBlock')).toBe(3);
		expect(
			countNodes(
				doc,
				(node) =>
					node.type === 'markdocContainer' &&
					['tabs', 'grid', 'columns', 'card'].includes(String(node.attrs?.tagName ?? ''))
			)
		).toBeGreaterThanOrEqual(4);
	});
});
