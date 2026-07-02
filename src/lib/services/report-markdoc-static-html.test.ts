import { describe, expect, it } from 'vitest';
import { renderMarkdocCellToStaticHtml } from './report-markdoc-static-html';
import type { Cell } from '$lib/stores/notebook.svelte';

function makeCell(outputName: string, rows: Record<string, unknown>[]): Cell {
	return {
		id: outputName,
		outputName,
		cellType: 'query',
		result: { rows, columns: Object.keys(rows[0] ?? {}), truncated: false }
	} as unknown as Cell;
}

describe('renderMarkdocCellToStaticHtml', () => {
	it('renders headings and paragraphs', () => {
		const html = renderMarkdocCellToStaticHtml('# Title\n\nSome text', []);
		expect(html).toContain('<h1>Title</h1>');
		expect(html).toContain('<p>Some text</p>');
	});

	it('renders a plain markdown table as a report table', () => {
		const md = ['| Name | Amount |', '| --- | --- |', '| a | 10 |', '| b | 20 |'].join('\n');
		const html = renderMarkdocCellToStaticHtml(md, []);
		expect(html).toContain('<table class="report-table">');
		expect(html).toContain('Amount');
		expect(html).toContain('10');
	});

	it('renders a {% datatable %} widget backed by a query cell', () => {
		const cells = [
			makeCell('orders', [
				{ region: 'US', amount: 10 },
				{ region: 'EU', amount: 20 }
			])
		];
		const md = '{% datatable data=$orders.rows cols=["region","amount"] limit=10 /%}';
		const html = renderMarkdocCellToStaticHtml(md, cells);
		expect(html).toContain('<table class="report-table">');
		expect(html).toContain('region');
		expect(html).toContain('US');
	});

	it('renders a pivoted {% datatable %} widget', () => {
		const cells = [
			makeCell('sales', [
				{ region: 'US', quarter: 'Q1', amount: 10 },
				{ region: 'US', quarter: 'Q2', amount: 5 },
				{ region: 'EU', quarter: 'Q1', amount: 20 }
			])
		];
		const md =
			'{% datatable data=$sales.rows index=["region"] pivotBy="quarter" valueCol="amount" agg="sum" /%}';
		const html = renderMarkdocCellToStaticHtml(md, cells);
		expect(html).toContain('<table class="report-table">');
		expect(html).toContain('Q1');
		expect(html).toContain('Q2');
	});

	it('renders conditional formats in datatable static html', () => {
		const cells = [makeCell('orders', [{ amount: -10 }, { amount: 20 }])];
		const md =
			'{% datatable data=$orders.rows cols=["amount"] conditionalFormats=[{"column":"amount","rules":[{"id":"r1","type":"threshold","op":"<","value":0,"tone":"negative"}]}] /%}';
		const html = renderMarkdocCellToStaticHtml(md, cells);
		expect(html).toContain('<table class="report-table">');
		expect(html).toContain('color-mix');
	});
});
