import { describe, expect, it } from 'vitest';
import { renderReportTableToStaticHtml } from './report-table-static-html';

describe('renderReportTableToStaticHtml', () => {
	it('renders a table with headers and rows', () => {
		const html = renderReportTableToStaticHtml(
			[
				{ name: 'a', amount: 10 },
				{ name: 'b', amount: 20 }
			],
			['name', 'amount']
		);
		expect(html).toContain('<table class="report-table">');
		expect(html).toContain('<th');
		expect(html).toContain('amount');
		// numeric column right-aligned
		expect(html).toContain('class="num"');
	});

	it('escapes HTML in cell values', () => {
		const html = renderReportTableToStaticHtml([{ x: '<script>alert(1)</script>' }], ['x']);
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('renders nullish cells as an em dash', () => {
		const html = renderReportTableToStaticHtml([{ x: null }], ['x']);
		expect(html).toContain('—');
	});

	it('caps rows at maxRows and notes truncation', () => {
		const rows = Array.from({ length: 20 }, (_, i) => ({ i }));
		const html = renderReportTableToStaticHtml(rows, ['i'], { maxRows: 5, truncated: true });
		const rowMatches = html.match(/<tr>/g) ?? [];
		// 1 header row + 5 body rows
		expect(rowMatches.length).toBe(6);
		expect(html).toContain('table-note');
	});
});
