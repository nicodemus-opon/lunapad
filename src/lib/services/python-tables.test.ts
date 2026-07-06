import { describe, expect, it } from 'vitest';
import {
	buildPythonCatalogEntries,
	extractPythonTableRefs,
	rankPythonTableHints,
	resolvePythonCatalogEntry
} from './python-tables';

describe('python tables helpers', () => {
	it('extracts attribute, item, and load references from python code', () => {
		const refs = extractPythonTableRefs(`
df = tables.orders
detail = tables["analytics.public.orders"]
full = tables.load("analytics.public.customers")
`);

		expect(refs.attributeNames).toEqual(['orders']);
		expect(refs.itemNames).toEqual(['analytics.public.orders']);
		expect(refs.loadNames).toEqual(['analytics.public.customers']);
	});

	it('builds canonical external names without exposing them as bare attribute aliases', () => {
		const entries = buildPythonCatalogEntries({
			localTables: [{ name: 'orders', fileName: 'orders.csv', rowCount: 10, columns: ['id'], columnTypes: ['BIGINT'] }],
			externalTables: [
				{
					connectionId: 'pg-main',
					connectionName: 'Primary Postgres',
					name: 'orders',
					schema: 'public',
					columns: ['id', 'status'],
					columnTypes: ['BIGINT', 'VARCHAR']
				}
			],
			connections: [
				{
					id: 'pg-main',
					name: 'Primary Postgres',
					type: 'postgres',
					catalogName: 'analytics',
					host: 'localhost',
					port: 5432,
					database: 'warehouse',
					username: 'nico',
					ssl: false
				}
			]
		});

		expect(resolvePythonCatalogEntry('analytics.public.orders', entries)?.canonicalName).toBe(
			'analytics.public.orders'
		);
		const externalEntry = entries.find((entry) => entry.source === 'external');
		expect(externalEntry).toBeTruthy();
		expect(externalEntry?.attributeAlias ?? null).toBeNull();
	});

	it('caps ranked hints and prioritizes directly referenced tables', () => {
		const entries = Array.from({ length: 40 }, (_, idx) => ({
			source: 'local' as const,
			canonicalName: idx === 25 ? 'orders' : `table_${idx}`,
			aliases: [idx === 25 ? 'orders' : `table_${idx}`],
			attributeAlias: idx === 25 ? 'orders' : `table_${idx}`,
			columns: ['id', 'amount'],
			columnTypes: ['BIGINT', 'DOUBLE']
		}));

		const hints = rankPythonTableHints('df = tables["orders"]', entries);

		expect(hints).toHaveLength(24);
		expect(hints[0]?.canonicalName).toBe('orders');
	});
});
