import { describe, expect, it } from 'vitest';
import {
	compileGeneratedDashboard,
	FILTER_KINDS,
	SUPPORTED_BLOCK_TYPES,
	type GeneratedDashboardBlock,
	type GeneratedDashboardDefinition
} from './generated-dashboard.js';
import {
	CUSTOM_MARKDOC_TAGS,
	FILTER_WIDGET_KINDS,
	validateMarkdocMarkdown
} from './markdoc-interp.js';
import type { AIChatCell } from '$lib/types/ai-chat.js';

// Tags that are only ever valid nested inside their container (column inside columns, tab
// inside tabs) or that fold into a differently-named block type (if/else -> conditional) — these
// deliberately have no standalone entry in SUPPORTED_BLOCK_TYPES.
const TAG_TO_BLOCK_TYPE: Record<string, string | null> = {
	column: null,
	tab: null,
	if: 'conditional',
	else: null
};

function makeCell(
	outputName: string,
	cellType: AIChatCell['cellType'] = 'query',
	resultColumns: string[] = ['metric']
): AIChatCell {
	return {
		id: outputName,
		outputName,
		language: 'sql',
		cellType,
		code: '',
		resultColumns,
		status: 'success'
	};
}

describe('compileGeneratedDashboard', () => {
	it('compiles structured notebook UI into canonical markdoc', () => {
		const definition: GeneratedDashboardDefinition = {
			title: 'Executive Summary',
			statusBadge: { value: 'Live', color: 'success' },
			blocks: [
				{
					type: 'grid',
					cols: 2,
					items: [
						{
							type: 'metric',
							value: '$monthly_revenue.total_revenue',
							label: 'Revenue',
							format: 'currency'
						},
						{
							type: 'progress',
							value: '$quota_attainment.attainment_pct',
							max: 100,
							label: 'Quota %',
							color: 'success'
						}
					]
				},
				{
					type: 'tabs',
					tabs: [
						{
							label: 'Trend',
							blocks: [{ type: 'chart', ref: '$monthly_revenue', chartType: 'line' }]
						},
						{
							label: 'Drilldown',
							blocks: [
								{
									type: 'datatable',
									data: '$top_products.rows',
									cols: ['product', 'total_revenue'],
									limit: 5
								}
							]
						}
					]
				}
			]
		};

		const result = compileGeneratedDashboard(definition, {
			knownCells: [
				makeCell('monthly_revenue'),
				makeCell('quota_attainment'),
				makeCell('top_products', 'python')
			]
		});

		expect(result.errors).toEqual([]);
		expect(result.markdown).toContain('## Executive Summary');
		expect(result.markdown).toContain('{% badge value="Live" color="success" /%}');
		expect(result.markdown).toContain(
			'{% metric value=$monthly_revenue.total_revenue label="Revenue" format="currency" /%}'
		);
		expect(result.markdown).toContain(
			'{% progress value=$quota_attainment.attainment_pct max=100 label="Quota %" color="success" /%}'
		);
		expect(result.markdown).toContain('{% chart ref=$monthly_revenue type="line" /%}');
		expect(result.markdown).toContain(
			'{% datatable data=$top_products.rows cols=["product","total_revenue"] limit=5 /%}'
		);
	});

	it('rejects placeholder and staging refs', () => {
		const result = compileGeneratedDashboard(
			{
				blocks: [
					{ type: 'metric', value: '$cell.total', label: 'Bad' },
					{ type: 'chart', ref: '$stg_orders', chartType: 'bar' }
				]
			},
			{ knownCells: [makeCell('stg_orders')] }
		);

		expect(result.errors.join(' ')).toMatch(/\$cell|staging/i);
	});

	it('rejects unknown refs', () => {
		const result = compileGeneratedDashboard(
			{
				blocks: [{ type: 'metric', value: '$missing.total', label: 'Missing' }]
			},
			{ knownCells: [makeCell('orders')] }
		);

		expect(result.errors.join(' ')).toMatch(/unknown/i);
	});

	it('errors on unknown block types instead of silently dropping them', () => {
		const result = compileGeneratedDashboard(
			{
				blocks: [
					{ type: 'heading', text: 'Not a real block' } as unknown as GeneratedDashboardBlock,
					{ type: 'metric', value: '$orders.total', label: 'Revenue' }
				]
			},
			{ knownCells: [makeCell('orders')] }
		);

		expect(result.errors.join(' ')).toMatch(/unsupported block type "heading"/i);
		// The valid sibling still compiles.
		expect(result.markdown).toContain('{% metric value=$orders.total label="Revenue" /%}');
	});

	it('compiles card, gap presets, and column widths', () => {
		const result = compileGeneratedDashboard(
			{
				blocks: [
					{
						type: 'card',
						title: 'Revenue',
						accent: 'info',
						blocks: [
							{
								type: 'grid',
								cols: 2,
								gap: 'compact',
								items: [{ type: 'metric', value: '$orders.total', label: 'Total' }]
							},
							{
								type: 'columns',
								gap: 'comfortable',
								columns: [
									{ width: 2, blocks: [{ type: 'text', content: 'Left' }] },
									{ width: '300px', blocks: [{ type: 'text', content: 'Right' }] }
								]
							}
						]
					}
				]
			},
			{ knownCells: [makeCell('orders')] }
		);

		expect(result.errors).toEqual([]);
		expect(result.markdown).toContain('{% card title="Revenue" accent="info" %}');
		expect(result.markdown).toContain('{% grid cols=2 gap="compact" %}');
		expect(result.markdown).toContain('{% columns gap="comfortable" %}');
		expect(result.markdown).toContain('{% column width=2 %}');
		expect(result.markdown).toContain('{% column width="300px" %}');
	});

	it('compiles datatable pivot/summary attributes', () => {
		const result = compileGeneratedDashboard(
			{
				blocks: [
					{
						type: 'datatable',
						data: '$orders.rows',
						index: ['region'],
						pivotBy: 'category',
						valueCol: 'revenue',
						agg: 'sum',
						round: 2,
						valueFormatKind: 'currency',
						valueCurrencySymbol: '€',
						pageSize: 25,
						headerInsights: 'full'
					}
				]
			},
			{ knownCells: [makeCell('orders')] }
		);

		expect(result.errors).toEqual([]);
		expect(result.markdown).toContain(
			'{% datatable data=$orders.rows pageSize=25 headerInsights="full" index=["region"] pivotBy="category" valueCol="revenue" agg="sum" round=2 valueFormatKind="currency" valueCurrencySymbol="€" /%}'
		);
	});

	it('compiles datatable conditionalFormats and callout title', () => {
		const result = compileGeneratedDashboard(
			{
				blocks: [
					{
						type: 'datatable',
						data: '$orders.rows',
						conditionalFormats: [
							{
								column: 'revenue',
								rules: [{ type: 'threshold', op: '>', value: 10000, tone: 'positive' }]
							}
						]
					},
					{
						type: 'callout',
						variant: 'warning',
						title: 'Heads up',
						blocks: [{ type: 'text', content: 'Careful.' }]
					}
				]
			},
			{ knownCells: [makeCell('orders')] }
		);

		expect(result.errors).toEqual([]);
		expect(result.markdown).toContain('conditionalFormats=[{"column":"revenue"');
		expect(result.markdown).toContain(
			'"type":"threshold","op":">","value":10000,"tone":"positive"'
		);
		expect(result.markdown).toContain('{% callout type="warning" title="Heads up" %}');
	});

	it('compiles a divider to a thematic break', () => {
		const result = compileGeneratedDashboard(
			{
				blocks: [
					{ type: 'text', content: 'Above' },
					{ type: 'divider' },
					{ type: 'text', content: 'Below' }
				]
			},
			{}
		);

		expect(result.errors).toEqual([]);
		expect(result.markdown).toContain('Above\n\n---\n\nBelow');
	});

	it('normalizes legacy filter kind "multi" and rejects unknown kinds', () => {
		const ok = compileGeneratedDashboard(
			{
				blocks: [
					{ type: 'filter', kind: 'multi', param: 'region', label: 'Region', options: ['N', 'S'] },
					{
						type: 'filter',
						kind: 'date-range',
						param: 'window',
						label: 'Window',
						startParam: 'start_date',
						endParam: 'end_date'
					}
				]
			},
			{ knownCells: [makeCell('orders')] }
		);
		expect(ok.errors).toEqual([]);
		expect(ok.markdown).toContain('kind="multi-select"');
		expect(ok.markdown).toContain('startParam="start_date" endParam="end_date"');

		const bad = compileGeneratedDashboard(
			{
				blocks: [
					{
						type: 'filter',
						kind: 'slider' as unknown as 'dropdown',
						param: 'x',
						label: 'X'
					}
				]
			},
			{ knownCells: [makeCell('orders')] }
		);
		expect(bad.errors.join(' ')).toMatch(/unsupported filter kind "slider"/i);
	});

	it('keeps the AI filter kinds in sync with the runtime filter tag', () => {
		expect([...FILTER_KINDS].sort()).toEqual([...FILTER_WIDGET_KINDS].sort());
	});

	it('compiles mermaid codeRef, each, and group loop blocks', () => {
		const result = compileGeneratedDashboard(
			{
				blocks: [
					{ type: 'mermaid', codeRef: '$pipeline.diagram_text' },
					{ type: 'each', data: '$orders.rows', template: '- $product: $revenue' },
					{
						type: 'group',
						data: '$orders.rows',
						by: 'region',
						order: ['North', 'South'],
						template: '$keyId[$key]'
					}
				]
			},
			{ knownCells: [makeCell('orders'), makeCell('pipeline')] }
		);

		expect(result.errors).toEqual([]);
		expect(result.markdown).toContain('{% mermaid code=$pipeline.diagram_text %}');
		expect(result.markdown).toContain(
			'{% each data=$orders.rows %}\n- $product: $revenue\n{% /each %}'
		);
		expect(result.markdown).toContain(
			'{% group data=$orders.rows by="region" order=["North","South"] %}'
		);
	});

	it('omits max on progress when not provided (runtime defaults to 100)', () => {
		const result = compileGeneratedDashboard(
			{ blocks: [{ type: 'progress', value: '$orders.done_pct', label: 'Done' }] },
			{ knownCells: [makeCell('orders')] }
		);
		expect(result.errors).toEqual([]);
		expect(result.markdown).toContain('{% progress value=$orders.done_pct label="Done" /%}');
	});

	it('every custom Markdoc tag has a corresponding typed dashboard block type', () => {
		// Regression guard: video/embed/bookmark/math/toc shipped as real, working Markdoc
		// tags but were never added to the typed dashboard block union — the AI's *preferred*
		// authoring path silently couldn't produce them. This fails loudly the next time a new
		// tag lands in markdoc-tag-registry.ts without a matching SUPPORTED_BLOCK_TYPES entry.
		for (const tag of CUSTOM_MARKDOC_TAGS) {
			const expected = tag in TAG_TO_BLOCK_TYPE ? TAG_TO_BLOCK_TYPE[tag] : tag;
			if (expected === null) continue;
			expect(SUPPORTED_BLOCK_TYPES, `tag "${tag}"`).toContain(expected);
		}
	});

	it('kitchen-sink definition compiles to Markdoc the runtime tag schemas accept', () => {
		const definition: GeneratedDashboardDefinition = {
			title: 'Full Surface',
			statusBadge: { value: 'Live', color: 'success' },
			blocks: [
				{ type: 'text', content: 'Intro prose with $orders.count live ref.' },
				{
					type: 'card',
					title: 'KPIs',
					accent: 'info',
					blocks: [
						{
							type: 'grid',
							cols: 3,
							gap: 'compact',
							items: [
								{ type: 'metric', value: '$orders.total', label: 'Revenue', format: 'currency' },
								{ type: 'badge', value: '$orders.status', color: 'warning' },
								{ type: 'progress', value: '$orders.done_pct', label: 'Done' }
							]
						}
					]
				},
				{
					type: 'columns',
					gap: 'default',
					columns: [
						{
							width: 2,
							blocks: [
								{ type: 'chart', data: '$orders.rows', chartType: 'bar', x: 'month', y: 'revenue' }
							]
						},
						{
							blocks: [
								{
									type: 'datatable',
									data: '$orders.rows',
									index: ['region'],
									valueCol: 'revenue',
									agg: 'sum',
									valueFormatKind: 'currency'
								}
							]
						}
					]
				},
				{
					type: 'tabs',
					tabs: [
						{
							label: 'Filters',
							blocks: [
								{
									type: 'filter',
									kind: 'multi',
									param: 'region',
									label: 'Region',
									optionsColumn: 'region'
								},
								{
									type: 'filter',
									kind: 'numeric-range',
									param: 'rev',
									label: 'Revenue',
									minParam: 'rev_min',
									maxParam: 'rev_max'
								}
							]
						},
						{
							label: 'Diagram',
							blocks: [
								{ type: 'mermaid', code: 'flowchart LR\n  a --> b' },
								{ type: 'each', data: '$orders.rows', template: '- $product' },
								{ type: 'group', data: '$orders.rows', by: 'region', template: '$keyId[$key]' }
							]
						}
					]
				},
				{
					type: 'details',
					summary: 'Notes',
					open: true,
					blocks: [
						{ type: 'callout', variant: 'warning', blocks: [{ type: 'text', content: 'Careful.' }] }
					]
				},
				{
					type: 'conditional',
					test: { op: 'equals', left: '$orders.count', right: 0 },
					then: [{ type: 'text', content: 'No data.' }],
					else: [{ type: 'text', content: 'Data present.' }]
				},
				{ type: 'divider' },
				{ type: 'toc' },
				{ type: 'math', latex: 'E = mc^2', display: true },
				{ type: 'video', src: 'https://example.com/clip.mp4', poster: 'https://example.com/p.jpg' },
				{ type: 'embed', url: 'https://youtube.com/watch?v=abc', aspect: '16:9' },
				{ type: 'bookmark', url: 'https://example.com', title: 'Example' }
			]
		};

		const result = compileGeneratedDashboard(definition, {
			knownCells: [makeCell('orders')]
		});
		expect(result.errors).toEqual([]);

		// Cross-check: the compiled output must validate against the REAL runtime tag
		// schemas in markdoc-interp (attribute names, matches lists, required attrs).
		// Undefined-variable diagnostics are expected (no live cells here) and ignored.
		const diagnostics = validateMarkdocMarkdown(result.markdown, []).filter(
			(d) => !/undefined variable/i.test(d.message)
		);
		expect(diagnostics).toEqual([]);
	});
});
