import { describe, expect, it } from 'vitest';
import { buildSalesAnalyticsDemo } from '$lib/demo/sales-analytics-demo';
import { gradeDashboard, getCriticalMarkdownFailures } from './dashboard-grade';

function demoDashboardMarkdown(): string {
	const nb = buildSalesAnalyticsDemo();
	const cell = nb.cells.find((c) => c.markdown?.includes('{% tabs %}'));
	expect(cell?.markdown).toBeTruthy();
	return cell!.markdown;
}

function demoCells() {
	return buildSalesAnalyticsDemo().cells.filter((c) => c.cellType === 'query');
}

describe('dashboard-grade', () => {
	it('scores sales demo dashboard >= 90', () => {
		const grade = gradeDashboard(demoDashboardMarkdown(), demoCells());
		expect(grade.failures).toEqual([]);
		expect(grade.score).toBeGreaterThanOrEqual(90);
		expect(grade.structure.hasTabs).toBe(true);
		expect(grade.structure.hasFilter).toBe(true);
		expect(grade.structure.hasProgress).toBe(true);
	});

	it('fails hardcoded revenue', () => {
		const md = `## KPI\nTotal revenue: $1,200,000\n{% metric value=$orders.count label="Orders" /%}`;
		const grade = gradeDashboard(md, demoCells());
		expect(grade.failures.some((f) => /hardcod|1,200,000/i.test(f))).toBe(true);
	});

	it('fails unknown tag', () => {
		const md = '{% bogus foo="bar" /%}';
		const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
		expect(failures.some((f) => /bogus/i.test(f))).toBe(true);
	});

	it('fails phantom cell ref', () => {
		const md = 'Total: $phantom_revenue.total';
		const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
		expect(failures.some((f) => /phantom_revenue/i.test(f))).toBe(true);
	});

	it('fails pipe in metric tag', () => {
		const md = '{% metric value=$orders.count | currency label="x" /%}';
		const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
		expect(failures.some((f) => /pipe/i.test(f))).toBe(true);
	});

	it('fails markdown with no widgets', () => {
		const grade = gradeDashboard('## Just prose\nSome text about revenue.', demoCells());
		expect(grade.failures.some((f) => /widget|metric|chart|datatable/i.test(f))).toBe(true);
	});
});
