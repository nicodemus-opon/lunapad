import { describe, expect, it } from 'vitest';
import { pivotTable } from './report-table-pivot';

const rows = [
	{ region: 'US', quarter: 'Q1', amount: 10 },
	{ region: 'US', quarter: 'Q2', amount: 15 },
	{ region: 'EU', quarter: 'Q1', amount: 20 },
	{ region: 'US', quarter: 'Q1', amount: 5 }
];

describe('pivotTable', () => {
	it('crosstabs values into columns per pivot value', () => {
		const out = pivotTable(rows, {
			index: ['region'],
			pivotBy: 'quarter',
			valueCol: 'amount',
			agg: 'sum'
		});

		expect(out.columns).toEqual(['region', 'Q1', 'Q2']);

		const us = out.rows.find((r) => r.region === 'US');
		const eu = out.rows.find((r) => r.region === 'EU');
		// US Q1 = 10 + 5 = 15, US Q2 = 15
		expect(us?.Q1).toBe(15);
		expect(us?.Q2).toBe(15);
		// EU has no Q2 → null
		expect(eu?.Q1).toBe(20);
		expect(eu?.Q2).toBeNull();
	});

	it('applies format overrides to every pivot column', () => {
		const out = pivotTable(rows, {
			index: ['region'],
			pivotBy: 'quarter',
			valueCol: 'amount',
			agg: 'sum',
			valueFormatKind: 'currency',
			valueCurrencySymbol: '$'
		});
		expect(out.formatOverrides?.Q1).toEqual({ kind: 'currency', currencySymbol: '$' });
		expect(out.formatOverrides?.Q2).toEqual({ kind: 'currency', currencySymbol: '$' });
	});

	it('bounds the number of generated pivot columns', () => {
		const many = Array.from({ length: 10 }, (_, i) => ({ g: 'x', k: `k${i}`, v: i }));
		const out = pivotTable(many, {
			index: ['g'],
			pivotBy: 'k',
			valueCol: 'v',
			agg: 'sum',
			maxPivotColumns: 3
		});
		// index col + 3 pivot cols
		expect(out.columns.length).toBe(4);
	});

	it('throws when index is empty', () => {
		expect(() =>
			pivotTable(rows, { index: [], pivotBy: 'quarter', valueCol: 'amount', agg: 'sum' })
		).toThrow();
	});
});
