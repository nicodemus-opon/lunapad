import { describe, expect, it } from 'vitest';
import { checkReadableSQL, assertReadableSQL } from './sql-readonly';

describe('checkReadableSQL', () => {
	it('allows single read-only statements', () => {
		expect(checkReadableSQL('SELECT * FROM orders')).toBeNull();
		expect(checkReadableSQL('WITH x AS (SELECT 1) SELECT * FROM x')).toBeNull();
		expect(checkReadableSQL('VALUES (1), (2)')).toBeNull();
		expect(checkReadableSQL('EXPLAIN SELECT 1')).toBeNull();
	});

	it('rejects multi-statement SQL (the query_data LIMIT bypass)', () => {
		expect(checkReadableSQL('DROP TABLE orders; SELECT 1 LIMIT 1')).toBe(
			'Only a single SQL statement is allowed.'
		);
		expect(checkReadableSQL('SELECT 1; SELECT 2')).toBe('Only a single SQL statement is allowed.');
	});

	it('rejects DDL/DML and non-SELECT starts', () => {
		expect(checkReadableSQL('DROP TABLE orders')).toBeTruthy();
		expect(checkReadableSQL('DELETE FROM orders')).toBeTruthy();
		expect(checkReadableSQL('UPDATE orders SET x = 1')).toBeTruthy();
		expect(checkReadableSQL('INSERT INTO orders VALUES (1)')).toBeTruthy();
		expect(checkReadableSQL('ATTACH \x27x.db\x27')).toBeTruthy();
		expect(checkReadableSQL('COPY orders TO \x27f.csv\x27')).toBeTruthy();
	});

	it('rejects empty SQL', () => {
		expect(checkReadableSQL('   ')).toBe('SQL query is required.');
	});

	it('assertReadableSQL throws on unsafe SQL', () => {
		expect(() => assertReadableSQL('DROP TABLE x')).toThrow('read-only');
		expect(() => assertReadableSQL('SELECT 1')).not.toThrow();
	});
});
