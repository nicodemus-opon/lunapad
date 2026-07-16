import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('./db.js', () => ({ query: queryMock }));

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

import {
	upsertCellEmbedding,
	upsertSchemaEmbedding,
	deleteStaleSchemaEmbeddings,
	searchSchemaEmbeddings,
	upsertMemoryEmbedding,
	searchMemoryEmbeddings
} from './embeddings';

function embeddingResponse(): Response {
	return new Response(JSON.stringify({ embedding: new Array(768).fill(0.1) }), { status: 200 });
}

beforeEach(() => {
	queryMock.mockReset();
	queryMock.mockResolvedValue([]);
	fetchMock.mockReset();
});

describe('upsertCellEmbedding', () => {
	it('skips re-embedding when the code hash is unchanged', async () => {
		const code = 'select 1';
		const hash = crypto.createHash('sha256').update(code).digest('hex');
		queryMock.mockResolvedValueOnce([{ code_hash: hash }]);
		await upsertCellEmbedding({ notebookId: 'nb1', cellId: 'c1', outputName: 'orders', code });
		// Only the SELECT happened — no embedding fetch, no INSERT.
		expect(fetchMock).not.toHaveBeenCalled();
		expect(queryMock).toHaveBeenCalledTimes(1);
	});

	it('embeds and upserts when the code hash changed', async () => {
		queryMock.mockResolvedValueOnce([{ code_hash: 'old-hash' }]);
		fetchMock.mockResolvedValueOnce(embeddingResponse());
		await upsertCellEmbedding({
			notebookId: 'nb1',
			cellId: 'c1',
			outputName: 'orders',
			code: 'select 2'
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(queryMock).toHaveBeenCalledTimes(2);
		expect(queryMock.mock.calls[1][0]).toContain('INSERT INTO cell_embeddings');
	});
});

describe('upsertSchemaEmbedding', () => {
	const baseInput = {
		connectionId: 'pg-main',
		tableName: 'public.orders',
		columnNames: 'id, total',
		columnTypes: 'integer, numeric'
	};

	function expectedHash(input: typeof baseInput & { description?: string }): string {
		return crypto
			.createHash('sha256')
			.update(
				`${input.tableName}|${input.columnNames}|${input.columnTypes}|${input.description ?? ''}`
			)
			.digest('hex');
	}

	it('skips re-embedding when content is unchanged (hash match)', async () => {
		queryMock.mockResolvedValueOnce([{ content_hash: expectedHash(baseInput) }]);
		await upsertSchemaEmbedding(baseInput);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(queryMock).toHaveBeenCalledTimes(1);
	});

	it('re-embeds when the description changes even if columns are identical', async () => {
		queryMock.mockResolvedValueOnce([{ content_hash: expectedHash(baseInput) }]);
		fetchMock.mockResolvedValueOnce(embeddingResponse());
		await upsertSchemaEmbedding({ ...baseInput, description: 'Customer orders' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const embeddedText = JSON.parse(fetchMock.mock.calls[0][1].body).prompt as string;
		expect(embeddedText).toContain('Customer orders');
	});

	it('embeds and upserts when there is no existing row', async () => {
		queryMock.mockResolvedValueOnce([]);
		fetchMock.mockResolvedValueOnce(embeddingResponse());
		await upsertSchemaEmbedding(baseInput);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(queryMock.mock.calls[1][0]).toContain('INSERT INTO schema_embeddings');
		expect(queryMock.mock.calls[1][1]).toEqual([
			'default',
			baseInput.connectionId,
			baseInput.tableName,
			baseInput.columnNames,
			baseInput.columnTypes,
			expectedHash(baseInput),
			JSON.stringify(new Array(768).fill(0.1))
		]);
	});
});

describe('deleteStaleSchemaEmbeddings', () => {
	it('deletes rows not in the keep list', async () => {
		queryMock.mockResolvedValueOnce([]);
		await deleteStaleSchemaEmbeddings('pg-main', ['orders', 'customers']);
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining('DELETE FROM schema_embeddings'),
			['pg-main', ['orders', 'customers'], 'default']
		);
	});

	it('deletes everything for the connection when the keep list is empty', async () => {
		queryMock.mockResolvedValueOnce([]);
		await deleteStaleSchemaEmbeddings('pg-main', []);
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining('DELETE FROM schema_embeddings WHERE connection_id = $1'),
			['pg-main', 'default']
		);
	});
});

describe('upsertMemoryEmbedding', () => {
	it('embeds the type-prefixed description and upserts scoped by folder+slug', async () => {
		fetchMock.mockResolvedValueOnce(embeddingResponse());
		queryMock.mockResolvedValueOnce([]);
		await upsertMemoryEmbedding({
			folder: '/proj',
			slug: 'orders-grain',
			type: 'decision',
			description: 'Orders grain is one row per line item.'
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const embeddedText = JSON.parse(fetchMock.mock.calls[0][1].body).prompt as string;
		expect(embeddedText).toBe('decision: Orders grain is one row per line item.');
		expect(queryMock.mock.calls[0][0]).toContain('INSERT INTO memory_embeddings');
		expect(queryMock.mock.calls[0][1]).toEqual([
			'default',
			'default',
			'/proj',
			'orders-grain',
			'decision',
			JSON.stringify(new Array(768).fill(0.1)),
			'Orders grain is one row per line item.'
		]);
	});

	it('does nothing when Ollama is unavailable', async () => {
		fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		await upsertMemoryEmbedding({
			folder: '/proj',
			slug: 'orders-grain',
			type: 'decision',
			description: 'Orders grain is one row per line item.'
		});
		expect(queryMock).not.toHaveBeenCalled();
	});
});

describe('searchMemoryEmbeddings', () => {
	it('scopes the query to the given folder', async () => {
		fetchMock.mockResolvedValueOnce(embeddingResponse());
		queryMock.mockResolvedValueOnce([]);
		await searchMemoryEmbeddings('what is the grain of orders', '/proj', 5);
		const [sql, params] = queryMock.mock.calls[0];
		expect(sql).toContain('WHERE folder = $2');
		expect(params).toEqual([
			JSON.stringify(new Array(768).fill(0.1)),
			'/proj',
			5,
			'default',
			'default'
		]);
	});

	it('returns an empty array when Ollama is unavailable', async () => {
		fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		const result = await searchMemoryEmbeddings('revenue by month', '/proj');
		expect(result).toEqual([]);
		expect(queryMock).not.toHaveBeenCalled();
	});
});

describe('searchSchemaEmbeddings', () => {
	it('scopes the query to the given connectionIds', async () => {
		fetchMock.mockResolvedValueOnce(embeddingResponse());
		queryMock.mockResolvedValueOnce([]);
		await searchSchemaEmbeddings('revenue by month', 40, ['pg-main', 'ch-analytics']);
		const [sql, params] = queryMock.mock.calls[0];
		expect(sql).toContain('WHERE connection_id = ANY($2::text[])');
		expect(params[1]).toEqual(['pg-main', 'ch-analytics']);
	});

	it('omits connection scoping when no connectionIds are given', async () => {
		fetchMock.mockResolvedValueOnce(embeddingResponse());
		queryMock.mockResolvedValueOnce([]);
		await searchSchemaEmbeddings('revenue by month', 40);
		const [sql] = queryMock.mock.calls[0];
		expect(sql).not.toContain('connection_id');
	});

	it('returns an empty array when Ollama is unavailable', async () => {
		fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		const result = await searchSchemaEmbeddings('revenue by month');
		expect(result).toEqual([]);
		expect(queryMock).not.toHaveBeenCalled();
	});
});
