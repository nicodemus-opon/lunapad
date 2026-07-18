import { TrendingUp, Gauge } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import type { ChartConfig } from '$lib/types/gui-pipeline';
import { buildSalesAnalyticsDemo, DEMO_NOTEBOOK_NAME } from '../sales-analytics-demo';
import { makeDemoCell, makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

export const salesAnalyticsTemplate: DashboardTemplate = {
	id: 'sales-analytics',
	name: DEMO_NOTEBOOK_NAME,
	description: 'KPIs, regional filters, tabs, and charts on synthetic order data.',
	category: 'analytics',
	icon: TrendingUp,
	build: buildSalesAnalyticsDemo
};

function buildExecutiveKpi(): Notebook {
	// Same seed shape as Sales Analytics Demo, kept minimal — this template is
	// the "just the KPI grid" starting point, not the full multi-chart tour.
	const seedSQL = `SELECT
  order_id,
  order_date,
  quantity,
  ([1200.0, 799.0, 449.0, 349.0, 79.0, 39.0, 149.0, 89.0])[FLOOR(random() * 8)::INTEGER + 1] AS unit_price,
  region
FROM (
  SELECT
    range + 1 AS order_id,
    DATE '2023-01-01' + FLOOR(random() * 730)::INTEGER * INTERVAL '1 day' AS order_date,
    1 + FLOOR(random() * 4)::INTEGER AS quantity,
    (['North','South','East','West','Central'])[FLOOR(random() * 5)::INTEGER + 1] AS region
  FROM range(2000)
)`;

	const regionTargetsSQL = `SELECT * FROM (VALUES
  ('North', 150000.0),
  ('South', 120000.0),
  ('East', 130000.0),
  ('West', 140000.0),
  ('Central', 100000.0)
) AS t(target_region, quota)`;

	const monthlyRevenuePRQL = `from orders
derive {
  month = s"date_trunc('month', order_date)",
  revenue = quantity * unit_price
}
group month (
  aggregate {
    total_revenue = sum revenue,
    order_count = count this
  }
)
sort month`;

	const regionPerformancePRQL = `from o=orders
derive { revenue = quantity * unit_price }
join rt=region_targets (this.region==rt.target_region)
group o.region (
  aggregate { total_revenue = sum revenue, quota = max rt.quota }
)
sort {-total_revenue}`;

	const quotaAttainmentSQL = `SELECT ROUND(
  100.0 * MAX(total_revenue) / NULLIF(MAX(quota), 0),
  1
) AS attainment_pct
FROM region_performance`;

	const summaryMarkdown = `# Executive KPI

{% filter kind="relative-date" param="range" startParam="start" endParam="end" label="Period" /%}

{% grid cols=3 %}
{% metric value=$monthly_revenue.total_revenue label="Revenue" format="currency" vs=$region_performance.quota /%}
{% metric value=$orders.count label="Orders" /%}
{% metric value=$quota_attainment.attainment_pct label="Quota %" format="percent" /%}
{% /grid %}

{% chart type="line" data=$monthly_revenue.rows x="month" y="total_revenue" title="Revenue trend" /%}`;

	const cells: Cell[] = [
		{ ...makeDemoCell(seedSQL, 'orders', 'sql'), editMode: 'prql' },
		{ ...makeDemoCell(regionTargetsSQL, 'region_targets', 'sql'), editMode: 'prql' },
		{
			...makeDemoCell(monthlyRevenuePRQL, 'monthly_revenue', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'area',
				xColumn: 'month',
				yColumns: ['total_revenue'],
				colorColumn: null,
				title: 'Monthly Revenue'
			} satisfies ChartConfig
		},
		{ ...makeDemoCell(regionPerformancePRQL, 'region_performance', 'prql'), editMode: 'prql' },
		{ ...makeDemoCell(quotaAttainmentSQL, 'quota_attainment', 'sql'), editMode: 'prql' },
		{ ...makeDemoMarkdownCell(summaryMarkdown), display: 'output' }
	];

	return {
		id: makeDemoId(),
		name: 'Executive KPI',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: {}
	};
}

export const executiveKpiTemplate: DashboardTemplate = {
	id: 'executive-kpi',
	name: 'Executive KPI',
	description: 'Minimal KPI grid with period comparison placeholders.',
	category: 'analytics',
	icon: Gauge,
	build: buildExecutiveKpi
};
