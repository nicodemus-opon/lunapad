import type { AIChatCell, AIChatSchemaTable } from '$lib/types/ai-chat.js';
import { buildSalesAnalyticsDemo } from '$lib/demo/sales-analytics-demo';

const ORDERS_COLS = [
	'order_id',
	'order_date',
	'product',
	'category',
	'customer_segment',
	'quantity',
	'unit_price',
	'region'
];

export const DASHBOARD_SCHEMA: AIChatSchemaTable[] = [
	{
		name: 'orders',
		columns: ORDERS_COLS,
		columnTypes: [
			'INTEGER',
			'DATE',
			'VARCHAR',
			'VARCHAR',
			'VARCHAR',
			'INTEGER',
			'DOUBLE',
			'VARCHAR'
		],
		rowCount: 2000
	},
	{
		name: 'region_targets',
		columns: ['target_region', 'quota'],
		columnTypes: ['VARCHAR', 'DOUBLE'],
		rowCount: 5
	}
];

/** Notebook context cells for dashboard AI tests — mirrors sales demo query cells. */
export function buildDashboardFixtureCells(): AIChatCell[] {
	const nb = buildSalesAnalyticsDemo();
	return nb.cells
		.filter((c) => c.cellType === 'query')
		.map((c) => ({
			id: c.id,
			outputName: c.outputName,
			language: c.language,
			cellType: 'query' as const,
			code: c.code.slice(0, 400),
			resultColumns:
				c.outputName === 'orders'
					? ORDERS_COLS
					: c.outputName === 'region_targets'
						? ['target_region', 'quota']
						: c.outputName === 'monthly_revenue'
							? ['month', 'total_revenue', 'order_count']
							: c.outputName === 'region_performance'
								? ['region', 'total_revenue', 'quota']
								: c.outputName === 'top_products'
									? ['product', 'total_revenue', 'units_sold']
									: c.outputName === 'category_breakdown'
										? ['category', 'total_revenue', 'order_count']
										: c.outputName === 'quota_attainment'
											? ['attainment_pct']
											: ['col'],
			status: c.outputName === 'broken_model' ? 'error' : 'success',
			upstream: [],
			downstream: [],
			isActiveNotebook: true,
			errorMessage:
				c.outputName === 'broken_model'
					? 'Binder Error: Referenced column "nonexistent_col" not found'
					: undefined
		}));
}

export function bloatedDashboardCells(): AIChatCell[] {
	const base = buildDashboardFixtureCells();
	const extras: AIChatCell[] = [];
	for (let i = 0; i < 34; i++) {
		extras.push({
			id: `scratch-${i}`,
			outputName: `scratch_${i}`,
			language: 'sql',
			cellType: 'query',
			code: `SELECT region FROM orders GROUP BY region`,
			resultColumns: ['region'],
			status: 'success',
			isActiveNotebook: false
		});
	}
	return [...base, ...extras];
}

export function stgOnlyCells(): AIChatCell[] {
	return [
		{
			id: 'stg-1',
			outputName: 'stg_orders',
			language: 'sql',
			cellType: 'query',
			code: 'SELECT * FROM orders',
			resultColumns: ORDERS_COLS,
			status: 'success',
			isActiveNotebook: true
		}
	];
}
