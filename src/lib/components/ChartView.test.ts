import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './ChartView.svelte');

describe('ChartView label styling', () => {
	it('disables LayerChart axis text stroke styling', () => {
		const source = readFileSync(sourcePath, 'utf8');

		// ECharts fully replaced by Observable Plot — these must never come back
		expect(source).not.toContain('echartsOption');
		expect(source).not.toContain('EChart');

		// Plot-based rendering, including the previously-deferred types
		expect(source).toContain('plotRender');
		expect(source).toContain("t === 'pie'");
		expect(source).toContain("t === 'sankey'");
		expect(source).toContain("t === 'funnel'");
		expect(source).toContain("t === 'calendar-heatmap'");

		// Bubble chart support
		expect(source).toContain("t === 'bubble'");
		expect(source).toContain('point._size = coerceNumber(r[config.sizeColumn]);');

		// Bar chart features
		expect(source).toContain('enableColorSplitBars');
		expect(source).toContain('colorSplitBarData');
		expect(source).toContain('sortedBarData');
		expect(source).toContain('barSeriesToRender');
		expect(source).toContain('colorSplitSeriesList');
		expect(source).toContain('barSeriesLayout');

		// Area chart features
		expect(source).toContain('areaSeriesLayout');

		// Secondary axis
		expect(source).toContain('const hasSecondaryAxis = $derived');

		// X-label rotation logic
		expect(source).toContain('shouldRotateXLabels');

		// Size column for bubble/scatter
		expect(source).toContain('sizeColumn');
	});
});
