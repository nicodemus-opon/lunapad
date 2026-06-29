import { describe, expect, it } from 'vitest';
import {
	rankColumnsByRelevance,
	selectSchemaForPrompt,
	type SchemaColumn
} from './ai-schema-context';
import type { AIChatSchemaTable } from '$lib/types/ai-chat.js';

describe('rankColumnsByRelevance', () => {
	const columns: SchemaColumn[] = [
		{ name: 'id', dataKind: 'numeric' },
		{ name: 'revenue', dataKind: 'numeric' },
		{ name: 'region', dataKind: 'text' },
		{ name: 'created_at', dataKind: 'date' }
	];

	it('returns all columns unchanged when under the max', () => {
		expect(rankColumnsByRelevance('revenue by region', columns, 20)).toEqual(columns);
	});

	it('ranks query-matching columns first when over the max', () => {
		const ranked = rankColumnsByRelevance('revenue by region', columns, 2);
		expect(ranked.map((c) => c.name)).toEqual(['revenue', 'region']);
	});
});

describe('selectSchemaForPrompt', () => {
	function table(name: string, columns: string[], description?: string): AIChatSchemaTable {
		return { name, columns, columnTypes: columns.map(() => 'varchar'), description };
	}

	it('returns an empty array for an empty table list', () => {
		expect(selectSchemaForPrompt({ query: 'revenue', tables: [], tokenBudget: 1000 })).toEqual([]);
	});

	it('ranks tables by lexical overlap with the query', () => {
		const tables = [
			table('public.weather', ['temp', 'humidity']),
			table('public.orders', ['id', 'total_revenue', 'region'])
		];
		const result = selectSchemaForPrompt({
			query: 'total revenue by region',
			tables,
			tokenBudget: 10_000
		});
		expect(result[0].name).toBe('public.orders');
	});

	it('boosts tables already referenced in existing cell code regardless of lexical match', () => {
		const tables = [
			table('public.unrelated_but_active', ['x', 'y']),
			table('public.revenue_data', ['amount'])
		];
		const result = selectSchemaForPrompt({
			query: 'something else entirely',
			tables,
			tokenBudget: 10_000,
			activeTableNames: new Set(['public.unrelated_but_active'])
		});
		expect(result[0].name).toBe('public.unrelated_but_active');
	});

	it('is the regression fix: a table outside the old 40-table window still surfaces when relevant', () => {
		// 60 generic filler tables (today's hard slice(0,40) cutoff would drop everything past
		// index 39), then one clearly relevant table appended last.
		const filler = Array.from({ length: 60 }, (_, i) => table(`public.filler_${i}`, ['a', 'b']));
		const relevant = table('public.customer_churn_predictions', ['customer_id', 'churn_score']);
		const tables = [...filler, relevant];

		const result = selectSchemaForPrompt({
			query: 'show me churn predictions by customer',
			tables,
			tokenBudget: 10_000,
			maxTables: 40
		});

		expect(result.some((t) => t.name === 'public.customer_churn_predictions')).toBe(true);
	});

	it('enforces the token budget by dropping the lowest-ranked tables', () => {
		const tables = Array.from({ length: 50 }, (_, i) =>
			table(`public.t${i}`, ['col_a', 'col_b', 'col_c'])
		);
		const result = selectSchemaForPrompt({ query: 'unrelated query', tables, tokenBudget: 50 });
		expect(result.length).toBeLessThan(tables.length);
	});

	it('enforces maxTables even when the token budget allows more', () => {
		const tables = Array.from({ length: 10 }, (_, i) => table(`public.t${i}`, ['a']));
		const result = selectSchemaForPrompt({
			query: 'x',
			tables,
			tokenBudget: 100_000,
			maxTables: 3
		});
		expect(result).toHaveLength(3);
	});

	it('trims columns by relevance and keeps columnTypes in lock-step with the selected columns', () => {
		const t: AIChatSchemaTable = {
			name: 'public.orders',
			columns: ['id', 'unrelated_a', 'unrelated_b', 'revenue', 'unrelated_c'],
			columnTypes: ['integer', 'varchar', 'varchar', 'numeric', 'varchar']
		};
		const [result] = selectSchemaForPrompt({
			query: 'revenue',
			tables: [t],
			tokenBudget: 10_000,
			maxColumnsPerTable: 2
		});
		expect(result.columns).toHaveLength(2);
		// 'revenue' must be selected (it's the query match) and its type must travel with it.
		const revenueIdx = result.columns.indexOf('revenue');
		expect(revenueIdx).toBeGreaterThanOrEqual(0);
		expect(result.columnTypes?.[revenueIdx]).toBe('numeric');
	});

	it('preserves original column order among the selected columns', () => {
		const t: AIChatSchemaTable = {
			name: 'public.t',
			columns: ['z', 'a', 'm'],
			columnTypes: ['x', 'y', 'z']
		};
		const [result] = selectSchemaForPrompt({
			query: 'a m z',
			tables: [t],
			tokenBudget: 10_000,
			maxColumnsPerTable: 3
		});
		expect(result.columns).toEqual(['z', 'a', 'm']);
	});
});
