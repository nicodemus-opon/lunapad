import { describe, expect, it } from 'vitest';
import { buildVisualRefOptions, columnsForRef, findFilterUsages } from './markdoc-visual-analysis';
import type { Cell } from '$lib/stores/notebook.svelte';

function cell(id: string, code: string): Cell {
	return {
		id,
		outputName: id,
		cellType: 'query',
		code
	} as Cell;
}

describe('markdoc-visual-analysis', () => {
	it('finds query cells wired to a filter param', () => {
		const cells = [
			cell('orders', 'from orders\nfilter region == "${region}"'),
			cell('other', 'from other')
		];
		expect(findFilterUsages(cells, 'region')).toMatchObject([
			{ cellId: 'orders', outputName: 'orders' }
		]);
	});

	it('finds every matching cell regardless of scan order (no stateful-regex misses)', () => {
		const cells = [
			cell('a', 'from a\nfilter x == "${region}"'),
			cell('b', 'from b\nfilter y == "${region}"'),
			cell('c', 'from c\nfilter z == "${region}"')
		];
		expect(findFilterUsages(cells, 'region').map((u) => u.cellId)).toEqual(['a', 'b', 'c']);
	});

	it('builds visual ref options for cells, rows, and columns', () => {
		const entries = [{ cellName: 'orders', columns: [{ name: 'revenue' }] }];
		const options = buildVisualRefOptions(entries);
		expect(options.map((o) => o.value)).toEqual(['$orders', '$orders.rows', '$orders.revenue']);
		expect(columnsForRef(entries, '$orders.rows')).toEqual(['revenue']);
	});
});
