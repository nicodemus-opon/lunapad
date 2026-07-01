import { describe, expect, it } from 'vitest';
import { initSqlParsers, parseSqlAst, sqlParsersReady } from './sql-parser-dialect';

describe('initSqlParsers', () => {
	it('loads dialect bundles and parses SQL', async () => {
		await initSqlParsers();
		expect(sqlParsersReady()).toBe(true);
		const ast = parseSqlAst('SELECT id FROM orders o', 'postgresql');
		expect(ast).toBeTruthy();
		expect((ast as { type?: string }).type).toBe('select');
	});
});
