import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './ResultView.svelte');

describe('ResultView adaptive chart config', () => {
	it('uses smart chart inference for chart mode defaults', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('inferSmartChartConfig');
		expect(source).toContain('return chartConfig ?? inferSmartChartConfig(columns, rows);');
		expect(source).toContain("setTabChartConfig(tabId, inferSmartChartConfig(columns, rows));");
	});

	it('updates chart config when result shape signature changes', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('let lastShapeSignature = $state');
		expect(source).toContain('function computeShapeSignature');
		expect(source).toContain('if (signature === lastShapeSignature) return;');
		expect(source).toContain('setTabChartConfig(tabId, inferSmartChartConfig(columns, rows));');
	});
});
