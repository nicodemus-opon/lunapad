import { describe, expect, it } from 'vitest';
import {
	lookupColumn,
	lookupTable,
	splitRegistryEntry,
	sqlIdentBeforeCursor,
	sqlTableBeforeDot
} from './sql-schema-context';

describe('splitRegistryEntry', () => {
	it('splits schema.table.column on last dot', () => {
		expect(splitRegistryEntry('mm_raw.mpesa_raw.id')).toEqual({
			table: 'mm_raw.mpesa_raw',
			column: 'id'
		});
		expect(splitRegistryEntry('catalog.mm_raw.mpesa_raw.amount')).toEqual({
			table: 'catalog.mm_raw.mpesa_raw',
			column: 'amount'
		});
	});
});

describe('sqlIdentBeforeCursor', () => {
	it('parses bare identifiers', () => {
		expect(sqlIdentBeforeCursor('SELECT orders', 14)?.text).toBe('orders');
	});

	it('parses qualified identifiers', () => {
		const id = sqlIdentBeforeCursor('FROM catalog.schema.orders', 27);
		expect(id?.text).toBe('catalog.schema.orders');
		expect(id?.parts).toEqual(['catalog', 'schema', 'orders']);
	});

	it('parses backtick-quoted parts', () => {
		const id = sqlIdentBeforeCursor('FROM `my-schema`.`my-table`', 29);
		expect(id?.text).toBe('my-schema.my-table');
	});
});

describe('sqlTableBeforeDot', () => {
	it('extracts table before dot', () => {
		expect(sqlTableBeforeDot('SELECT catalog.schema.orders.')).toBe('catalog.schema.orders');
	});
});

describe('lookupTable', () => {
	const tables = new Map([
		['catalog.schema.orders', [{ name: 'id', detail: 'BIGINT' }]],
		['users', [{ name: 'name', detail: 'VARCHAR' }]]
	]);

	it('matches exact names', () => {
		expect(lookupTable(tables, 'users')?.[0]?.name).toBe('name');
	});

	it('matches unqualified leaf names', () => {
		expect(lookupTable(tables, 'orders')?.[0]?.name).toBe('id');
	});

	it('matches schema.table against catalog-prefixed registry keys', () => {
		const tables = new Map([
			['hive.mm_raw.mpesa_raw', [{ name: 'id', detail: 'BIGINT' }]]
		]);
		expect(lookupTable(tables, 'mm_raw.mpesa_raw')?.[0]?.name).toBe('id');
	});
});

describe('lookupColumn', () => {
	const tables = new Map([['orders', [{ name: 'id', detail: 'BIGINT' }]]]);

	it('resolves column by table and name', () => {
		expect(lookupColumn(tables, 'orders', 'id')?.detail).toBe('BIGINT');
	});
});
