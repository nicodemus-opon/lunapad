import { describe, expect, it } from 'vitest';
import {
	compileNotebookBlueprint,
	validateNotebookPmDocument,
	type NotebookBlueprint
} from './notebook-blueprint';

describe('notebook-blueprint', () => {
	it('compiles nested notebook blueprints into valid PM nodes', () => {
		const blueprint: NotebookBlueprint = {
			title: 'Executive Revenue Review',
			executableCells: [
				{
					cellId: 'q_monthly_revenue',
					outputName: 'monthly_revenue',
					cellType: 'query',
					language: 'sql',
					code: 'SELECT month, SUM(revenue) AS revenue FROM orders GROUP BY 1'
				}
			],
			blocks: [
				{ type: 'text', content: '## Overview\n\nLive revenue from $monthly_revenue.revenue.' },
				{ type: 'queryBlock', cellId: 'q_monthly_revenue' },
				{
					type: 'tabs',
					tabs: [
						{
							label: 'Summary',
							blocks: [
								{
									type: 'columns',
									columns: [
										{
											width: 2,
											blocks: [
												{
													type: 'card',
													title: 'Trend',
													blocks: [
														{
															type: 'chart',
															ref: '$monthly_revenue',
															chartType: 'line'
														}
													]
												}
											]
										},
										{
											blocks: [
												{
													type: 'grid',
													cols: 1,
													items: [
														{
															type: 'metric',
															value: '$monthly_revenue.revenue',
															label: 'Revenue',
															format: 'currency'
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
			]
		};

		const compiled = compileNotebookBlueprint(blueprint);
		expect(compiled.diagnostics).toEqual([]);
		expect(compiled.document).not.toBeNull();
		expect(validateNotebookPmDocument(compiled.document!)).toEqual([]);
		expect(compiled.document?.content?.some((node) => node.type === 'queryBlock')).toBe(true);
		expect(
			JSON.stringify(compiled.document).includes('"tagName":"tabs"') ||
				JSON.stringify(compiled.document).includes('\\"tagName\\":\\"tabs\\"')
		).toBe(true);
	});

	it('reports exact diagnostics for missing query payloads and unknown refs', () => {
		const compiled = compileNotebookBlueprint(
			{
				title: 'Broken',
				blocks: [
					{ type: 'queryBlock', cellId: 'q_missing' },
					{ type: 'metric', value: '$missing.total', label: 'Missing' }
				]
			},
			['known_cell']
		);

		expect(compiled.document).toBeNull();
		expect(compiled.diagnostics.map((d) => d.path)).toEqual(
			expect.arrayContaining(['blocks.0', 'blocks.1'])
		);
		expect(compiled.diagnostics.map((d) => d.message).join('\n')).toMatch(
			/q_missing|Unknown live reference/
		);
	});
});
