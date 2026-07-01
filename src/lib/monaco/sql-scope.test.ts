import { beforeAll, describe, expect, it } from 'vitest';
import { initSqlParsersForTests } from './sql-parser-dialect';
import {
	buildRegexScope,
	columnsForRef,
	columnsInScope,
	detectSqlClauseContext,
	getSqlScope,
	prefixMatches,
	resolveTableRef
} from './sql-scope';

beforeAll(async () => {
	await initSqlParsersForTests();
});

describe('getSqlScope', () => {
	it('collects FROM aliases', () => {
		const scope = getSqlScope('SELECT o.id FROM orders o', 'duckdb-wasm');
		expect(scope).not.toBeNull();
		expect(resolveTableRef(scope, 'o')).toBe('orders');
		expect(columnsForRef(scope, new Map([['orders', [{ name: 'id', detail: 'INT' }]]]), 'o')).toEqual([
			{ name: 'id', detail: 'INT' }
		]);
	});

	it('collects JOIN tables', () => {
		const scope = getSqlScope(
			'SELECT o.id, c.name FROM orders o JOIN customers c ON o.customer_id = c.id',
			'postgres'
		);
		expect(scope?.sources.map((s) => s.name).sort()).toEqual(['customers', 'orders']);
		expect(resolveTableRef(scope, 'c')).toBe('customers');
	});

	it('collects qualified table names', () => {
		const scope = getSqlScope('SELECT * FROM catalog.schema.orders o', 'postgres');
		expect(scope?.sources[0]?.name).toBe('catalog.schema.orders');
		expect(resolveTableRef(scope, 'o')).toBe('catalog.schema.orders');
	});

	it('collects CTE names and columns', () => {
		const scope = getSqlScope(
			'WITH cte AS (SELECT id, name FROM orders) SELECT cte.id FROM cte',
			'postgres'
		);
		expect(scope?.cteNames.has('cte')).toBe(true);
		const cteCols = columnsForRef(scope, new Map(), 'cte');
		expect(cteCols?.map((c) => c.name)).toEqual(['id', 'name']);
	});

	it('returns null for empty SQL', () => {
		expect(getSqlScope('', 'duckdb-wasm')).toBeNull();
	});

	it('regex fallback resolves alias when parser fails on incomplete SQL', () => {
		const sql = 'SELECT\n  a.\nFROM\n  mm_raw.mpesa_raw as a';
		const scope = buildRegexScope(sql);
		expect(scope).not.toBeNull();
		expect(resolveTableRef(scope, 'a')).toBe('mm_raw.mpesa_raw');
		const merged = getSqlScope(sql, 'postgres');
		expect(resolveTableRef(merged, 'a')).toBe('mm_raw.mpesa_raw');
	});
});

describe('columnsInScope', () => {
	it('returns scoped columns with alias prefix', () => {
		const registry = new Map([
			['orders', [{ name: 'id' }, { name: 'amount' }]],
			['customers', [{ name: 'name' }]]
		]);
		const scope = getSqlScope('SELECT 1 FROM orders o JOIN customers c ON 1=1', 'duckdb-wasm');
		const scoped = columnsInScope(scope, registry);
		expect(scoped.some((s) => s.qualifiedPrefix === 'o' && s.columns.length === 2)).toBe(true);
		expect(scoped.some((s) => s.qualifiedPrefix === 'c')).toBe(true);
	});
});

describe('detectSqlClauseContext', () => {
	it('detects FROM context', () => {
		expect(detectSqlClauseContext('SELECT * FROM ')).toBe('from');
		expect(detectSqlClauseContext('SELECT * FROM catalog.schema.')).toBe('from');
	});

	it('detects column context', () => {
		expect(detectSqlClauseContext('SELECT ')).toBe('column');
		expect(detectSqlClauseContext('WHERE o.')).toBe('column');
	});
});

describe('prefixMatches', () => {
	it('matches case-insensitively', () => {
		expect(prefixMatches('orders', 'Ord')).toBe(true);
		expect(prefixMatches('orders', 'xyz')).toBe(false);
	});
});
