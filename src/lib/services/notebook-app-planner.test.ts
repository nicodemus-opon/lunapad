import { describe, expect, it } from 'vitest';
import {
	planNotebookApp,
	repairNotebookBlueprint,
	sampleLocalViewComposition,
	scoreNotebookBlueprint
} from './notebook-app-planner';

describe('notebook app planner', () => {
	it('plans broad data apps as primitives instead of hard-routed app types', () => {
		const plan = planNotebookApp({
			prompt: 'Create an exploratory data app with filters, chart, table, and detail panels',
			availableOutputNames: ['orders', 'customers']
		});
		expect(plan.compileTarget).toBe('notebook');
		expect(plan.intent.evaluationLabels).toContain('explorer');
		expect(plan.intent.viewNeeds).toEqual(expect.arrayContaining(['chart', 'table', 'filter']));
		expect(plan.intent.componentIds).toEqual(
			expect.arrayContaining(['chart', 'datatable', 'filter'])
		);
		expect(plan.nextTools).toEqual(expect.arrayContaining(['create_notebook']));
		expect(plan.compositionSamples[0]).toEqual(expect.arrayContaining(['chart', 'table']));
	});

	it('keeps infographic/report requests supported without overfitting the planner', () => {
		const plan = planNotebookApp({
			prompt: 'Make a publication-ready infographic report poster with a map and narrative'
		});
		expect(plan.intent.primaryWorkflow).toBe('publish');
		expect(plan.intent.evaluationLabels).toContain('infographic_report');
		expect(plan.viewSkeleton).toEqual(expect.arrayContaining(['narrative', 'map']));
	});

	it('repairs minor component and grid issues deterministically', () => {
		const result = repairNotebookBlueprint({
			title: 'Repair Me',
			blocks: [
				{
					type: 'grid',
					cols: 8,
					items: [
						{ type: 'metric', value: 12, label: 'Bad icon', icon: 'NotAnIcon' },
						{ type: 'chart', chartType: 'radar' as never, data: '$rows.rows' }
					]
				},
				{ type: 'filter', kind: 'mega-select' as never, param: 'region', label: 'Region' }
			]
		});
		expect(result.repairLog.map((entry) => entry.action)).toEqual(
			expect.arrayContaining([
				'grid cols -> 1-4 range',
				'unknown icon -> removed',
				'invalid chart type -> fallback',
				'large grid item -> sibling block',
				'invalid filter kind -> dropdown'
			])
		);
		expect(result.blueprint.blocks[0]).toMatchObject({ type: 'grid', cols: 4 });
		expect(result.blueprint.blocks[1]).toMatchObject({ type: 'chart', chartType: 'table' });
		expect(result.blueprint.blocks[2]).toMatchObject({ type: 'filter', kind: 'dropdown' });
	});

	it('splits overloaded grids and removes unwired filters without making the attempt fatal', () => {
		const result = repairNotebookBlueprint({
			blocks: [
				{
					type: 'grid',
					cols: 2,
					items: Array.from({ length: 8 }, (_, index) => ({
						type: 'metric' as const,
						value: index,
						label: `Metric ${index}`
					}))
				},
				{ type: 'filter', kind: 'dropdown', label: 'Unwired' } as never
			]
		});
		expect(result.repairLog.map((entry) => entry.action)).toEqual(
			expect.arrayContaining(['overloaded grid -> split section', 'unwired filter -> removed'])
		);
		expect(result.blueprint.blocks.filter((block) => block.type === 'grid')).toHaveLength(2);
		expect(result.blueprint.blocks.some((block) => block.type === 'filter')).toBe(false);
		expect(result.diagnostics).toEqual([]);
	});

	it('normalizes chart prop dialects before validation so almost-right configs do not render blank', () => {
		const result = repairNotebookBlueprint(
			{
				blocks: [
					{
						type: 'chart',
						dataRef: '$monthly',
						chartConfig: {
							type: 'line',
							xColumn: 'month',
							yColumns: 'revenue,profit',
							color: 'segment'
						}
					} as never,
					{
						type: 'bar',
						source: '$segments',
						xColumn: 'segment',
						yColumn: 'revenue'
					} as never,
					{
						type: 'datatable',
						source: '$orders',
						cols: 'order_id,customer_name,revenue'
					} as never
				]
			},
			{ knownRefs: ['monthly', 'segments', 'orders'] }
		);
		expect(result.repairLog.map((entry) => entry.action)).toEqual(
			expect.arrayContaining([
				'chart config object -> chart props',
				'xColumn -> x',
				'yColumns -> string array',
				'color -> colorColumn',
				'dataRef -> data rows',
				'chart type alias -> chart block',
				'source -> data rows',
				'cols -> string array'
			])
		);
		expect(result.blueprint.blocks[0]).toMatchObject({
			type: 'chart',
			chartType: 'line',
			data: '$monthly.rows',
			x: 'month',
			yColumns: ['revenue', 'profit'],
			colorColumn: 'segment'
		});
		expect(result.blueprint.blocks[1]).toMatchObject({
			type: 'chart',
			chartType: 'bar',
			data: '$segments.rows',
			x: 'segment',
			y: 'revenue'
		});
		expect(result.blueprint.blocks[2]).toMatchObject({
			type: 'datatable',
			data: '$orders.rows',
			cols: ['order_id', 'customer_name', 'revenue']
		});
		expect(result.diagnostics).toEqual([]);
	});

	it('uses explicit chart encodings to make fresh refs render instead of relying on inherited config', () => {
		const result = repairNotebookBlueprint({
			blocks: [{ type: 'chart', ref: '$fresh_cell', xColumn: 'month', yColumn: 'revenue' } as never]
		});
		expect(result.blueprint.blocks[0]).toMatchObject({
			type: 'chart',
			ref: '$fresh_cell',
			data: '$fresh_cell.rows',
			x: 'month',
			y: 'revenue'
		});
		expect(result.repairLog.map((entry) => entry.action)).toEqual(
			expect.arrayContaining(['chart ref with explicit encoding -> data rows'])
		);
	});

	it('normalizes non-chart component dialects through the same fail-soft repair path', () => {
		const result = repairNotebookBlueprint(
			{
				blocks: [
					{
						type: 'if',
						condition: 'gt($orders.count, 0)',
						children: 'Orders are available',
						otherwise: [{ type: 'markdown', content: 'No orders yet' }]
					} as never,
					{
						type: 'foreach',
						items: '$orders',
						body: [{ type: 'text', content: '- $customer_name: $revenue' }]
					} as never,
					{
						type: 'group',
						source: '$orders',
						groupBy: 'region',
						order: 'East,West',
						content: '$key'
					} as never,
					{
						type: 'tabs',
						sections: [
							{ title: 'Summary', content: 'Summary body' },
							{ name: 'Detail', children: [{ type: 'table', source: '$orders' }] }
						]
					} as never,
					{
						type: 'columns',
						items: [
							{ body: { type: 'badge', status: '$orders.status', color: 'loud' } },
							{ content: { type: 'progress', current: '$orders.complete', total: 100 } }
						]
					} as never,
					{
						type: 'details',
						label: 'Lineage',
						body: { type: 'mermaid', diagram: 'flowchart LR\nA --> B' }
					} as never,
					{
						type: 'callout',
						severity: 'warning',
						content: 'Check late orders'
					} as never,
					{ type: 'filter', name: 'region', controlType: 'multi', options: 'East,West' } as never,
					{ type: 'math', formula: 'E = mc^2' } as never,
					{ type: 'embed', href: 'https://example.com' } as never,
					{ type: 'video', url: 'https://example.com/video.mp4' } as never
				]
			},
			{ knownRefs: ['orders'] }
		);

		expect(result.repairLog.map((entry) => entry.action)).toEqual(
			expect.arrayContaining([
				'component type alias -> canonical type',
				'string content -> text block',
				'markdown alias -> text',
				'items -> data rows',
				'groupBy -> by',
				'order -> string array',
				'table block alias -> datatable',
				'invalid enum -> fallback',
				'label -> summary',
				'diagram -> code',
				'severity -> variant',
				'name -> param',
				'controlType -> kind',
				'options -> string array',
				'formula -> latex',
				'href -> url',
				'url -> src'
			])
		);
		expect(result.blueprint.blocks[0]).toMatchObject({
			type: 'conditional',
			test: { op: 'gt', left: '$orders.count', right: '0' },
			then: [{ type: 'text', content: 'Orders are available' }],
			else: [{ type: 'text', content: 'No orders yet' }]
		});
		expect(result.blueprint.blocks[1]).toMatchObject({
			type: 'each',
			data: '$orders.rows',
			template: '- $customer_name: $revenue'
		});
		expect(result.blueprint.blocks[2]).toMatchObject({
			type: 'group',
			data: '$orders.rows',
			by: 'region',
			order: ['East', 'West'],
			template: '$key'
		});
		expect(result.blueprint.blocks[3]).toMatchObject({
			type: 'tabs',
			tabs: [
				{ label: 'Summary', blocks: [{ type: 'text', content: 'Summary body' }] },
				{ label: 'Detail', blocks: [{ type: 'datatable', data: '$orders.rows' }] }
			]
		});
		expect(result.blueprint.blocks[4]).toMatchObject({
			type: 'columns',
			columns: [
				{ blocks: [{ type: 'badge', value: '$orders.status', color: 'neutral' }] },
				{ blocks: [{ type: 'progress', value: '$orders.complete', max: 100 }] }
			]
		});
		expect(result.blueprint.blocks[5]).toMatchObject({
			type: 'details',
			summary: 'Lineage',
			blocks: [{ type: 'mermaid', code: 'flowchart LR\nA --> B' }]
		});
		expect(result.blueprint.blocks[6]).toMatchObject({
			type: 'callout',
			variant: 'warning',
			blocks: [{ type: 'text', content: 'Check late orders' }]
		});
		expect(result.blueprint.blocks[7]).toMatchObject({
			type: 'filter',
			param: 'region',
			kind: 'multi-select',
			options: ['East', 'West']
		});
		expect(result.blueprint.blocks[8]).toMatchObject({ type: 'math', latex: 'E = mc^2' });
		expect(result.blueprint.blocks[9]).toMatchObject({
			type: 'embed',
			url: 'https://example.com'
		});
		expect(result.blueprint.blocks[10]).toMatchObject({
			type: 'video',
			src: 'https://example.com/video.mp4'
		});
		expect(result.diagnostics).toEqual([]);
	});

	it('keeps unsafe staging refs fatal in presentation views', () => {
		const result = repairNotebookBlueprint(
			{
				blocks: [
					{ type: 'chart', data: '$stg_orders.rows', chartType: 'bar', x: 'day', y: 'orders' }
				]
			},
			{ knownRefs: ['stg_orders'] }
		);
		expect(result.repairLog).toEqual([]);
		expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toMatch(
			/Unsafe reporting reference/
		);
	});

	it('uses lightweight local adjacency sampling for composition instead of app-type routing', () => {
		const samples = sampleLocalViewComposition(['filter', 'chart', 'table', 'detail_panel']);
		expect(samples.length).toBeGreaterThan(0);
		expect(samples[0][0]).toBe('filter');
		expect(samples[0]).toContain('chart');
		expect(samples[0]).toContain('table');
	});

	it('covers dashboard, simulator, data-manager, and Q&A labels as eval hints only', () => {
		const prompts = [
			['dashboard', 'Build an ops dashboard with KPI monitor and SLA table'],
			['simulator', 'Build a what if simulator with scenario controls'],
			['data_manager', 'Build a CRUD manager to approve records'],
			['qa', 'Build a Q&A answer app with cited lineage']
		] as const;
		for (const [label, prompt] of prompts) {
			const plan = planNotebookApp({ prompt });
			expect(plan.intent.evaluationLabels).toContain(label);
			expect(plan.compileTarget).toBe('notebook');
			expect(plan.nextTools).toEqual(expect.arrayContaining(['create_notebook']));
		}
	});

	it('scores valid downgraded candidates instead of treating every repair as fatal', () => {
		const score = scoreNotebookBlueprint(
			{
				title: 'Candidate',
				blocks: [
					{ type: 'text', content: '# Candidate' },
					{ type: 'columns', columns: [{ blocks: [{ type: 'chart', data: '$rows.rows' }] }] },
					{ type: 'datatable', data: '$rows.rows' },
					{
						type: 'details',
						summary: 'Lineage',
						blocks: [{ type: 'text', content: 'From $rows.' }]
					}
				]
			},
			{ knownRefs: ['rows'] }
		);
		expect(score.score).toBeGreaterThan(50);
		expect(score.breakdown).toMatchObject({
			dataViews: expect.any(Number),
			layout: expect.any(Number),
			interaction: expect.any(Number)
		});
	});
});
