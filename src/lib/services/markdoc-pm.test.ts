import { describe, expect, it } from 'vitest';
import { buildSalesAnalyticsDemo } from '../demo/sales-analytics-demo';
import { WIDGET_SNIPPETS } from './markdown-format';
import { pmContentFromSnippet } from '../components/markdown/visual/slash-command-extension';
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

function findContainer(node: PMNodeJSON | undefined, tagName: string): PMNodeJSON | null {
	if (!node) return null;
	if (node.type === 'markdocContainer' && node.attrs?.tagName === tagName) return node;
	for (const child of node.content ?? []) {
		const found = findContainer(child, tagName);
		if (found) return found;
	}
	return null;
}

function hasRawMarkdocInParagraphs(node: PMNodeJSON): boolean {
	if (node.type === 'paragraph') {
		const text = (node.content ?? []).map((c) => c.text ?? '').join('');
		if (text.includes('{%')) return true;
	}
	return (node.content ?? []).some(hasRawMarkdocInParagraphs);
}

function parseAttrsJson(raw: unknown): Record<string, unknown> {
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {};
	}
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
		const md =
			'The dataset contains {% $orders.count %} orders totaling {% currency($rev.total) %} now.';
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

	it('does not leak a slash after bold-wrapped currency expressions', () => {
		const md =
			'The dataset contains **{% $orders.count %}** orders totaling **{% currency($monthly_revenue.total_revenue) %}** in the latest month.';
		const rt = roundTrip(md);
		expect(rt).not.toContain('month./');
		expect(rt).toContain('in the latest month.');
	});

	it('does not leak slash from self-closing widget into following prose', () => {
		const md = `{% badge value="Live dashboard" color="success" /%}

The dataset contains **{% $orders.count %}** orders totaling **{% currency($monthly_revenue.total_revenue) %}** in the latest month.`;
		const rt = roundTrip(md);
		expect(rt).not.toContain('month./');
		expect(rt).toContain('in the latest month.');
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

	it('round-trips a plain GFM table into table nodes', () => {
		const md = '| Name | Age |\n| --- | --- |\n| Bob | 30 |\n| Sue | 25 |';
		const { doc } = markdownToPmDocument(md);
		expect(collectNodeTypes(doc as unknown as PMNodeJSON)).toContain('table');
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips a table nested inside a container', () => {
		const md = '{% callout type="info" %}\n| A | B |\n| --- | --- |\n| 1 | 2 |\n{% /callout %}';
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips deeply nested dashboard layouts', () => {
		const md = `{% tabs %}
{% tab label="Overview" %}
{% columns %}
{% column %}
{% metric value=$orders.count label="Rows" /%}
{% /column %}
{% column %}
{% chart type="bar" data=$orders.rows x="region" y="revenue" /%}
{% /column %}
{% /columns %}
{% /tab %}
{% /tabs %}`;
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('keeps unknown non-self-closing tags as structured containers', () => {
		const md =
			'{% dashboard-shell variant="hero" %}\n{% callout type="info" %}\nNested\n{% /callout %}\n{% /dashboard-shell %}';
		const { doc } = markdownToPmDocument(md);
		const shell = doc.content?.[0];
		expect(shell?.type).toBe('markdocContainer');
		expect(shell?.attrs?.tagName).toBe('dashboard-shell');
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('preserves inline marks and expressions inside table cells', () => {
		const md = '| Metric | Value |\n| --- | --- |\n| **Total** | {% $cell.total %} |';
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('does not mistake a horizontal rule for a table delimiter', () => {
		const md = 'Above.\n\n---\n\nBelow.';
		const types = collectNodeTypes(markdownToPmDocument(md).doc as unknown as PMNodeJSON);
		expect(types).toContain('horizontalRule');
		expect(types).not.toContain('table');
	});

	it('round-trips tables split by blank lines (Markdoc prose block boundaries)', () => {
		const md = '| Name | Age |\n| --- | --- |\n\n| Bob | 30 |';
		const { doc } = markdownToPmDocument(md);
		expect(collectNodeTypes(doc as unknown as PMNodeJSON)).toContain('table');
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(
			normalizeMarkdocMarkdown('| Name | Age |\n| --- | --- |\n| Bob | 30 |')
		);
	});

	it('does not merge prose containing pipes with a following table', () => {
		const md = 'Options: foo | bar\n\n| Name | Age |\n| --- | --- |\n| Bob | 30 |';
		const { doc } = markdownToPmDocument(md);
		expect(collectNodeTypes(doc as unknown as PMNodeJSON)).toContain('table');
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

	it('preserves if condition in container attrsJson on load', () => {
		const md = '{% if gt($o.count, 0) %}\nHas rows\n{% /if %}';
		const { doc } = markdownToPmDocument(md);
		const container = findContainer({ type: 'doc', content: doc.content }, 'if');
		expect(container).not.toBeNull();
		const attrs = parseAttrsJson(container!.attrs?.attrsJson);
		expect(attrs.condition).toBe('gt($o.count, 0)');
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips if with variable condition and else branch', () => {
		const md = '{% if $x %}\nyes\n{% else /%}\nno\n{% /if %}';
		const { doc } = markdownToPmDocument(md);
		const container = findContainer({ type: 'doc', content: doc.content }, 'if');
		expect(parseAttrsJson(container!.attrs?.attrsJson).condition).toBe('$x');
		const types = (container!.content ?? []).map((n) => n.type);
		expect(types).toContain('markdocWidget');
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips grid with multiple metric children', () => {
		const md = `{% grid cols=3 %}
{% metric value=1 label="A" /%}
{% metric value=2 label="B" /%}
{% metric value=3 label="C" /%}
{% /grid %}`;
		const { doc } = markdownToPmDocument(md);
		const grid = findContainer({ type: 'doc', content: doc.content }, 'grid');
		const widgets = (grid?.content ?? []).filter((n) => n.type === 'markdocWidget');
		expect(widgets.length).toBe(3);
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips columns with multiple column children', () => {
		const md = `{% columns %}
{% column %}
Left
{% /column %}
{% column width="40%" %}
Right
{% /column %}
{% /columns %}`;
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
		const { doc } = markdownToPmDocument(md);
		const columns = findContainer({ type: 'doc', content: doc.content }, 'columns');
		const columnNodes = (columns?.content ?? []).filter(
			(n) => n.type === 'markdocContainer' && n.attrs?.tagName === 'column'
		);
		expect(columnNodes.length).toBe(2);
	});

	it('round-trips each and group containers', () => {
		const eachMd = '{% each data=$items %}\nItem\n{% /each %}';
		const groupMd =
			'{% group data=$o.rows by="region" order=["North","South"] %}\nBody\n{% /group %}';
		expect(normalizeMarkdocMarkdown(roundTrip(eachMd))).toBe(normalizeMarkdocMarkdown(eachMd));
		expect(normalizeMarkdocMarkdown(roundTrip(groupMd))).toBe(normalizeMarkdocMarkdown(groupMd));
	});

	it('round-trips nested containers', () => {
		const md = `{% grid cols=2 %}
{% card title="KPI" %}
Intro text
{% /card %}
{% /grid %}`;
		expect(normalizeMarkdocMarkdown(roundTrip(md))).toBe(normalizeMarkdocMarkdown(md));
	});

	it('round-trips all leaf widgets', () => {
		const widgets = [
			'{% metric value=1 label="One" /%}',
			'{% chart type="bar" data=$o.rows x="a" y="b" /%}',
			'{% datatable data=$o.rows limit=10 /%}',
			'{% badge value="ok" color="success" /%}',
			'{% progress value=50 max=100 label="Half" color="warning" /%}',
			'{% filter param="region" kind="dropdown" label="Region" /%}',
			'{% video src="https://example.com/a.mp4" loop=true muted=true /%}',
			'{% embed url="https://www.youtube.com/watch?v=abc123" aspect="16:9" /%}',
			'{% bookmark url="https://example.com" title="Example" description="A site" /%}',
			'{% math latex="E = mc^2" display=true /%}',
			'{% toc /%}'
		];
		for (const w of widgets) {
			expect(normalizeMarkdocMarkdown(roundTrip(w))).toBe(normalizeMarkdocMarkdown(w));
		}
	});

	it('pmContentFromSnippet builds structured nodes for container snippets (no raw markdoc text)', () => {
		const snippets = [
			WIDGET_SNIPPETS.grid,
			WIDGET_SNIPPETS.columns,
			WIDGET_SNIPPETS.tabs,
			WIDGET_SNIPPETS.details,
			WIDGET_SNIPPETS.conditional,
			WIDGET_SNIPPETS.callout,
			WIDGET_SNIPPETS.card
		];
		for (const snippet of snippets) {
			const fromSnippet = pmContentFromSnippet(snippet);
			const fromLoad = markdownToPmDocument(snippet.trim()).doc.content ?? [];
			expect(fromSnippet).toEqual(fromLoad);
			const root = fromSnippet[0];
			expect(root).toBeDefined();
			expect(hasRawMarkdocInParagraphs(root!)).toBe(false);
		}
	});

	it('strips trailing slash affordance paragraphs when serializing PM state', () => {
		const md = pmDocumentToMarkdown({
			frontmatter: '',
			doc: {
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [{ type: 'text', text: 'in the latest month.' }]
					},
					{ type: 'paragraph', content: [{ type: 'text', text: '/' }] }
				]
			}
		});
		expect(md).toBe('in the latest month.');
		expect(md).not.toContain('/');
	});

	it('strips inline trailing slash from paragraph text when serializing PM state', () => {
		const md = pmDocumentToMarkdown({
			frontmatter: '',
			doc: {
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [{ type: 'text', text: 'in the latest month./' }]
					}
				]
			}
		});
		expect(md).toBe('in the latest month.');
	});

	it('strips a lone slash affordance paragraph in the middle of the document', () => {
		const md = pmDocumentToMarkdown({
			frontmatter: '',
			doc: {
				type: 'doc',
				content: [
					{ type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
					{ type: 'paragraph', content: [{ type: 'text', text: '/' }] },
					{ type: 'paragraph', content: [{ type: 'text', text: 'After.' }] }
				]
			}
		});
		expect(md).toBe('Before.\n\nAfter.');
	});

	it('strips leading slash from slash-menu filter text in list items', () => {
		const md = pmDocumentToMarkdown({
			frontmatter: '',
			doc: {
				type: 'doc',
				content: [
					{
						type: 'bulletList',
						content: [
							{
								type: 'listItem',
								content: [
									{
										type: 'paragraph',
										content: [{ type: 'text', text: '/item one' }]
									}
								]
							},
							{
								type: 'listItem',
								content: [{ type: 'paragraph' }]
							}
						]
					}
				]
			}
		});
		expect(md).toBe('* item one');
	});
});
