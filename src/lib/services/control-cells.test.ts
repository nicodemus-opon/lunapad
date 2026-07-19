import { describe, expect, it } from 'vitest';
import {
	defaultControlCellConfig,
	isControlCellKind,
	isInputControlKind,
	normalizeControlCellConfig,
	type ControlCellKind
} from './control-cells.js';

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

const INPUT_KINDS: ControlCellKind[] = [
	'text-input',
	'number-input',
	'slider',
	'date-input',
	'date-range',
	'checkbox',
	'select',
	'multiselect',
	'run-button',
	'file-upload'
];

describe('control cell defaults', () => {
	it('recognizes every configured control kind and rejects unknown kinds', () => {
		for (const kind of ALL_CONTROL_KINDS) {
			expect(isControlCellKind(kind)).toBe(true);
		}
		expect(isControlCellKind('dropdown')).toBe(false);
		expect(isControlCellKind(null)).toBe(false);
	});

	it('creates complete durable configs for every control kind', () => {
		for (const kind of ALL_CONTROL_KINDS) {
			const config = defaultControlCellConfig(kind, `${kind}_param`);
			expect(config.kind).toBe(kind);
			expect(config.name).toBe(`${kind}_param`);
			expect(config.label).not.toBe('');
			expect(config.description).not.toBe('');
			expect(config.source).toBeTruthy();
			expect(config.validation).toBeTruthy();
			expect(config.display).toMatchObject({ variant: 'panel', width: 'full' });
			expect(config.runTarget).toMatch(/^(dependents|all|none)$/);
		}
	});

	it('marks only true input controls as input controls', () => {
		for (const kind of ALL_CONTROL_KINDS) {
			expect(isInputControlKind(kind)).toBe(INPUT_KINDS.includes(kind));
		}
	});

	it('sets guarded defaults for writeback and usable defaults for table input', () => {
		const writeback = defaultControlCellConfig('writeback', 'write_orders');
		expect(writeback.status).toBe('permission-blocked');
		expect(writeback.writeback).toMatchObject({
			connectionId: null,
			target: '',
			mode: 'manual',
			allowWrite: false
		});

		const table = defaultControlCellConfig('table-input', 'thresholds');
		expect(table.tableData?.columns).toEqual(['key', 'value']);
		expect(table.tableData?.rows.length).toBeGreaterThan(0);
	});

	it('normalizes partial persisted configs without losing valid nested fields', () => {
		const normalized = normalizeControlCellConfig(
			{
				kind: 'select',
				name: 'status',
				label: 'Status',
				options: [{ label: 'Closed', value: 'closed' }],
				source: { mode: 'upstream-result', columns: ['state'] },
				validation: { required: true },
				display: { placeholder: 'Pick one' },
				runTarget: 'all'
			},
			'text-input',
			'fallback'
		);

		expect(normalized).toMatchObject({
			kind: 'select',
			name: 'status',
			label: 'Status',
			options: [{ label: 'Closed', value: 'closed' }],
			source: { mode: 'upstream-result', columns: ['state'] },
			validation: { required: true },
			display: { placeholder: 'Pick one' },
			runTarget: 'all'
		});
	});
});
