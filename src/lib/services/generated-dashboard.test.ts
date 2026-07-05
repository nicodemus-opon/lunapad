import { describe, expect, it } from 'vitest';
import {
	compileGeneratedDashboard,
	type GeneratedDashboardDefinition
} from './generated-dashboard.js';
import type { AIChatCell } from '$lib/types/ai-chat.js';

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
});
