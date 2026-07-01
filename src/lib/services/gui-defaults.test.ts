import { describe, expect, it } from 'vitest';

import {
	getCellOutputReference,
	getPreviousCellOutputReference,
	makeInheritedGuiCode,
	makeInheritedGuiStages
} from '$lib/services/gui-defaults';

describe('gui-defaults', () => {
	it('uses the explicit output name when building a source reference', () => {
		expect(getCellOutputReference({ id: 'abc123', outputName: 'orders_clean' })).toBe(
			'orders_clean'
		);
	});

	it('falls back to the generated cell view name when the output name is blank', () => {
		expect(getCellOutputReference({ id: 'abc123', outputName: '' })).toBe('_cell_abc123');
	});

	it('creates a from stage and PRQL that inherit the previous source', () => {
		expect(makeInheritedGuiStages('orders_clean')).toEqual([
			{ type: 'from', table: 'orders_clean' }
		]);
		expect(makeInheritedGuiCode('orders_clean')).toBe('from orders_clean');
	});

	it('returns the immediate previous output reference for new-cell inheritance', () => {
		expect(
			getPreviousCellOutputReference([
				{ id: 'a', outputName: 'result1' },
				{ id: 'b', outputName: 'orders_clean' }
			])
		).toBe('orders_clean');
		expect(
			getPreviousCellOutputReference([
				{ id: 'a', outputName: 'result1' },
				{ id: 'b', outputName: '' }
			])
		).toBe('_cell_b');
		expect(getPreviousCellOutputReference([])).toBe('');
	});
});
