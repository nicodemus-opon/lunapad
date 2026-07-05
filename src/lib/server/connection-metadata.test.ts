import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '$lib/types/connection';

const { getConnectionMetadataMock, upsertConnectionMetadataMock } = vi.hoisted(() => ({
	getConnectionMetadataMock: vi.fn(),
	upsertConnectionMetadataMock: vi.fn()
}));

vi.mock('./connections-store.js', () => ({
	getConnectionMetadata: getConnectionMetadataMock,
	upsertConnectionMetadata: upsertConnectionMetadataMock
}));

import { resolveConnectionMetadata } from './connection-metadata';

const pgConnection: Connection = {
	id: 'pg-main',
	name: 'Primary Postgres',
	type: 'postgres',
	catalogName: 'primary_postgres',
	host: 'localhost',
	port: 5432,
	database: 'jobs',
	username: 'postgres',
	ssl: false
};

const duckdbConnection: Connection = {
	id: 'builtin.duckdb',
	name: 'DuckDB',
	type: 'duckdb-wasm',
	builtin: true
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('resolveConnectionMetadata', () => {
	it('uses the stored connection when metadata already exists', async () => {
		const stored = { ...pgConnection, name: 'Stored name' };
		getConnectionMetadataMock.mockResolvedValueOnce(stored);

		await expect(resolveConnectionMetadata(pgConnection)).resolves.toEqual(stored);
		expect(upsertConnectionMetadataMock).not.toHaveBeenCalled();
	});

	it('backfills missing external connection metadata from the request payload', async () => {
		getConnectionMetadataMock.mockResolvedValueOnce(null);

		await expect(resolveConnectionMetadata(pgConnection)).resolves.toEqual(pgConnection);
		expect(upsertConnectionMetadataMock).toHaveBeenCalledWith(pgConnection);
	});

	it('does not backfill the built-in DuckDB connection', async () => {
		getConnectionMetadataMock.mockResolvedValueOnce(null);

		await expect(resolveConnectionMetadata(duckdbConnection)).resolves.toBeNull();
		expect(upsertConnectionMetadataMock).not.toHaveBeenCalled();
	});
});
