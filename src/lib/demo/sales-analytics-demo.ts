import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import type { ChartConfig } from '$lib/types/gui-pipeline';
import type { GUIPipelineStage } from '$lib/types/gui-pipeline';
import {
	makeDemoCell,
	makeDemoId,
	makeDemoMarkdownCell,
	type ChartConfig as DemoChartConfig
} from './cell-factory';

export const DEMO_NOTEBOOK_NAME = 'Sales Analytics Demo';

export function buildSalesAnalyticsDemo(): Notebook {
	// Pure SELECT so the execution engine can wrap it as a view.
	// PRQL downstream cells inline this via: let orders = (s"SELECT ...")
	const seedSQL = `SELECT
  range + 1 AS order_id,
  DATE '2023-01-01' + CAST((range * 13 % 730) AS INTEGER) * INTERVAL '1 day' AS order_date,
  (['Laptop','Phone','Tablet','Monitor','Keyboard','Mouse','Headset','Webcam'])[(range % 8) + 1] AS product,
  (['Electronics','Electronics','Electronics','Peripherals','Peripherals','Peripherals','Peripherals','Peripherals'])[(range % 8) + 1] AS category,
  (['Enterprise','SMB','Consumer'])[(range % 3) + 1] AS customer_segment,
  1 + (range * 7 % 4) AS quantity,
  ([1200.0, 799.0, 449.0, 349.0, 79.0, 39.0, 149.0, 89.0])[(range % 8) + 1] AS unit_price,
  (['North','South','East','West','Central'])[(range % 5) + 1] AS region
FROM range(2000)`;

	// target_region (not "region") so the post-join schema has only one
	// unqualified `region` column — joining on same-named columns leaves both
	// table's copies in scope and makes `group region (...)` ambiguous.
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

	const categoryPRQL = `from orders
derive revenue = quantity * unit_price
group category (
  aggregate {
    total_revenue = sum revenue,
    order_count = count this
  }
)
sort {-total_revenue}`;

	const segmentPRQL = `from orders
derive revenue = quantity * unit_price
group customer_segment (
  aggregate {
    total_revenue = sum revenue,
    order_count = count this
  }
)
sort {-total_revenue}`;

	const orderValueDistributionPRQL = `from orders
derive revenue = quantity * unit_price
select { revenue }`;

	const topProductsPRQL = `from orders
derive revenue = quantity * unit_price
group product (
  aggregate {
    total_revenue = sum revenue,
    units_sold = sum quantity
  }
)
sort {-total_revenue}
take 10`;

	const growthSQL = `SELECT
  month,
  total_revenue,
  total_revenue - LAG(total_revenue) OVER (ORDER BY month) AS mom_delta,
  ROUND(100.0 * (total_revenue - LAG(total_revenue) OVER (ORDER BY month))
        / NULLIF(LAG(total_revenue) OVER (ORDER BY month), 0), 1) AS mom_pct
FROM monthly_revenue
ORDER BY month`;

	const quotaAttainmentSQL = `SELECT ROUND(
  100.0 * MAX(total_revenue) / NULLIF(MAX(quota), 0),
  1
) AS attainment_pct
FROM region_performance`;

	const regionFilteredOrdersSQL = `SELECT region, product, category, customer_segment, quantity, unit_price, order_date
FROM orders
WHERE region = '\${region}'
ORDER BY order_date DESC
LIMIT 20`;

	const introMarkdown = `# Sales Analytics Demo

This notebook walks through Lunapad's core workflow on synthetic order data — **2,000 rows**, entirely in the built-in DuckDB engine.

{% callout type="info" %}
**Run all cells** (⇧⌘R or **Run → Run all cells**) to populate every chart and dashboard widget below. Cells reference each other by \`outputName\` — no boilerplate \`WITH\` needed.
{% /callout %}

{% mermaid %}
flowchart LR
  orders[orders] --> monthly_revenue[monthly_revenue]
  orders --> region_performance[region_performance]
  region_targets[region_targets] --> region_performance
  orders --> category_breakdown[category_breakdown]
  orders --> top_products[top_products]
{% /mermaid %}`;

	const dashboardMarkdown = `## Explore by region

{% badge value="Live dashboard" color="success" /%}

The dataset contains **{% $orders.count %}** orders totaling **{% currency($monthly_revenue.total_revenue) %}** in the latest month.

{% filter kind="dropdown" param="region" label="Region" options=["North","South","East","West","Central"] default="North" /%}

{% progress value=$quota_attainment.attainment_pct max=100 label="Top region quota attainment (%)" color="success" /%}

{% tabs %}
{% tab label="Metrics" %}
{% grid cols=3 %}
{% metric value=$category_breakdown.total_revenue label="Top Category Revenue" format="currency" /%}
{% metric value=$region_performance.total_revenue vs=$region_performance.quota label="Top Region vs Quota" format="currency" /%}
{% metric value=$top_products.total_revenue label="Best-Selling Product Revenue" format="currency" /%}
{% /grid %}
{% /tab %}
{% tab label="By region" %}
{% chart type="bar" data=$region_performance.rows x="region" y="total_revenue" title="Revenue by region" filterParam="region" filterColumn="region" drillCell="region_filtered_orders" /%}
{% /tab %}
{% tab label="Products" %}
{% datatable data=$top_products.rows cols=["product","total_revenue","units_sold"] limit=10 /%}
{% datatable data=$region_filtered_orders.rows cols=["region","product","order_date","quantity","unit_price"] limit=10 linkedFilter="region" /%}
{% /tab %}
{% /tabs %}`;

	const closingMarkdown = `## What you just ran

- **PRQL & SQL cells** referencing each other as CTEs — no boilerplate \`WITH\` needed
- **GUI pipeline editor** (\`region_performance\`) — includes a join, not just filter/derive/group
- **Stats view** (\`orders\`) — per-column min/max/null/distinct counts; switch back to table anytime
- **Chart variety** — area, grouped bar, horizontal bar, and histogram via each cell's view toolbar
- **Markdoc dashboards** — tabs, metrics, inline live numbers, progress bars, badges, and embedded charts
- **Interactive filters** — the region dropdown re-runs \`region_filtered_orders\` automatically
- **Customer segments** — a second grouping dimension on the seed data

**Not shown here** (need a full deployment, not demo mode): team comments & review, the AI assistant, dbt project workflow, external connections, and Python UDF cells.`;

	const cells: Cell[] = [
		{
			...makeDemoMarkdownCell(introMarkdown),
			markdownPreview: true
		},
		{
			...makeDemoCell(seedSQL, 'orders', 'sql'),
			editMode: 'prql',
			resultViewMode: 'stats'
		},
		{
			...makeDemoCell(regionTargetsSQL, 'region_targets', 'sql'),
			editMode: 'prql'
		},
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
		{
			...makeDemoCell(regionPerformancePRQL, 'region_performance', 'prql'),
			editMode: 'gui',
			guiStages: [
				{ type: 'from', table: 'orders', alias: 'o' },
				{
					type: 'derive',
					columns: [
						{
							name: 'revenue',
							expr: {
								mode: 'binary',
								left: { kind: 'column', value: 'quantity' },
								op: '*',
								right: { kind: 'column', value: 'unit_price' }
							}
						}
					]
				},
				{
					type: 'join',
					joinType: 'left',
					table: 'region_targets',
					alias: 'rt',
					conditions: [{ left: 'this.region', right: 'target_region' }]
				},
				{
					type: 'group',
					by: ['o.region'],
					aggregations: [
						{ name: 'total_revenue', func: 'sum', column: 'revenue' },
						{ name: 'quota', func: 'max', column: 'rt.quota' }
					]
				},
				{ type: 'sort', keys: [{ column: 'total_revenue', dir: 'desc' }] }
			] as GUIPipelineStage[],
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar',
				xColumn: 'region',
				yColumns: ['total_revenue', 'quota'],
				colorColumn: null,
				seriesMode: 'grouped',
				title: 'Revenue vs Quota by Region'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(categoryPRQL, 'category_breakdown', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar',
				xColumn: 'category',
				yColumns: ['total_revenue', 'order_count'],
				colorColumn: null,
				title: 'Revenue by Category'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(segmentPRQL, 'segment_breakdown', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar',
				xColumn: 'customer_segment',
				yColumns: ['total_revenue'],
				colorColumn: null,
				title: 'Revenue by Customer Segment'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(orderValueDistributionPRQL, 'order_value_distribution', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'histogram',
				xColumn: '',
				yColumns: ['revenue'],
				histogramBins: 24,
				colorColumn: null,
				title: 'Order Value Distribution'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(topProductsPRQL, 'top_products', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar-horizontal',
				xColumn: 'product',
				yColumns: ['total_revenue'],
				colorColumn: null,
				title: 'Top Products by Revenue'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(growthSQL, 'growth_analysis', 'sql'),
			editMode: 'prql',
			resultViewMode: 'table'
		},
		{
			...makeDemoCell(quotaAttainmentSQL, 'quota_attainment', 'sql'),
			editMode: 'prql',
			resultViewMode: 'table'
		},
		{
			...makeDemoMarkdownCell(dashboardMarkdown),
			markdownPreview: true
		},
		{
			...makeDemoCell(regionFilteredOrdersSQL, 'region_filtered_orders', 'sql'),
			editMode: 'prql',
			resultViewMode: 'table'
		},
		{
			...makeDemoMarkdownCell(closingMarkdown),
			markdownPreview: true
		}
	];

	return {
		id: makeDemoId(),
		name: DEMO_NOTEBOOK_NAME,
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: { region: 'North' }
	};
}

// Re-export for tests that need chart config typing
export type { DemoChartConfig };
