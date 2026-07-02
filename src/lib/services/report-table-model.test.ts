import { describe, expect, it } from 'vitest';
import { buildReportTableModel, getReportTableColumn } from './report-table-model';

describe('buildReportTableModel', () => {
	it('infers formats and right-aligns numeric columns', () => {
		const rows = [
			{ name: 'a', qty: 10 },
			{ name: 'b', qty: 20 }
		];
		const model = buildReportTableModel(rows, ['name', 'qty']);

		const name = getReportTableColumn(model, 'name');
		const qty = getReportTableColumn(model, 'qty');

		expect(name?.align).toBe('left');
		expect(qty?.format.kind).toBe('number');
		expect(qty?.align).toBe('right');
		expect(model.rows).toBe(rows);
	});

	it('centers boolean columns', () => {
		const rows = [{ active: true }, { active: false }];
		const model = buildReportTableModel(rows, ['active']);
		expect(getReportTableColumn(model, 'active')?.format.kind).toBe('boolean');
		expect(getReportTableColumn(model, 'active')?.align).toBe('center');
	});

	it('applies column label and format overrides', () => {
		const rows = [{ revenue: '100' }];
		const model = buildReportTableModel(rows, ['revenue'], {
			columnLabels: { revenue: 'Revenue' },
			formatOverrides: { revenue: { kind: 'currency', currencySymbol: '€' } }
		});

		const col = getReportTableColumn(model, 'revenue');
		expect(col?.label).toBe('Revenue');
		expect(col?.format.kind).toBe('currency');
		expect(col?.format.currencySymbol).toBe('€');
		// currency is numeric → right aligned
		expect(col?.align).toBe('right');
	});
});
