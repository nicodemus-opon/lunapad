import { beforeAll, describe, expect, it } from 'vitest';
import { initSqlParsersForTests } from './sql-parser-dialect';
import { parseRegistry } from './completions';
import { columnsInScope, getSqlScope } from './sql-scope';

beforeAll(async () => {
	await initSqlParsersForTests();
});

describe('scoped completion ranking', () => {
	it('narrows columns to tables in FROM scope', () => {
		const registry = parseRegistry([
			{ text: 'orders.id', detail: 'BIGINT' },
			{ text: 'orders.amount', detail: 'DOUBLE' },
			{ text: 'customers.name', detail: 'VARCHAR' }
		]);
		const scope = getSqlScope('SELECT 1 FROM orders o', 'duckdb-wasm');
		const scoped = columnsInScope(scope, registry.tables);
		const prefixes = scoped.map((s) => s.qualifiedPrefix);
		expect(prefixes).toContain('o');
		expect(prefixes).not.toContain('customers');
		expect(scoped.find((s) => s.qualifiedPrefix === 'o')?.columns).toHaveLength(2);
	});
});
