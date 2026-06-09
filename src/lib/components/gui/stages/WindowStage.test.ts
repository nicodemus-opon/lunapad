import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './WindowStage.svelte');

describe('WindowStage nested derive editor', () => {
	it('uses the shared derive stage editor instead of raw expression inputs', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain("import DeriveStageEditor from './DeriveStage.svelte';");
		expect(source).toContain('<DeriveStageEditor');
		expect(source).toContain("stage={{ type: 'derive', columns: stage.derives }}");
		expect(source).not.toContain('placeholder="PRQL expression..."');
	});
});
