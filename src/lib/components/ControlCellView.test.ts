import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { ControlCellKind } from '$lib/services/control-cells';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, './ControlCellView.svelte'), 'utf8');

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

describe('ControlCellView anatomy', () => {
	it('renders an explicit branch for every first-class control kind', () => {
		for (const kind of ALL_CONTROL_KINDS) {
			expect(source).toContain(`config.kind === '${kind}'`);
		}
	});

	it('uses shadcn primitives and lucide icons for the control shell', () => {
		for (const primitive of [
			'$lib/components/ui/button',
			'$lib/components/ui/input',
			'$lib/components/ui/textarea',
			'$lib/components/ui/badge',
			'$lib/components/ui/popover',
			'$lib/components/ui/native-select/native-select.svelte'
		]) {
			expect(source).toContain(primitive);
		}
		for (const icon of [
			'Bot',
			'CalendarDays',
			'Download',
			'FileUp',
			'MapIcon',
			'Play',
			'Settings2',
			'Table2'
		]) {
			expect(source).toContain(icon);
		}
	});

	it('keeps controls accessible and configurable', () => {
		expect(source).toContain('aria-label={config.label}');
		expect(source).toContain('aria-label={`${config.label} start`}');
		expect(source).toContain('aria-label="Configure control"');
		expect(source).toContain('Variable name');
		expect(source).toContain('Save options');
		expect(source).toContain('Primary column');
	});

	it('wires interactions to notebook store updates instead of local-only placeholders', () => {
		expect(source).toContain('updateControlCellConfig');
		expect(source).toContain('updateControlCellValue');
		expect(source).toContain('updateControlTableData');
		expect(source).toContain('runAllStale');
		expect(source).toContain('runAll');
		expect(source).toContain('downloadCsv');
		expect(source).not.toContain('TODO');
		expect(source).not.toContain('placeholder-only');
	});

	it('shows real empty, error, and permission-blocked states', () => {
		expect(source).toContain('tableDraftError');
		expect(source).toContain('Choose latitude and longitude columns.');
		expect(source).toContain('Run an upstream cell or configure data.');
		expect(source).toContain('Writeback is guarded.');
		expect(source).toContain('runAgent');
		expect(source).toContain('submitAIMessage');
	});
});
