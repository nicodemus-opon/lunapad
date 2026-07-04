import { describe, expect, it } from 'vitest';
import { buildSalesAnalyticsDemo } from '../demo/sales-analytics-demo';
import { cellsToPmDocument } from './notebook-pm';
import {
	markdocAttrToDisplay,
	parseBlockWidget,
	parseVisualBlocks,
	serializeMarkdocTag
} from './markdoc-ast';
import { visualBlockFromSelection } from '../components/markdown/visual/markdoc-node-selection';

function findMetricWidgets(doc: ReturnType<typeof cellsToPmDocument>, label: string) {
	const hits: { attrsJson: string; tagName: string }[] = [];
	const walk = (nodes: typeof doc.content) => {
		for (const n of nodes ?? []) {
			if (n.type === 'markdocWidget' && n.attrs?.tagName === 'metric') {
				const attrs = JSON.parse(String(n.attrs.attrsJson ?? '{}')) as Record<string, unknown>;
				if (attrs.label === label) hits.push({ attrsJson: String(n.attrs.attrsJson), tagName: 'metric' });
			}
			if (n.content) walk(n.content);
		}
	};
	walk(doc.content);
	return hits;
}

describe('sales analytics demo attrs', () => {
	it('metric widgets keep variable refs in attrsJson', () => {
		const nb = buildSalesAnalyticsDemo();
		const pm = cellsToPmDocument(nb.cells);
		const widgets = findMetricWidgets(pm, 'Top Category Revenue');
		expect(widgets.length).toBe(1);
		const attrs = JSON.parse(widgets[0].attrsJson) as Record<string, unknown>;
		expect(attrs.value).toBe('$category_breakdown.total_revenue');
		expect(markdocAttrToDisplay(attrs.value)).toBe('$category_breakdown.total_revenue');

		// Inspector path: selection → source → parseBlockWidget
		const source = serializeMarkdocTag('metric', attrs, { selfClosing: true });
		expect(source).toContain('value=$category_breakdown.total_revenue');
		const [block] = parseVisualBlocks(source);
		const parsed = parseBlockWidget(block);
		expect(markdocAttrToDisplay(parsed!.attrs.value)).toBe('$category_breakdown.total_revenue');

		const selection = {
			type: 'widget' as const,
			tagName: 'metric',
			attrs,
			source,
			pos: 1
		};
		const blockFromSel = visualBlockFromSelection(selection);
		const parsedFromSel = parseBlockWidget(blockFromSel!);
		expect(markdocAttrToDisplay(parsedFromSel!.attrs.value)).toBe(
			'$category_breakdown.total_revenue'
		);
	});
});
