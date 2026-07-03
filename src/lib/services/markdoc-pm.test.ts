import { describe, expect, it } from 'vitest';
import { buildSalesAnalyticsDemo } from '../demo/sales-analytics-demo';
import {
	markdownToPmDocument,
	pmDocumentToMarkdown,
	markdocPmRoundTripLossy,
	normalizeMarkdocMarkdown,
	type PMNodeJSON,
	type PMDocJSON
} from './markdoc-pm';

function collectNodeTypes(node: PMNodeJSON): string[] {
	const types = [node.type];
	for (const child of node.content ?? []) types.push(...collectNodeTypes(child));
	return types;
}

const SAMPLE = `## Revenue dashboard

KPI overview for the quarter.

{% metric value=$orders.revenue label="Revenue" format="currency" /%}

{% datatable data=$orders.rows cols=["id","total"] limit=20 pivotBy="region" valueCol="total" agg="sum" /%}`;

const MIXED = `## Executive dashboard

Some **bold** intro text.

{% grid cols=3 %}
{% metric value=$cell.value label="Revenue" /%}
{% /grid %}

Closing paragraph.`;

const FRONTMATTER = `---
title: Report
---

## Body

{% metric value=1 label="One" /%}`;

const FENCE = `## Diagram

\`\`\`mermaid
graph TD
    A --> B
\`\`\``;

function roundTrip(md: string): string {
	return pmDocumentToMarkdown(markdownToPmDocument(md));
}

describe('markdoc-pm', () => {
	it('parses mixed prose and widgets into doc JSON', () => {
		const { doc } = markdownToPmDocument(SAMPLE);
		expect(doc.content?.length).toBeGreaterThanOrEqual(3);
		expect(doc.content?.some((n) => n.type === 'heading')).toBe(true);
		expect(doc.content?.some((n) => n.type === 'markdocWidget' || n.type === 'markdocBlock')).toBe(
			true
		);
	});

	it('round-trips simple dashboard markdown', () => {
		expect(normalizeMarkdocMarkdown(roundTrip(SAMPLE))).toBe(normalizeMarkdocMarkdown(SAMPLE));
	});

	it('round-trips mixed prose, widgets, and containers', () => {
		expect(normalizeMarkdocMarkdown(roundTrip(MIXED))).toBe(normalizeMarkdocMarkdown(MIXED));
	});

	it('preserves YAML frontmatter', () => {
		const rt = roundTrip(FRONTMATTER);
		expect(rt.startsWith('---\ntitle: Report')).toBe(true);
		expect(rt).toContain('{% metric value=1 label="One" /%}');
	});

	it('round-trips code fences as markdocBlock atoms', () => {
		expect(normalizeMarkdocMarkdown(roundTrip(FENCE))).toBe(normalizeMarkdocMarkdown(FENCE));
	});

	it('round-trips inline marks', () => {
		const md = 'Paragraph with **bold** and *italic* text.';
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips bullet lists', () => {
		const md = '- one\n- two\n- three';
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips task lists', () => {
		const md = '- [ ] todo\n- [x] done';
		const rt = roundTrip(md);
		expect(rt).toContain('- [ ] todo');
		expect(rt).toContain('- [x] done');
		const { doc } = markdownToPmDocument(md);
		expect(doc.content?.some((n) => n.type === 'taskList')).toBe(true);
	});

	it('round-trips numbered lists', () => {
		const md = '1. first\n2. second\n3. third';
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips nested lists', () => {
		const md = '- outer\n  - inner\n- back';
		const rt = roundTrip(md);
		expect(rt).toContain('outer');
		expect(rt).toContain('inner');
	});

	it('reports non-lossy for valid dashboard content', () => {
		expect(markdocPmRoundTripLossy(SAMPLE).lossy).toBe(false);
	});

	it('round-trips widget tags from visual fixtures', () => {
		const widgets = [
			'{% metric value=$o.revenue label="Revenue" format="currency" /%}',
			'{% chart type="bar" data=$o.rows x="region" y="total" /%}',
			'{% callout type="info" %}\nHeads up.\n{% /callout %}',
			'{% grid cols=3 %}\n{% metric value=1 /%}\n{% /grid %}'
		];
		for (const w of widgets) {
			const md = `## Title\n\n${w}`;
			expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
		}
	});

	it('uses TipTap-compatible camelCase node types', () => {
		const md = '# Title\n\n- one\n- two';
		const { doc } = markdownToPmDocument(md);
		const types = (doc.content ?? []).flatMap(collectNodeTypes);
		expect(types).toContain('heading');
		expect(types).toContain('bulletList');
		expect(types).not.toContain('bullet_list');
	});

	it('round-trips demo intro markdown', () => {
		const intro =
			buildSalesAnalyticsDemo().cells.find((c) => c.cellType === 'markdown')?.markdown ?? '';
		expect(intro.length).toBeGreaterThan(100);
		expect(markdocPmRoundTripLossy(intro).lossy).toBe(false);
	});

	it('parses widgets as markdocWidget nodes', () => {
		const md = '{% metric value=1 label="One" /%}';
		const { doc } = markdownToPmDocument(md);
		expect(doc.content?.[0]?.type).toBe('markdocWidget');
		expect(doc.content?.[0]?.attrs?.tagName).toBe('metric');
	});

	it('parses containers as markdocContainer nodes', () => {
		const md = '{% callout type="info" %}\nHello\n{% /callout %}';
		const { doc } = markdownToPmDocument(md);
		expect(doc.content?.[0]?.type).toBe('markdocContainer');
		expect(doc.content?.[0]?.attrs?.tagName).toBe('callout');
	});

	it('round-trips inline markdoc expressions in prose', () => {
		const md = 'Total orders: {% $orders.count %}';
		const rt = roundTrip(md);
		expect(rt).toContain('{% $orders.count %}');
		const { doc } = markdownToPmDocument(md);
		const para = doc.content?.find((n) => n.type === 'paragraph');
		expect(para?.content?.some((c) => c.type === 'markdocExpression')).toBe(true);
	});

	it('preserves surrounding whitespace around inline expressions', () => {
		const md = 'The dataset contains {% $orders.count %} orders totaling {% currency($rev.total) %} now.';
		const rt = roundTrip(md);
		expect(rt).toContain('contains {% $orders.count %} orders');
		expect(rt).toContain('totaling {% currency($rev.total) %} now.');
	});

	it('preserves bold marks wrapping inline expressions', () => {
		const md = 'contains **{% $orders.count %}** orders';
		const rt = roundTrip(md);
		expect(rt).toContain('**{% $orders.count %}**');
		expect(rt).toContain('contains **{% $orders.count %}** orders');
	});

	it('round-trips details containers', () => {
		const md = '{% details summary="More" open=true %}\nHidden body\n{% /details %}';
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips tabs with nested widgets', () => {
		const md = `{% tabs %}
{% tab label="A" %}
{% metric value=1 label="KPI" /%}
{% /tab %}
{% /tabs %}`;
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips grid with cols attribute', () => {
		const md = '{% grid cols=4 %}\n{% metric value=1 label="KPI" /%}\n{% /grid %}';
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('serializes bubble-toolbar marks without throwing', () => {
		const doc: PMDocJSON = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'a', marks: [{ type: 'strike' }] },
						{ type: 'text', text: ' b', marks: [{ type: 'underline' }] },
						{ type: 'text', text: ' c', marks: [{ type: 'highlight' }] }
					]
				}
			]
		};
		const md = pmDocumentToMarkdown({ frontmatter: '', doc });
		expect(md).toContain('~~a~~');
		expect(md).toContain('<u>');
		expect(md).toContain('b</u>');
		expect(md).toContain('==');
		expect(md).toContain('c');
	});

	it('handles empty markdown', () => {
		const { doc } = markdownToPmDocument('');
		expect(doc.type).toBe('doc');
		expect(doc.content?.length).toBeGreaterThan(0);
	});
});
