import { describe, expect, it } from 'vitest';
import { filterFrozenRows, shouldHideQueryCell } from './filter-frozen';
import type { PublicShareCell } from '$lib/server/shared-reports';

describe('filter-frozen', () => {
	it('filters rows by column name matching param', () => {
		const rows = [
			{ region: 'US', n: 1 },
			{ region: 'EU', n: 2 }
		];
		const { rows: filtered } = filterFrozenRows(rows, ['region', 'n'], { region: 'US' });
		expect(filtered).toHaveLength(1);
		expect(filtered[0].region).toBe('US');
	});

	it('filters multi-select comma values as OR', () => {
		const rows = [
			{ region: 'US', n: 1 },
			{ region: 'EU', n: 2 },
			{ region: 'APAC', n: 3 }
		];
		const { rows: filtered } = filterFrozenRows(rows, ['region', 'n'], { region: 'US,EU' });
		expect(filtered).toHaveLength(2);
	});

	it('hides collapsed and data-role query cells', () => {
		const collapsed = {
			cellType: 'query',
			display: 'collapsed',
			publishRole: 'visible'
		} as PublicShareCell;
		const data = {
			cellType: 'query',
			display: 'full',
			publishRole: 'data'
		} as PublicShareCell;
		expect(shouldHideQueryCell(collapsed)).toBe(true);
		expect(shouldHideQueryCell(data)).toBe(true);
	});
});
