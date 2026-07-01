import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hasPostgresMock, hasOllamaMock } = vi.hoisted(() => ({
	hasPostgresMock: vi.fn(),
	hasOllamaMock: vi.fn()
}));
vi.mock('$lib/server/ai-capabilities.js', () => ({
	hasPostgres: hasPostgresMock,
	hasOllama: hasOllamaMock
}));

const { countSchemaEmbeddingsMock, listSchemaEmbeddingsMock, searchSchemaEmbeddingsMock } =
	vi.hoisted(() => ({
		countSchemaEmbeddingsMock: vi.fn(),
		listSchemaEmbeddingsMock: vi.fn(),
		searchSchemaEmbeddingsMock: vi.fn()
	}));
vi.mock('$lib/server/embeddings.js', () => ({
	countSchemaEmbeddings: countSchemaEmbeddingsMock,
	listSchemaEmbeddings: listSchemaEmbeddingsMock,
	searchSchemaEmbeddings: searchSchemaEmbeddingsMock
}));

import {
	resolveExternalSchema,
	_resetTableCountCacheForTests
} from '$lib/server/ai-schema-context.js';
import type { AIChatSchemaTable } from '$lib/types/ai-chat.js';

const fallback: AIChatSchemaTable[] = [
	{ name: 'public.fallback_table', columns: ['id'], columnTypes: ['integer'] }
];

beforeEach(() => {
	hasPostgresMock.mockReset().mockResolvedValue(true);
	hasOllamaMock.mockReset().mockResolvedValue(true);
	countSchemaEmbeddingsMock.mockReset();
	listSchemaEmbeddingsMock.mockReset().mockResolvedValue([]);
	searchSchemaEmbeddingsMock.mockReset().mockResolvedValue([]);
	_resetTableCountCacheForTests();
});

describe('resolveExternalSchema', () => {
	it('returns empty immediately when there are no external connections', async () => {
		const result = await resolveExternalSchema({
			connectionIds: [],
			userQuery: 'revenue',
			fallback
		});
		expect(result).toEqual([]);
		expect(hasPostgresMock).not.toHaveBeenCalled();
	});

	it('falls back to the client-supplied list when Postgres is unavailable', async () => {
		hasPostgresMock.mockResolvedValue(false);
		const result = await resolveExternalSchema({
			connectionIds: ['pg-main'],
			userQuery: 'revenue',
			fallback
		});
		expect(result).toEqual(fallback);
		expect(countSchemaEmbeddingsMock).not.toHaveBeenCalled();
	});

	it('falls back to the client-supplied list when Ollama is unavailable', async () => {
		hasOllamaMock.mockResolvedValue(false);
		const result = await resolveExternalSchema({
			connectionIds: ['pg-main'],
			userQuery: 'revenue',
			fallback
		});
		expect(result).toEqual(fallback);
	});

	it('falls back when nothing has been embedded yet for these connections', async () => {
		countSchemaEmbeddingsMock.mockResolvedValue(0);
		const result = await resolveExternalSchema({
			connectionIds: ['pg-main'],
			userQuery: 'revenue',
			fallback
		});
		expect(result).toEqual(fallback);
		expect(searchSchemaEmbeddingsMock).not.toHaveBeenCalled();
	});

	it('uses the cheap lexical pre-filter below the table-count threshold', async () => {
		countSchemaEmbeddingsMock.mockResolvedValue(10);
		listSchemaEmbeddingsMock.mockResolvedValue([
			{ table_name: 'public.orders', column_names: 'id, total', column_types: 'integer, numeric' },
			{ table_name: 'public.customers', column_names: 'id, name', column_types: 'integer, varchar' }
		]);
		const result = await resolveExternalSchema({
			connectionIds: ['pg-main'],
			userQuery: 'order totals',
			fallback
		});
		expect(listSchemaEmbeddingsMock).toHaveBeenCalledWith(['pg-main']);
		expect(searchSchemaEmbeddingsMock).not.toHaveBeenCalled();
		expect(result.map((t) => t.name)).toContain('public.orders');
	});

	it('uses semantic search above the table-count threshold, scoped to the given connections', async () => {
		countSchemaEmbeddingsMock.mockResolvedValue(500);
		searchSchemaEmbeddingsMock.mockResolvedValue([
			{
				table_name: 'public.orders',
				column_names: 'id, total',
				column_types: 'integer, numeric',
				similarity: 0.9
			}
		]);
		const result = await resolveExternalSchema({
			connectionIds: ['pg-main', 'ch-analytics'],
			userQuery: 'order totals',
			fallback
		});
		expect(searchSchemaEmbeddingsMock).toHaveBeenCalledWith('order totals', 40, [
			'pg-main',
			'ch-analytics'
		]);
		expect(result).toEqual([
			{ name: 'public.orders', columns: ['id', 'total'], columnTypes: ['integer', 'numeric'] }
		]);
	});

	it('falls back when semantic search returns no matches above the threshold', async () => {
		countSchemaEmbeddingsMock.mockResolvedValue(500);
		searchSchemaEmbeddingsMock.mockResolvedValue([]);
		const result = await resolveExternalSchema({
			connectionIds: ['pg-main'],
			userQuery: 'order totals',
			fallback
		});
		expect(result).toEqual(fallback);
	});
});
