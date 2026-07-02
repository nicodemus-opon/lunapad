import { describe, expect, it } from 'vitest';
import {
	defaultConditionalRulesForColumn,
	evaluateConditionalCellStyle
} from './report-table-conditional-format';

describe('evaluateConditionalCellStyle', () => {
	const rows = [
		{ amount: -20, status: 'failed' },
		{ amount: 0, status: 'ok' },
		{ amount: 120, status: 'ok' }
	];

	it('applies threshold rules', () => {
		const style = evaluateConditionalCellStyle(
			-20,
			[{ id: 'r1', type: 'threshold', op: '<', value: 0, tone: 'negative', icon: 'down' }],
			{ rows, columnId: 'amount' }
		);
		expect(style?.tone).toBe('negative');
		expect(style?.icon).toBe('down');
	});

	it('applies color scale and data bars', () => {
		const style = evaluateConditionalCellStyle(
			120,
			[
				{ id: 'scale', type: 'colorScale' },
				{ id: 'bar', type: 'dataBar', tone: 'info' }
			],
			{ rows, columnId: 'amount' }
		);
		expect(style?.tone).toBeTruthy();
		expect(style?.dataBar?.percent).toBeGreaterThan(0);
	});

	it('applies icon set based on sign', () => {
		const style = evaluateConditionalCellStyle(0, [{ id: 'icons', type: 'iconSet' }], {
			rows,
			columnId: 'amount'
		});
		expect(style?.icon).toBe('flat');
	});

	it('returns null when no rules', () => {
		expect(evaluateConditionalCellStyle(1, undefined, { rows, columnId: 'amount' })).toBeNull();
	});
});

describe('defaultConditionalRulesForColumn', () => {
	it('returns numeric presets for money-like columns', () => {
		const rules = defaultConditionalRulesForColumn('balance');
		expect(rules.some((r) => r.type === 'dataBar')).toBe(true);
		expect(rules.some((r) => r.type === 'threshold')).toBe(true);
	});
});

