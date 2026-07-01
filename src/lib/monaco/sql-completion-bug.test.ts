import { beforeAll, describe, expect, it } from 'vitest';
import { initSqlParsersForTests } from './sql-parser-dialect';
import { buildSqlCompletions } from './sql-completion-engine';
import { getSqlScope, resolveTableRef, columnsForRef } from './sql-scope';
import { parseRegistry } from './completions';
import { sqlTableBeforeDot } from './sql-schema-context';

beforeAll(async () => {
	await initSqlParsersForTests();
});

const registry = [
	{ text: 'mm_raw.mpesa_raw.id', detail: 'BIGINT' },
	{ text: 'mm_raw.mpesa_raw.amount', detail: 'DOUBLE' },
	{ text: 'catalog.mm_raw.mpesa_raw.id', detail: 'BIGINT' },
	{ text: 'catalog.mm_raw.mpesa_raw.amount', detail: 'DOUBLE' }
];

describe('mm_raw.mpesa_raw completion regression', () => {
	it('suggests table when typing partial name in FROM', () => {
		const line = 'FROM mm_raw.mpesa_r';
		const results = buildSqlCompletions({
			modelUri: 't',
			registry,
			sql: `SELECT\n  *\n${line}`,
			lineNumber: 3,
			column: line.length + 1,
			lineContent: line,
			word: 'mpesa_r',
			wordStartColumn: 15,
			dialect: 'postgres'
		});
		expect(results.some((r) => r.label.includes('mpesa_raw'))).toBe(true);
	});

	it('suggests columns for alias a.', () => {
		const sql = 'SELECT\n  a.\nFROM mm_raw.mpesa_raw AS a';
		const scope = getSqlScope(sql, 'postgres');
		expect(resolveTableRef(scope, 'a')).toBe('mm_raw.mpesa_raw');
		const { tables } = parseRegistry(registry);
		expect(columnsForRef(scope, tables, 'a')?.length).toBeGreaterThan(0);
		expect(sqlTableBeforeDot('  a.')).toBe('a');

		const results = buildSqlCompletions({
			modelUri: 't',
			registry,
			sql,
			lineNumber: 2,
			column: 5,
			lineContent: '  a.',
			word: '',
			wordStartColumn: 5,
			dialect: 'postgres'
		});
		expect(results.some((r) => r.kind === 'column')).toBe(true);
	});
});
