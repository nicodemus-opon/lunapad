import { describe, expect, it } from 'vitest';
import { buildSalesAnalyticsDemo } from '$lib/demo/sales-analytics-demo';
import { gradeDashboard, getCriticalMarkdownFailures } from './dashboard-grade';

const cells = () => buildSalesAnalyticsDemo().cells.filter((c) => c.cellType === 'query');
const known = () => new Set(cells().map((c) => c.outputName));

describe('dashboard adversarial static grading', () => {
	const cases: Array<{ name: string; md: string; expectFail: RegExp | null; minScore?: number }> = [
		{
			name: 'valid minimal grid+metric+chart',
			md: `## KPI\n{% grid cols=2 %}{% metric value=$orders.count label="Orders" /%}{% /grid %}\n{% chart type="bar" data=$region_performance.rows x="region" y="total_revenue" /%}`,
			expectFail: null,
			minScore: 70
		},
		{
			name: 'hardcoded millions',
			md: 'Revenue hit $1,200,000 last quarter.',
			expectFail: /hardcod|1,200,000/i
		},
		{
			name: 'phantom ref',
			md: '{% metric value=$unicorn_revenue.total label="ARR" /%}',
			expectFail: /unicorn_revenue|undefined/i
		},
		{
			name: 'bogus tag',
			md: '{% bogus x=1 /%}',
			expectFail: /bogus/i
		},
		{
			name: 'pipe in tag',
			md: '{% metric value=$orders.count | currency label="x" /%}',
			expectFail: /pipe/i
		},
		{
			name: 'raw SQL in body',
			md: 'SELECT * FROM orders',
			expectFail: /sql|widget/i
		},
		{
			name: 'obsolete dashboard API',
			md: 'Use create_dashboard to build this',
			expectFail: /obsolete|create_dashboard/i
		},
		{
			name: 'rich tabs+filter+progress',
			md: `## Exec\n{% filter kind="dropdown" param="region" label="Region" options=["North"] /%}\n{% progress value=$quota_attainment.attainment_pct max=100 /%}\n{% tabs %}{% tab label="A" %}{% metric value=$orders.count label="N" /%}{% /tab %}{% /tabs %}`,
			expectFail: null,
			minScore: 75
		},
		{
			name: 'conditional empty state',
			md: '{% if gt($monthly_revenue.count, 0) %}{% metric value=$monthly_revenue.total_revenue label="Revenue" /%}{% else /%}No data{% /if %}',
			expectFail: null,
			minScore: 55
		},
		{
			name: 'datatable drilldown',
			md: '{% datatable data=$top_products.rows cols=["product","total_revenue"] limit=5 /%}',
			expectFail: null,
			minScore: 55
		},
		{
			name: 'callout warning',
			md: '{% callout type="warning" %}Nulls detected{% /callout %}\n{% metric value=$orders.count label="Rows" /%}',
			expectFail: null,
			minScore: 60
		},
		{
			name: 'columns layout',
			md: `{% columns %}{% column %}{% chart type="bar" data=$region_performance.rows x="region" y="total_revenue" /%}{% /column %}{% column %}{% chart type="bar" data=$top_products.rows x="product" y="total_revenue" /%}{% /column %}{% /columns %}`,
			expectFail: null,
			minScore: 65
		},
		{
			name: 'prose only wall',
			md: '## Summary\nThis quarter was strong across all regions with solid growth.',
			expectFail: /widget/i
		},
		{
			name: 'percent without scale hint',
			md: '{% percent($orders.count, 1) %}',
			expectFail: /widget/i
		},
		{
			name: 'mermaid static ok',
			md: `{% mermaid %}
graph LR
  A --> B
{% /mermaid %}
{% metric value=$orders.count label="N" /%}`,
			expectFail: null,
			minScore: 60
		},
		{
			name: 'vs metric trend',
			md: '{% metric value=$region_performance.total_revenue vs=$region_performance.quota label="Vs quota" format="currency" /%}',
			expectFail: null,
			minScore: 55
		},
		{
			name: 'chart ref inherit',
			md: '{% chart ref=$region_performance type="bar" /%}',
			expectFail: null,
			minScore: 55
		},
		{
			name: 'bad else syntax',
			md: '{% if gt($orders.count, 0) %}yes{% else %}no{% /if %}',
			expectFail: /else|validation|error/i
		},
		{
			name: 'inline live prose ref',
			md: 'Orders: **$orders.count** in latest month.\n{% metric value=$orders.count label="Orders" /%}',
			expectFail: null,
			minScore: 55
		},
		{
			name: 'currency function',
			md: 'Total **{% currency($monthly_revenue.total_revenue) %}**\n{% metric value=$monthly_revenue.total_revenue label="MTD" format="currency" /%}',
			expectFail: null,
			minScore: 55
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const grade = gradeDashboard(c.md, cells());
			if (c.expectFail) {
				expect(grade.failures.some((f) => c.expectFail!.test(f))).toBe(true);
			} else {
				expect(grade.failures).toEqual([]);
				if (c.minScore) expect(grade.score).toBeGreaterThanOrEqual(c.minScore);
			}
		});
	}

	it('getCriticalMarkdownFailures blocks phantom roots', () => {
		const f = getCriticalMarkdownFailures('See $missing.count', known());
		expect(f.some((x) => /missing/i.test(x))).toBe(true);
	});
});
