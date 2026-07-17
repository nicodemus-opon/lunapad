import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/inngest/client', () => ({ inngest: { send: sendMock } }));

const { ensureEmbeddingTablesMock, deleteStaleSchemaEmbeddingsMock } = vi.hoisted(() => ({
	ensureEmbeddingTablesMock: vi.fn().mockResolvedValue(undefined),
	deleteStaleSchemaEmbeddingsMock: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/server/embeddings.js', () => ({
	ensureEmbeddingTables: ensureEmbeddingTablesMock,
	deleteStaleSchemaEmbeddings: deleteStaleSchemaEmbeddingsMock
}));

const { loadManifestMock } = vi.hoisted(() => ({
	loadManifestMock: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/server/dbt.js', () => ({ loadManifest: loadManifestMock }));

vi.mock('$lib/server/project.js', () => ({ assertSafe: vi.fn() }));
vi.mock('$lib/server/project-folders.js', () => ({
	assertTenantProjectFolder: vi.fn((_locals: unknown, folder: string) => folder)
}));

import { POST } from './+server';

function makeRequest(body: unknown): Request {
	return new Request('http://localhost/api/ai/embed-schema', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

beforeEach(() => {
	sendMock.mockClear();
	ensureEmbeddingTablesMock.mockClear();
	deleteStaleSchemaEmbeddingsMock.mockClear();
	loadManifestMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/ai/embed-schema', () => {
	it('rejects a payload missing connectionId or tables', async () => {
		const res = await POST({
			request: makeRequest({ connectionId: 'pg-main', tables: [] })
		} as never);
		expect(res.status).toBe(400);
	});

	it('cleans up stale rows and dispatches an embed event for a small connection', async () => {
		const tables = [
			{ tableName: 'public.orders', columnNames: 'id, total', columnTypes: 'integer, numeric' },
			{ tableName: 'public.customers', columnNames: 'id, name', columnTypes: 'integer, varchar' }
		];
		const res = await POST({ request: makeRequest({ connectionId: 'pg-main', tables }) } as never);
		expect(res.status).toBe(200);

		expect(deleteStaleSchemaEmbeddingsMock).toHaveBeenCalledWith('pg-main', [
			'public.orders',
			'public.customers'
		]);
		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(sendMock.mock.calls[0][0]).toEqual({
			name: 'ai/embed-schema',
			data: { connectionId: 'pg-main', tables }
		});
	});

	it('chunks large connections into multiple events of at most 300 tables', async () => {
		const tables = Array.from({ length: 650 }, (_, i) => ({
			tableName: `public.t${i}`,
			columnNames: 'id',
			columnTypes: 'integer'
		}));
		const res = await POST({ request: makeRequest({ connectionId: 'pg-main', tables }) } as never);
		expect(res.status).toBe(200);
		expect(sendMock).toHaveBeenCalledTimes(3);
		expect(sendMock.mock.calls[0][0].data.tables).toHaveLength(300);
		expect(sendMock.mock.calls[1][0].data.tables).toHaveLength(300);
		expect(sendMock.mock.calls[2][0].data.tables).toHaveLength(50);
	});

	it('overlays dbt model descriptions, taking precedence over the warehouse comment', async () => {
		loadManifestMock.mockResolvedValue([
			{
				name: 'orders',
				schema: 'public',
				description: 'Curated dbt description',
				columns: [],
				upstreamRefs: [],
				materialized: 'table',
				lastRunStatus: 'unknown',
				path: 'staging/orders.sql'
			}
		]);
		const tables = [
			{
				tableName: 'public.orders',
				columnNames: 'id',
				columnTypes: 'integer',
				description: 'Raw warehouse comment'
			}
		];
		await POST({
			request: makeRequest({ connectionId: 'pg-main', tables, projectFolder: '/proj' })
		} as never);

		expect(sendMock.mock.calls[0][0].data.tables[0].description).toBe('Curated dbt description');
	});

	it('keeps the warehouse comment when no dbt model matches', async () => {
		loadManifestMock.mockResolvedValue([
			{
				name: 'unrelated_model',
				schema: 'public',
				description: 'Not this table',
				columns: [],
				upstreamRefs: [],
				materialized: 'table',
				lastRunStatus: 'unknown',
				path: 'staging/unrelated.sql'
			}
		]);
		const tables = [
			{
				tableName: 'public.orders',
				columnNames: 'id',
				columnTypes: 'integer',
				description: 'Raw warehouse comment'
			}
		];
		await POST({
			request: makeRequest({ connectionId: 'pg-main', tables, projectFolder: '/proj' })
		} as never);

		expect(sendMock.mock.calls[0][0].data.tables[0].description).toBe('Raw warehouse comment');
	});

	it('does not call loadManifest when no projectFolder is given', async () => {
		const tables = [{ tableName: 'public.orders', columnNames: 'id', columnTypes: 'integer' }];
		await POST({ request: makeRequest({ connectionId: 'pg-main', tables }) } as never);
		expect(loadManifestMock).not.toHaveBeenCalled();
	});
});
