import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './GroupStage.svelte');

describe('GroupStage window derive editor', () => {
	it('uses the shared derive stage editor for group window derives', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain("import DeriveStageEditor from './DeriveStage.svelte';");
		expect(source).toContain('<DeriveStageEditor');
		expect(source).toContain("stage={{ type: 'derive', columns: stage.window.derives }}");
		expect(source).not.toContain('function updateWindowDerive(');
	});

	it('supports structured raw aggregation expression editing with raw fallback', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('rawAggStructuredMode');
		expect(source).toContain('canUseStructuredRawAgg');
		expect(source).toContain('parseStructuredAggExpr');
		expect(source).toContain('structuredAggExprToString');
		expect(source).toContain("onclick={() => setRawAggMode(idx, agg, true)}");
		expect(source).toContain("onclick={() => setRawAggMode(idx, agg, false)}");
		expect(source).toContain('disabled={!canUseStructuredRawAgg(agg) && !isRawAggStructured(idx, agg)}');
		expect(source).toContain('placeholder="PRQL aggregation expression…"');
	});
});
