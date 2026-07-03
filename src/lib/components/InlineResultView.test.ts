import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './InlineResultView.svelte');

describe('InlineResultView controls visibility', () => {
	it('supports hiding controls behind a focused-cell gate', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('controlsVisible?: boolean;');
		expect(source).toContain('controlsVisible = true');
		expect(source).toContain('toolbarReserveSpace?: boolean;');
		expect(source).toContain("toolbarActions?: import('svelte').Snippet;");
		expect(source).toContain("? 'h-6 opacity-100'");
		expect(source).toContain("'pointer-events-none h-6 opacity-0'");
		expect(source).toContain(": 'pointer-events-none h-0 opacity-0'}");
		expect(source).toContain('{@render toolbarActions()}');
	});

	it('recomputes chart config when result shape signature changes', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('let lastShapeSignature = $state');
		expect(source).toContain('function computeShapeSignature');
		expect(source).toContain('if (signature === lastShapeSignature) return;');
		expect(source).toContain('const nextConfig = inferSmartChartConfig(columns, rows);');
		expect(source).toContain('onChartConfigChange?.(nextConfig);');
	});
});
