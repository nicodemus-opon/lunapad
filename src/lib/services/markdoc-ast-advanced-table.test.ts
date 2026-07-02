import { describe, expect, it } from 'vitest';
import {
	parseVisualBlocks,
	serializeVisualBlocks,
	updateBlockWidgetSource,
	serializeMarkdocTag
} from './markdoc-ast';

describe('advanced datatable visual round-trip', () => {
	it('preserves pivot datatable attrs through block update', () => {
		const source = `{% datatable data=$orders.rows index=["region"] pivotBy="quarter" valueCol="amount" agg="sum" valueFormatKind="currency" valueCurrencySymbol="$" limit=50 pageSize=25 headerInsights="full" linkedFilter="region" /%}`;
		const blocks = parseVisualBlocks(source);
		expect(blocks).toHaveLength(1);
		const updated = updateBlockWidgetSource(blocks[0], { attrs: { agg: 'avg', round: 1 } });
		expect(updated.source).toContain('agg="avg"');
		expect(updated.source).toContain('pivotBy="quarter"');
		expect(updated.source).toContain('linkedFilter="region"');
		expect(serializeVisualBlocks([updated]).trim()).toBe(updated.source.trim());
	});

	it('serializes summary datatable mode', () => {
		const tag = serializeMarkdocTag('datatable', {
			data: '$sales.rows',
			index: ['region'],
			valueCol: 'amount',
			agg: 'sum',
			headerInsights: 'compact'
		});
		const blocks = parseVisualBlocks(tag);
		expect(blocks[0].tagName).toBe('datatable');
	});
});
