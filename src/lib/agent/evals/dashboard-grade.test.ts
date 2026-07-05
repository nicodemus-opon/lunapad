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

	it('accepts first-row refs written with rows.0 syntax after normalization', () => {
		const failures = getCriticalMarkdownFailures(
			'{% metric value=$orders.rows.0.total_revenue label="Revenue" /%}',
			new Set(['orders'])
		);
		expect(failures).toEqual([]);
	});

	describe('chart axis requirements', () => {
		it('fails big-value chart missing x=', () => {
			const md = '{% chart data=$orders.rows type="big-value" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
			expect(failures.some((f) => /big-value.*needs x=/.test(f))).toBe(true);
		});

		it('accepts big-value chart with x= set', () => {
			const md = '{% chart data=$orders.rows type="big-value" x="revenue" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
			expect(failures).toEqual([]);
		});

		it('fails axis chart (bar) missing y=', () => {
			const md = '{% chart data=$orders.rows type="bar" x="month" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
			expect(failures.some((f) => /bar.*needs both x= and y=/.test(f))).toBe(true);
		});

		it('fails chart with no type= (defaults to bar) and no axes', () => {
			const md = '{% chart data=$orders.rows /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
			expect(failures.some((f) => /bar.*needs both x= and y=/.test(f))).toBe(true);
		});

		it('fails custom chart missing code=', () => {
			const md = '{% chart data=$orders.rows type="custom" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
			expect(failures.some((f) => /custom.*needs a code=/.test(f))).toBe(true);
		});

		it('accepts any chart type when ref= supplies the base config (no live chart state tracked)', () => {
			const md = '{% chart ref=$orders type="big-value" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
			expect(failures).toEqual([]);
		});

		it('fails ref=$cell when the referenced cell has never been charted (reproduces the "Set x and y columns" placeholder bug)', () => {
			// This is the literal shape of the bug: `ref=$py_result type="big-value"` looked
			// correct in the markdown, but py_result's OWN chart had never been configured
			// (resultChartConfig is null), so ref= supplied an empty base config and the
			// widget rendered the "Set x and y columns to preview chart" placeholder.
			const md = '{% chart ref=$py_result type="big-value" /%}';
			const failures = getCriticalMarkdownFailures(
				md,
				new Set(['py_result']),
				new Set() // py_result is known but NOT in chartedOutputNames — never charted
			);
			expect(failures.some((f) => /ref=\$py_result has no chart configured/.test(f))).toBe(true);
		});

		it('accepts ref=$cell when the referenced cell IS charted', () => {
			const md = '{% chart ref=$py_result type="big-value" /%}';
			const failures = getCriticalMarkdownFailures(
				md,
				new Set(['py_result']),
				new Set(['py_result'])
			);
			expect(failures).toEqual([]);
		});

		it('accepts ref=$cell to an uncharted cell when explicit overrides are also given', () => {
			const md = '{% chart ref=$py_result type="big-value" x="revenue" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['py_result']), new Set());
			expect(failures).toEqual([]);
		});

		it('accepts ref=$cell to an uncharted cell for table type (no axes needed regardless)', () => {
			const md = '{% chart ref=$py_result type="table" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['py_result']), new Set());
			expect(failures).toEqual([]);
		});

		it('accepts table chart with no axes', () => {
			const md = '{% chart data=$orders.rows type="table" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
			expect(failures).toEqual([]);
		});

		it('still catches a missing y= when another attribute value contains a literal "%"', () => {
			// Regression guard: an earlier implementation matched the tag with a
			// `[^%]*` regex over raw source text, which truncated at the first literal "%"
			// inside a quoted attribute value — silently skipping validation for any chart
			// whose title/label happened to mention a percentage.
			const md = '{% chart data=$orders.rows type="bar" x="month" title="50% growth" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
			expect(failures.some((f) => /bar.*needs both x= and y=/.test(f))).toBe(true);
		});

		it('does not mistake "x=" inside another attribute\'s string value for a real x= attribute', () => {
			const md = '{% chart data=$orders.rows type="bar" title="y = f(x=1)" /%}';
			const failures = getCriticalMarkdownFailures(md, new Set(['orders']));
			expect(failures.some((f) => /bar.*needs both x= and y=/.test(f))).toBe(true);
		});
	});
});
