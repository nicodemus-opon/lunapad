import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './LoopStage.svelte');

describe('LoopStage structured mode', () => {
	it('supports structured mini-stage mode alongside raw mode', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('const effectiveMode = $derived(');
		expect(source).toContain("switchMode('structured')");
		expect(source).toContain("switchMode('raw')");
		expect(source).not.toContain('Popover.Root');
		expect(source).toContain('loop {effectiveMode}');
		expect(source).toContain('parseLoopBodyToMiniStages');
		expect(source).toContain('loopMiniStagesToBody');
		expect(source).toContain('<FilterStageEditor');
		expect(source).toContain('<SelectStageEditor');
		expect(source).toContain('<DeriveStageEditor');
		expect(source).toContain('<SortStageEditor');
		expect(source).toContain('<TakeStageEditor');
		expect(source).toContain('placeholder="filter n < 4\\nselect n = n + 1"');
	});
});
