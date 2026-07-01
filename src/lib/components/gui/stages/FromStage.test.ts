import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './FromStage.svelte');

describe('FromStage combobox behavior guards', () => {
	it('clears source when schema input is cleared', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('if (!schema) {');
		expect(source).toContain("onUpdate({ ...stage, table: '' });");
	});

	it('uses all table entries when schema is not selected', () => {
		const source = readFileSync(sourcePath, 'utf8');

		// tablesForSchema filters by schema when one is selected, or uses all entries
		expect(source).toContain('selectedSchema');
		expect(source).toContain('entries.filter((e) => e.schema === selectedSchema)');
		expect(source).toContain(': entries');
		// tableSuggestions maps entry names for display
		expect(source).toContain('tablesForSchema.map((e) => e.table)');
		expect(source).toContain('tablesForSchema.map((e) => e.name)');
	});
});
