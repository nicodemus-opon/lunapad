import { describe, expect, it } from 'vitest';
import { buildSalesAnalyticsDemo } from '../demo/sales-analytics-demo';
import {
	markdownToPmDocument,
	pmDocumentToMarkdown,
	markdocPmRoundTripLossy,
	normalizeMarkdocMarkdown,
	type PMNodeJSON
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
		expect(doc.content?.some((n) => n.type === 'markdocBlock')).toBe(true);
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

	it('handles empty markdown', () => {
		const { doc } = markdownToPmDocument('');
		expect(doc.type).toBe('doc');
		expect(doc.content?.length).toBeGreaterThan(0);
	});
});
