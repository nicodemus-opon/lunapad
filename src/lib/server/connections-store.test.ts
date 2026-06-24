import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '$lib/types/connection';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('./db.js', () => ({ query: queryMock }));

import {
	upsertConnectionMetadata,
	listConnectionsMetadata,
	getConnectionMetadata,
	deleteConnectionMetadata
} from './connections-store';

let rows: Map<string, Connection> = new Map();

beforeEach(() => {
	rows = new Map();
	queryMock.mockReset();
	queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
		if (sql.includes('CREATE TABLE')) return [];

		if (sql.includes('INSERT INTO connections')) {
			const [connectionId, data] = params as [string, string];
			rows.set(connectionId, JSON.parse(data) as Connection);
			return [];
		}

		if (sql.includes('SELECT data FROM connections ORDER BY')) {
			return [...rows.values()].map((data) => ({ data }));
		}

		if (sql.includes('SELECT data FROM connections WHERE connection_id')) {
			const [connectionId] = params as [string];
			const data = rows.get(connectionId);
			return data ? [{ data }] : [];
		}

		if (sql.includes('DELETE FROM connections')) {
			const [connectionId] = params as [string];
			rows.delete(connectionId);
			return [];
		}

		throw new Error(`Unhandled query in test mock: ${sql}`);
	});
});

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

describe('upsertConnectionMetadata', () => {
	it('stores connection metadata, retrievable by id', async () => {
		await upsertConnectionMetadata(pgConnection);
		expect(await getConnectionMetadata('pg-main')).toEqual(pgConnection);
	});

	it('overwrites on conflict', async () => {
		await upsertConnectionMetadata(pgConnection);
		await upsertConnectionMetadata({ ...pgConnection, name: 'Renamed' });
		expect((await getConnectionMetadata('pg-main'))?.name).toBe('Renamed');
	});

	it('silently skips the built-in duckdb-wasm connection', async () => {
		await upsertConnectionMetadata({
			id: 'builtin.duckdb',
			name: 'DuckDB',
			type: 'duckdb-wasm',
			builtin: true
		});
		expect(await listConnectionsMetadata()).toHaveLength(0);
	});

	it('never persists secret fields (none exist on Connection, but guard the shape)', async () => {
		await upsertConnectionMetadata(pgConnection);
		const stored = await getConnectionMetadata('pg-main');
		expect(stored).not.toHaveProperty('password');
		expect(stored).not.toHaveProperty('token');
	});
});

describe('listConnectionsMetadata', () => {
	it('returns all stored connections', async () => {
		await upsertConnectionMetadata(pgConnection);
		await upsertConnectionMetadata({
			...pgConnection,
			id: 'ch-main',
			catalogName: 'ch',
			type: 'clickhouse',
			secure: false
		} as Connection);
		expect(await listConnectionsMetadata()).toHaveLength(2);
	});
});

describe('getConnectionMetadata', () => {
	it('returns null for an unknown id', async () => {
		expect(await getConnectionMetadata('nope')).toBeNull();
	});
});

describe('deleteConnectionMetadata', () => {
	it('removes the row', async () => {
		await upsertConnectionMetadata(pgConnection);
		await deleteConnectionMetadata('pg-main');
		expect(await getConnectionMetadata('pg-main')).toBeNull();
	});
});
