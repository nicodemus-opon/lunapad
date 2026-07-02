import { describe, expect, it } from 'vitest';
import { summarizeTable } from './report-table-summary';

const rows = [
	{ region: 'US', product: 'A', amount: 10 },
	{ region: 'US', product: 'B', amount: 30 },
	{ region: 'EU', product: 'A', amount: 20 }
];

describe('summarizeTable', () => {
	it('sums grouped values with a descriptive output column', () => {
		const out = summarizeTable(rows, { groupBy: ['region'], valueCol: 'amount', agg: 'sum' });
		expect(out.columns).toEqual(['region', 'sum(amount)']);
		const us = out.rows.find((r) => r.region === 'US');
		const eu = out.rows.find((r) => r.region === 'EU');
		expect(us?.['sum(amount)']).toBe(40);
		expect(eu?.['sum(amount)']).toBe(20);
	});

	it('averages with rounding', () => {
		const out = summarizeTable(rows, {
			groupBy: ['region'],
			valueCol: 'amount',
			agg: 'avg',
			round: 1
		});
		const us = out.rows.find((r) => r.region === 'US');
		expect(us?.['avg(amount)']).toBe(20);
	});

	it('counts non-null values', () => {
		const withNull = [...rows, { region: 'US', product: 'C', amount: null }];
		const out = summarizeTable(withNull, { groupBy: ['region'], valueCol: 'amount', agg: 'count' });
		const us = out.rows.find((r) => r.region === 'US');
		// two numeric + null excluded → 2
		expect(us?.['count(amount)']).toBe(2);
	});

	it('emits format overrides for the aggregated column', () => {
		const out = summarizeTable(rows, {
			groupBy: ['region'],
			valueCol: 'amount',
			agg: 'sum',
			valueFormatKind: 'currency',
			valueCurrencySymbol: '$'
		});
		expect(out.formatOverrides?.['sum(amount)']).toEqual({ kind: 'currency', currencySymbol: '$' });
	});

	it('throws when groupBy is empty', () => {
		expect(() => summarizeTable(rows, { groupBy: [], valueCol: 'amount', agg: 'sum' })).toThrow();
	});
});
