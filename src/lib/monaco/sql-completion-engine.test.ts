import { beforeAll, describe, expect, it } from 'vitest';
import { initSqlParsersForTests } from './sql-parser-dialect';
import { buildSqlCompletions } from './sql-completion-engine';

beforeAll(async () => {
	await initSqlParsersForTests();
});

describe('buildSqlCompletions', () => {
	const registry = [
		{ text: 'orders.id', detail: 'BIGINT' },
		{ text: 'orders.customer_id', detail: 'BIGINT' },
		{ text: 'orders.amount', detail: 'DOUBLE' },
		{ text: 'customers.id', detail: 'BIGINT' },
		{ text: 'customers.name', detail: 'VARCHAR' }
	];

	it('prioritizes scoped columns in WHERE', () => {
		const sql = 'SELECT * FROM orders o WHERE ';
		const results = buildSqlCompletions({
			modelUri: 'test',
			registry,
			sql,
			lineNumber: 1,
			column: sql.length + 1,
			lineContent: sql,
			word: '',
			wordStartColumn: sql.length + 1,
			dialect: 'duckdb-wasm'
		});
		const colLabels = results.filter((r) => r.kind === 'column').map((r) => r.label);
		expect(colLabels.some((l) => l.startsWith('o.'))).toBe(true);
		expect(colLabels.some((l) => l.startsWith('customers.'))).toBe(false);
	});

	it('offers INSERT column snippet', () => {
		const sql = 'INSERT INTO orders ';
		const results = buildSqlCompletions({
			modelUri: 'test',
			registry,
			sql,
			lineNumber: 1,
			column: sql.length + 1,
			lineContent: sql,
			word: '',
			wordStartColumn: sql.length + 1,
			dialect: 'duckdb-wasm'
		});
		expect(results.some((r) => r.label === 'orders' && r.insertText.includes('VALUES'))).toBe(true);
	});

	it('matches camelCase prefix on columns', () => {
		const sql = 'SELECT customer_id FROM orders WHERE ';
		const results = buildSqlCompletions({
			modelUri: 'test',
			registry,
			sql,
			lineNumber: 1,
			column: sql.length + 1,
			lineContent: sql,
			word: 'ci',
			wordStartColumn: sql.length - 1,
			dialect: 'duckdb-wasm'
		});
		expect(results.some((r) => r.label === 'customer_id')).toBe(true);
	});
});
