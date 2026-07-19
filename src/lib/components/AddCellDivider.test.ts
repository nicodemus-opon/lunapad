import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { ControlCellKind } from '$lib/services/control-cells';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, './AddCellDivider.svelte'), 'utf8');

const ALL_CONTROL_KINDS: ControlCellKind[] = [
	'text-input',
	'number-input',
	'slider',
	'date-input',
	'date-range',
	'checkbox',
	'select',
	'multiselect',
	'run-button',
	'file-upload',
	'table-input',
	'map',
	'table-display',
	'pivot',
	'single-value',
	'writeback',
	'agent'
];

describe('AddCellDivider control menu', () => {
	it('lists every first-class control kind as an insertable menu item', () => {
		for (const kind of ALL_CONTROL_KINDS) {
			expect(source).toContain(`'${kind}'`);
		}
	});

	it('groups controls into notebook input and data/AI sections', () => {
		expect(source).toContain('Inputs');
		expect(source).toContain('Data & AI');
		expect(source).toContain('inputKinds');
		expect(source).toContain('dataKinds');
	});

	it('dispatches selected control kinds through the add callback', () => {
		expect(source).toContain('ControlCellKind');
		expect(source).toContain('onAdd(kind)');
		expect(source).toContain('{#each inputKinds as kind (kind)}');
		expect(source).toContain('{#each dataKinds as kind (kind)}');
	});
});
