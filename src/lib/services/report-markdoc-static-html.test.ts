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

	it('preserves nested layout wrappers in static html export', () => {
		const cells = [
			makeCell('orders', [
				{ region: 'US', amount: 10 },
				{ region: 'EU', amount: 20 }
			])
		];
		const md = `{% tabs %}
{% tab label="Overview" %}
{% columns %}
{% column %}
{% grid cols=2 %}
{% card title="Revenue" %}
{% callout type="warning" %}
{% datatable data=$orders.rows cols=["region","amount"] /%}
{% /callout %}
{% /card %}
{% /grid %}
{% /column %}
{% /columns %}
{% /tab %}
{% /tabs %}`;
		const html = renderMarkdocCellToStaticHtml(md, cells);
		expect(html).toContain('data-markdoc-tag="tabs"');
		expect(html).toContain('data-markdoc-tag="tab"');
		expect(html).toContain('class="markdoc-columns"');
		expect(html).toContain('class="markdoc-grid"');
		expect(html).toContain('class="markdoc-card"');
		expect(html).toContain('class="markdoc-callout markdoc-callout--warning"');
	});

	it('renders a callout with a title', () => {
		const html = renderMarkdocCellToStaticHtml(
			'{% callout type="warning" title="Heads up" %}\nBody text.\n{% /callout %}',
			[]
		);
		expect(html).toContain('markdoc-callout--warning');
		expect(html).toContain('markdoc-callout-title');
		expect(html).toContain('Heads up');
		expect(html).toContain('Body text.');
	});

	it('falls back to escaped mermaid source in static export', () => {
		const html = renderMarkdocCellToStaticHtml(
			'{% mermaid %}\ngraph TD\nA-->B\n{% /mermaid %}',
			[]
		);
		expect(html).toContain('data-markdoc-tag="mermaid"');
		expect(html).toContain('graph TD');
		expect(html).toContain('A--&gt;B');
	});

	it('renders a {% video %} widget with controls', () => {
		const html = renderMarkdocCellToStaticHtml('{% video src="https://example.com/a.mp4" /%}', []);
		expect(html).toContain('<video');
		expect(html).toContain('controls');
		expect(html).toContain('src="https://example.com/a.mp4"');
	});

	it('rejects a javascript: URL on {% video %}', () => {
		const html = renderMarkdocCellToStaticHtml('{% video src="javascript:alert(1)" /%}', []);
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('<video');
	});

	it('renders a {% embed %} widget for an allowlisted host as an iframe', () => {
		const html = renderMarkdocCellToStaticHtml(
			'{% embed url="https://www.youtube.com/watch?v=abc123" /%}',
			[]
		);
		expect(html).toContain('<iframe');
		expect(html).toContain('youtube-nocookie.com/embed/abc123');
		expect(html).toContain('sandbox=');
		expect(html).toContain('referrerpolicy="no-referrer"');
	});

	it('falls back to a link for a non-allowlisted embed host (no raw iframe)', () => {
		const html = renderMarkdocCellToStaticHtml(
			'{% embed url="https://attacker.example/evil" /%}',
			[]
		);
		expect(html).not.toContain('<iframe');
		expect(html).toContain('href="https://attacker.example/evil"');
	});

	it('rejects a javascript: URL on {% embed %}', () => {
		const html = renderMarkdocCellToStaticHtml('{% embed url="javascript:alert(1)" /%}', []);
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('<iframe');
		expect(html).not.toContain('<a ');
	});

	it('renders a {% bookmark %} widget as a link card', () => {
		const html = renderMarkdocCellToStaticHtml(
			'{% bookmark url="https://example.com" title="Example" description="A site" /%}',
			[]
		);
		expect(html).toContain('data-markdoc-tag="bookmark"');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('Example');
		expect(html).toContain('A site');
	});

	it('rejects a javascript: URL on {% bookmark %}', () => {
		const html = renderMarkdocCellToStaticHtml('{% bookmark url="javascript:alert(1)" /%}', []);
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('<a ');
	});

	it('renders a {% math %} widget with KaTeX HTML', () => {
		const html = renderMarkdocCellToStaticHtml('{% math latex="E = mc^2" /%}', []);
		expect(html).toContain('data-markdoc-tag="math"');
		expect(html).toContain('katex');
	});

	it('renders a {% math %} display block with the display class', () => {
		const html = renderMarkdocCellToStaticHtml('{% math latex="x^2" display=true /%}', []);
		expect(html).toContain('markdoc-math--display');
	});

	it('renders a {% toc %} widget from notebook headings', () => {
		const cells = [
			{
				id: 'intro',
				cellType: 'markdown',
				markdown: '# Overview\n\nSome text.\n\n## Details\n\nMore text.'
			} as unknown as Cell
		];
		const html = renderMarkdocCellToStaticHtml('{% toc /%}', cells);
		expect(html).toContain('data-markdoc-tag="toc"');
		expect(html).toContain('Overview');
		expect(html).toContain('Details');
	});

	it('omits the {% toc %} widget entirely when there are no headings', () => {
		const html = renderMarkdocCellToStaticHtml('{% toc /%}', []);
		expect(html).not.toContain('data-markdoc-tag="toc"');
	});
});
