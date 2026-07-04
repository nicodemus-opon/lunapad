import { describe, expect, it } from 'vitest';
import {
	markdocAttrToDisplay,
	parseBlockWidget,
	parseVisualBlocks,
	serializeMarkdocTag
} from './markdoc-ast';
import { markdownToPmDocument } from './markdoc-pm';

const METRIC =
	'{% metric value=$category_breakdown.total_revenue label="Top Category Revenue" format="currency" /%}';

function parseAttrsJson(raw: string): Record<string, unknown> {
	return JSON.parse(raw) as Record<string, unknown>;
}

describe('markdoc attrsJson round-trip', () => {
	it('preserves variable refs in attrsJson for inspector display', () => {
		const pm = markdownToPmDocument(METRIC);
		const widget = pm.doc.content?.[0];
		expect(widget?.type).toBe('markdocWidget');
		const attrsJson = String(widget?.attrs?.attrsJson ?? '{}');
		const attrs = parseAttrsJson(attrsJson);
		expect(markdocAttrToDisplay(attrs.value)).toBe('$category_breakdown.total_revenue');

		const source = serializeMarkdocTag('metric', attrs, { selfClosing: true });
		expect(source).toContain('value=$category_breakdown.total_revenue');
		expect(source).not.toContain('[object Object]');
		const [block] = parseVisualBlocks(source);
		const parsed = parseBlockWidget(block);
		expect(markdocAttrToDisplay(parsed!.attrs.value)).toBe(
			'$category_breakdown.total_revenue'
		);
	});

	it('parseBlockWidget attrs display variable refs', () => {
		const [block] = parseVisualBlocks(METRIC);
		const parsed = parseBlockWidget(block);
		expect(markdocAttrToDisplay(parsed!.attrs.value)).toBe(
			'$category_breakdown.total_revenue'
		);
	});
});
