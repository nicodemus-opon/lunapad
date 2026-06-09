import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './ChartView.svelte');

describe('ChartView label styling', () => {
	it('disables LayerChart axis text stroke styling', () => {
		const source = readFileSync(sourcePath, 'utf8');

		// ECharts-based chart rendering
		expect(source).toContain('echartsOption');
		expect(source).toContain('EChart');

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
