import { describe, expect, it } from 'vitest';
import { buildRelationshipIndex, suggestJoinCompletions } from './sql-relationships';
import { buildLeafCollisions } from './sql-qualify';
import { prefixMatches } from './sql-match';
import { getSqlScope } from './sql-scope';

describe('buildRelationshipIndex', () => {
	it('infers heuristic FK from customer_id column', () => {
		const idx = buildRelationshipIndex([
			{
				connectionId: 'c1',
				connectionName: 'pg',
				name: 'orders',
				schema: 'public',
				columns: ['id', 'customer_id'],
				columnTypes: ['bigint', 'bigint']
			},
			{
				connectionId: 'c1',
				connectionName: 'pg',
				name: 'customers',
				schema: 'public',
				columns: ['id', 'name'],
				columnTypes: ['bigint', 'varchar']
			}
		]);
		const fks = idx.byTable.get('public.orders');
		expect(fks?.some((fk) => fk.referencedTable.includes('customers'))).toBe(true);
	});
});

describe('suggestJoinCompletions', () => {
	it('generates JOIN with ON clause', () => {
		const tables = new Map([
			['orders', [{ name: 'id' }, { name: 'customer_id' }]],
			['public.customers', [{ name: 'id' }, { name: 'name' }]]
		]);
		const idx = buildRelationshipIndex([
			{
				connectionId: 'c1',
				connectionName: 'pg',
				name: 'orders',
				columns: ['id', 'customer_id'],
				columnTypes: ['bigint', 'bigint'],
				foreignKeys: [
					{
						column: 'customer_id',
						referencedTable: 'public.customers',
						referencedColumn: 'id',
						source: 'catalog'
					}
				]
			},
			{
				connectionId: 'c1',
				connectionName: 'pg',
				name: 'customers',
				schema: 'public',
				columns: ['id', 'name'],
				columnTypes: ['bigint', 'varchar']
			}
		]);
		const scope = getSqlScope('SELECT * FROM orders o', 'postgres');
		const joins = suggestJoinCompletions(
			scope,
			idx,
			buildLeafCollisions(tables),
			'',
			prefixMatches
		);
		expect(joins.length).toBeGreaterThan(0);
		expect(joins[0]!.insertText).toMatch(/ON o\.customer_id/);
	});
});
