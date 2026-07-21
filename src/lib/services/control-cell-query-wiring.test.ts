import { describe, expect, it } from 'vitest';
import { buildSQLExecutionCode } from './cell-deps.js';
import type { Cell } from '$lib/stores/notebook.svelte';
import { initialControlResult } from '$lib/stores/notebook.svelte';
import { defaultControlCellConfig, type ControlCellKind } from './control-cells.js';

/** Builds the same shape the real store produces via makeControlCell():
 *  an `input` cell whose `result` is derived from its controlConfig. */
function controlCell(kind: ControlCellKind, name: string, value: unknown): Cell {
	const controlConfig = { ...defaultControlCellConfig(kind, name), value };
	return {
		id: name,
		cellType: 'input',
		outputName: name,
		code: '',
		language: 'sql',
		controlConfig,
		result: initialControlResult(kind, controlConfig)
	} as unknown as Cell;
}

function queryCell(outputName: string, code: string): Cell {
	return {
		id: outputName,
		cellType: 'query',
		outputName,
		code,
		language: 'sql'
	} as unknown as Cell;
}

/** Rebuilds the compiled SQL for `result`, as if the control's value had
 *  just been changed (mirrors what updateControlCellValue does to the cell). */
function withControlValue(control: Cell, value: unknown): Cell {
	const kind = control.controlConfig!.kind;
	const controlConfig = { ...control.controlConfig!, value };
	return { ...control, controlConfig, result: initialControlResult(kind, controlConfig) };
}

function compile(control: Cell, query: Cell): string {
	return buildSQLExecutionCode([control, query], 1, () => null);
}

describe('control cell -> query variable wiring', () => {
	it('text-input: changing the value changes what the WHERE clause filters on', () => {
		let control = controlCell('text-input', 'city', 'Nairobi');
		const query = queryCell('result', 'SELECT * FROM orders WHERE city = (SELECT value FROM city)');

		const sqlBefore = compile(control, query);
		expect(sqlBefore).toContain("VALUES ('city', 'Nairobi')");

		control = withControlValue(control, 'Lagos');
		const sqlAfter = compile(control, query);
		expect(sqlAfter).toContain("VALUES ('city', 'Lagos')");
		expect(sqlAfter).not.toBe(sqlBefore);
	});

	it('number-input: changing the value changes the numeric literal in the CTE', () => {
		let control = controlCell('number-input', 'min_amount', 10);
		const query = queryCell(
			'result',
			'SELECT * FROM orders WHERE amount >= (SELECT value FROM min_amount)'
		);

		const sqlBefore = compile(control, query);
		expect(sqlBefore).toContain("VALUES ('min_amount', 10)");

		control = withControlValue(control, 250);
		const sqlAfter = compile(control, query);
		expect(sqlAfter).toContain("VALUES ('min_amount', 250)");
		expect(sqlAfter).not.toBe(sqlBefore);
	});

	it('slider: changing the value changes the numeric literal in the CTE', () => {
		let control = controlCell('slider', 'score_min', 50);
		const query = queryCell(
			'result',
			'SELECT * FROM leads WHERE score >= (SELECT value FROM score_min)'
		);

		const sqlBefore = compile(control, query);
		expect(sqlBefore).toContain("VALUES ('score_min', 50)");

		control = withControlValue(control, 80);
		const sqlAfter = compile(control, query);
		expect(sqlAfter).toContain("VALUES ('score_min', 80)");
		expect(sqlAfter).not.toBe(sqlBefore);
	});

	it('date-input: changing the value changes the date literal in the CTE', () => {
		let control = controlCell('date-input', 'since', '2024-01-01');
		const query = queryCell(
			'result',
			'SELECT * FROM events WHERE created_at >= (SELECT value FROM since)'
		);

		const sqlBefore = compile(control, query);
		expect(sqlBefore).toContain("VALUES ('since', '2024-01-01')");

		control = withControlValue(control, '2024-06-01');
		const sqlAfter = compile(control, query);
		expect(sqlAfter).toContain("VALUES ('since', '2024-06-01')");
		expect(sqlAfter).not.toBe(sqlBefore);
	});

	it('date-range: changing start/end changes both literals in the CTE', () => {
		let control = controlCell('date-range', 'window', {
			start: '2024-01-01',
			end: '2024-01-31'
		});
		const query = queryCell(
			'result',
			'SELECT * FROM events WHERE created_at BETWEEN (SELECT start FROM window) AND (SELECT end FROM window)'
		);

		const sqlBefore = compile(control, query);
		expect(sqlBefore).toContain("VALUES ('window', '2024-01-01', '2024-01-31')");

		control = withControlValue(control, { start: '2024-03-01', end: '2024-03-15' });
		const sqlAfter = compile(control, query);
		expect(sqlAfter).toContain("VALUES ('window', '2024-03-01', '2024-03-15')");
		expect(sqlAfter).not.toBe(sqlBefore);
	});

	it('checkbox: toggling the value changes the boolean literal in the CTE', () => {
		let control = controlCell('checkbox', 'active_only', false);
		const query = queryCell(
			'result',
			'SELECT * FROM users WHERE is_active = (SELECT value FROM active_only)'
		);

		const sqlBefore = compile(control, query);
		expect(sqlBefore).toContain("VALUES ('active_only', FALSE)");

		control = withControlValue(control, true);
		const sqlAfter = compile(control, query);
		expect(sqlAfter).toContain("VALUES ('active_only', TRUE)");
		expect(sqlAfter).not.toBe(sqlBefore);
	});

	it('select: choosing a different option changes the string literal in the CTE', () => {
		let control = controlCell('select', 'status', 'active');
		const query = queryCell(
			'result',
			'SELECT * FROM tickets WHERE status = (SELECT value FROM status)'
		);

		const sqlBefore = compile(control, query);
		expect(sqlBefore).toContain("VALUES ('status', 'active')");

		control = withControlValue(control, 'pending');
		const sqlAfter = compile(control, query);
		expect(sqlAfter).toContain("VALUES ('status', 'pending')");
		expect(sqlAfter).not.toBe(sqlBefore);
	});

	it('multiselect: changing the selected options changes the literal in the CTE', () => {
		let control = controlCell('multiselect', 'statuses', ['active']);
		const query = queryCell(
			'result',
			'SELECT * FROM tickets WHERE status = (SELECT value FROM statuses)'
		);

		const sqlBefore = compile(control, query);
		expect(sqlBefore).toContain("VALUES ('statuses', 'active')");

		control = withControlValue(control, ['pending', 'archived']);
		const sqlAfter = compile(control, query);
		expect(sqlAfter).toContain("VALUES ('statuses', 'pending,archived')");
		expect(sqlAfter).not.toBe(sqlBefore);
	});
});
