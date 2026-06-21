import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '$lib/types/connection';

const { fetchMock, mkdirMock, writeFileMock, readFileMock, unlinkMock } = vi.hoisted(() => ({
	fetchMock: vi.fn(),
	mkdirMock: vi.fn(),
	writeFileMock: vi.fn(),
	readFileMock: vi.fn(),
	unlinkMock: vi.fn()
}));

vi.mock('node:fs/promises', () => ({
	default: { mkdir: mkdirMock, writeFile: writeFileMock, readFile: readFileMock, unlink: unlinkMock }
}));

vi.stubGlobal('fetch', fetchMock);

import {
	testExternalConnection,
	queryExternalConnection,
	fetchExternalConnectionSchema,
	materializeExternalConnection,
	registerCatalog,
	unregisterCatalog
} from '$lib/server/connections';

const postgresConnection: Connection = {
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

const clickHouseConnection: Connection = {
	id: 'ch-main',
	name: 'Primary ClickHouse',
	type: 'clickhouse',
	catalogName: 'primary_clickhouse',
	host: '127.0.0.1',
	port: 8123,
	database: 'analytics',
	username: 'default',
	secure: false
};

/** Single-page Trino query response (done immediately, no nextUri). */
function trinoPage(columns: { name: string; type?: string }[], data: unknown[][]): Response {
	return new Response(
		JSON.stringify({ id: 'q1', columns: columns.map((c) => ({ type: 'varchar', ...c })), data, stats: { state: 'FINISHED' } }),
		{ status: 200 }
	);
}

/** SHOW CATALOGS response including the given catalog names. */
function trinoShowCatalogs(...names: string[]): Response {
	return trinoPage([{ name: 'Catalog' }], names.map((n) => [n]));
}

// Pre-built catalog file content for the test connections (mirrors buildCatalogFileContent).
// Used by readFileMock to simulate "file unchanged" so tests that only care about content
// don't need to mock the full Trino restart sequence.
const PG_CATALOG_CONTENT_PW = [
	'connector.name=postgresql',
	'connection-url=jdbc:postgresql://localhost:5432/jobs',
	'connection-user=postgres',
	'connection-password=pw'
].join('\n') + '\n';

const CH_CATALOG_CONTENT_SECRET = [
	'connector.name=clickhouse',
	'connection-url=jdbc:clickhouse://127.0.0.1:8123/analytics',
	'connection-user=default',
	'connection-password=secret'
].join('\n') + '\n';

// Postgres with verify-full SSL
const PG_CATALOG_CONTENT_VERIFY_FULL = [
	'connector.name=postgresql',
	'connection-url=jdbc:postgresql://localhost:5432/jobs?ssl=true&sslmode=verify-full',
	'connection-user=postgres',
	'connection-password=pw'
].join('\n') + '\n';

beforeEach(() => {
	fetchMock.mockReset();
	mkdirMock.mockReset().mockResolvedValue(undefined);
	writeFileMock.mockReset().mockResolvedValue(undefined);
	// Default: catalog file does not exist yet → content is always "changed"
	readFileMock.mockReset().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
	unlinkMock.mockReset().mockResolvedValue(undefined);
	process.env.TRINO_CATALOG_DIR = '/tmp/test-catalog';
});

describe('registerCatalog', () => {
	it('skips restart when catalog is active and file is unchanged', async () => {
		// readFile returns identical content → changed = false
		readFileMock.mockResolvedValueOnce(PG_CATALOG_CONTENT_PW);
		fetchMock.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_postgres'));

		await registerCatalog(postgresConnection, { password: 'pw' });

		expect(writeFileMock).toHaveBeenCalledWith(
			expect.stringContaining('primary_postgres.properties'),
			expect.stringContaining('connector.name=postgresql'),
			'utf-8'
		);
		// Only SHOW CATALOGS — no restart
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('restarts when catalog is active but credentials changed', async () => {
		vi.useFakeTimers();
		// readFile returns OLD content (different password) → changed = true
		readFileMock.mockResolvedValueOnce(PG_CATALOG_CONTENT_PW.replace('connection-password=pw', 'connection-password=old'));
		fetchMock
			// SHOW CATALOGS: active with old creds
			.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_postgres'))
			// PUT /v1/info/state
			.mockResolvedValueOnce(new Response('', { status: 200 }))
			// GET /v1/info: Trino down
			.mockRejectedValueOnce(new Error('ECONNREFUSED'))
			// GET /v1/info: Trino ready
			.mockResolvedValueOnce(new Response(JSON.stringify({ starting: false }), { status: 200 }))
			// SHOW CATALOGS: still active after restart
			.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_postgres'));

		const promise = registerCatalog(postgresConnection, { password: 'pw' });
		await vi.advanceTimersByTimeAsync(6_000);
		await expect(promise).resolves.toBeUndefined();
		vi.useRealTimers();

		const stateCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/v1/info/state'));
		expect(stateCall).toBeTruthy();
	});

	it('writes file, triggers restart, waits for ready when catalog not active', async () => {
		vi.useFakeTimers();
		// readFile throws ENOENT (default) → changed = true; catalog not active → restart
		fetchMock
			.mockResolvedValueOnce(trinoShowCatalogs('tpch'))
			.mockResolvedValueOnce(new Response('', { status: 200 }))
			.mockRejectedValueOnce(new Error('ECONNREFUSED'))
			.mockResolvedValueOnce(new Response(JSON.stringify({ starting: true }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ starting: false }), { status: 200 }))
			.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_postgres'));

		const promise = registerCatalog(postgresConnection, { password: 'pw' });
		await vi.advanceTimersByTimeAsync(6_000);
		await expect(promise).resolves.toBeUndefined();
		vi.useRealTimers();

		const stateCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/v1/info/state'));
		expect(stateCall).toBeTruthy();
		expect(stateCall?.[1]?.body).toBe('SHUTTING_DOWN');
	});

	it('rejects invalid catalogName before writing', async () => {
		const bad = { ...postgresConnection, catalogName: 'INVALID!' };
		await expect(registerCatalog(bad, {})).rejects.toThrow('Invalid source ID');
		expect(writeFileMock).not.toHaveBeenCalled();
	});

	it('writes correct JDBC URL for ClickHouse (no SSL)', async () => {
		readFileMock.mockResolvedValueOnce(CH_CATALOG_CONTENT_SECRET);
		fetchMock.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_clickhouse'));

		await registerCatalog(clickHouseConnection, { password: 'secret' });

		const content = writeFileMock.mock.calls[0]?.[1] as string;
		expect(content).toContain('connector.name=clickhouse');
		expect(content).toContain('jdbc:clickhouse://127.0.0.1:8123/analytics');
		expect(content).not.toContain('ssl');
		expect(content).toContain('connection-password=secret');
	});

	it('adds sslmode=none for secure ClickHouse', async () => {
		const secureConn = { ...clickHouseConnection, secure: true };
		const secureContent = CH_CATALOG_CONTENT_SECRET.replace(
			'jdbc:clickhouse://127.0.0.1:8123/analytics',
			'jdbc:clickhouse://127.0.0.1:8123/analytics?ssl=true&sslmode=none'
		);
		readFileMock.mockResolvedValueOnce(secureContent);
		fetchMock.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_clickhouse'));

		await registerCatalog(secureConn, { password: 'secret' });

		const content = writeFileMock.mock.calls[0]?.[1] as string;
		expect(content).toContain('?ssl=true&sslmode=none');
	});

	it('uses sslMode=verify-full for Postgres when set', async () => {
		const verifyConn = { ...postgresConnection, ssl: true, sslMode: 'verify-full' as const };
		readFileMock.mockResolvedValueOnce(PG_CATALOG_CONTENT_VERIFY_FULL);
		fetchMock.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_postgres'));

		await registerCatalog(verifyConn, { password: 'pw' });

		const content = writeFileMock.mock.calls[0]?.[1] as string;
		expect(content).toContain('sslmode=verify-full');
		expect(content).not.toContain('sslmode=require');
	});

	it('escapes special chars in password', async () => {
		const escaped = PG_CATALOG_CONTENT_PW.replace('connection-password=pw', 'connection-password=p@ss\\=word\\#1\\!');
		readFileMock.mockResolvedValueOnce(escaped);
		fetchMock.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_postgres'));

		await registerCatalog(postgresConnection, { password: 'p@ss=word#1!' });

		const content = writeFileMock.mock.calls[0]?.[1] as string;
		expect(content).toContain('p@ss\\=word\\#1\\!');
	});
});

describe('unregisterCatalog', () => {
	it('deletes the catalog file', async () => {
		await unregisterCatalog('primary_postgres');
		expect(unlinkMock).toHaveBeenCalledWith(expect.stringContaining('primary_postgres.properties'));
	});

	it('silently ignores ENOENT', async () => {
		unlinkMock.mockRejectedValueOnce(Object.assign(new Error(), { code: 'ENOENT' }));
		await expect(unregisterCatalog('nonexistent')).resolves.toBeUndefined();
	});
});

describe('testExternalConnection', () => {
	it('succeeds when probe returns rows', async () => {
		readFileMock.mockResolvedValueOnce(PG_CATALOG_CONTENT_PW);
		fetchMock
			.mockResolvedValueOnce(trinoShowCatalogs('primary_postgres'))
			.mockResolvedValueOnce(trinoPage([{ name: '1' }], [[1]]));

		await expect(testExternalConnection(postgresConnection, { password: 'pw' })).resolves.toEqual({ ok: true });
		expect(writeFileMock).toHaveBeenCalled();

		const probeBody = fetchMock.mock.calls[1]?.[1]?.body as string;
		expect(probeBody).toContain('information_schema.schemata');
	});

	it('throws when probe returns 0 rows (database unreachable)', async () => {
		readFileMock.mockResolvedValueOnce(PG_CATALOG_CONTENT_PW);
		fetchMock
			.mockResolvedValueOnce(trinoShowCatalogs('primary_postgres'))
			// Trino returns empty result when it can't reach the underlying DB
			.mockResolvedValueOnce(trinoPage([{ name: '1' }], []));

		await expect(testExternalConnection(postgresConnection, { password: 'pw' }))
			.rejects.toThrow('got no response from the postgres database');
	});
});

describe('queryExternalConnection', () => {
	it('routes read-only SQL through Trino with catalog/schema headers', async () => {
		fetchMock.mockResolvedValueOnce(
			trinoPage([{ name: 'id' }, { name: 'title' }], [[1, 'Engineer']])
		);

		const result = await queryExternalConnection(postgresConnection, undefined, 'SELECT id, title FROM jobs');

		expect(result.columns).toEqual(['id', 'title']);
		expect(result.rows).toEqual([{ id: 1, title: 'Engineer' }]);
		const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
		expect(headers?.['X-Trino-Catalog']).toBe('primary_postgres');
		expect(headers?.['X-Trino-Schema']).toBe('public');
	});

	it('auto-registers on catalog-not-found then retries', async () => {
		// readFile returns same content → changed=false → no restart, just re-register
		readFileMock.mockResolvedValueOnce(PG_CATALOG_CONTENT_PW);
		fetchMock
			// First query fails: catalog not found
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ id: 'q1', error: { message: "Catalog 'primary_postgres' does not exist" }, stats: { state: 'FAILED' } }),
					{ status: 200 }
				)
			)
			// SHOW CATALOGS: already active (no restart needed)
			.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_postgres'))
			// Retry query succeeds
			.mockResolvedValueOnce(trinoPage([{ name: 'id' }], [[1]]));

		const result = await queryExternalConnection(postgresConnection, { password: 'pw' }, 'SELECT id FROM t');
		expect(result.rows).toEqual([{ id: 1 }]);
	});

	it('handles paginated responses', async () => {
		fetchMock
			.mockResolvedValueOnce(
				new Response(JSON.stringify({
					id: 'q1', columns: [{ name: 'id' }], data: [[1]],
					nextUri: 'http://trino:8080/v1/statement/executing/q1?token=1'
				}), { status: 200 })
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: 'q1', data: [[2], [3]], stats: { state: 'FINISHED' } }), { status: 200 })
			);

		const result = await queryExternalConnection(postgresConnection, undefined, 'SELECT id FROM t');
		expect(result.rows).toHaveLength(3);
	});

	it('blocks write SQL', async () => {
		await expect(
			queryExternalConnection(postgresConnection, undefined, 'DELETE FROM jobs')
		).rejects.toThrow('Only read-only SQL statements are allowed');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('allows a Trino inline Python UDF whose body contains write-like keywords and semicolons as literal text', async () => {
		fetchMock.mockResolvedValueOnce(trinoPage([{ name: 'id' }], [[2]]));
		const udfQuery = [
			"WITH FUNCTION my_udf(x bigint) RETURNS bigint LANGUAGE PYTHON WITH (handler = 'my_udf') AS $$",
			'def my_udf(x):',
			"    s = '; DROP TABLE x; --'",
			'    return x',
			'$$',
			'SELECT my_udf(id) FROM jobs'
		].join('\n');

		const result = await queryExternalConnection(postgresConnection, undefined, udfQuery);
		expect(result.rows).toEqual([{ id: 2 }]);
		expect(fetchMock).toHaveBeenCalled();
	});

	it('still blocks a genuine write statement outside the dollar-quoted UDF body', async () => {
		const udfQuery = [
			"WITH FUNCTION my_udf(x bigint) RETURNS bigint LANGUAGE PYTHON WITH (handler = 'my_udf') AS $$",
			'def my_udf(x):',
			'    return x',
			'$$',
			'DELETE FROM jobs'
		].join('\n');

		await expect(queryExternalConnection(postgresConnection, undefined, udfQuery)).rejects.toThrow(
			'Only read-only SQL statements are allowed'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('blocks an unbalanced/unterminated dollar-quoted block as a safe failure', async () => {
		const udfQuery = [
			"WITH FUNCTION my_udf(x bigint) RETURNS bigint LANGUAGE PYTHON WITH (handler='my_udf') AS $$",
			'def my_udf(x):',
			'    return x; DROP TABLE jobs',
			'SELECT my_udf(1)'
		].join('\n');

		await expect(queryExternalConnection(postgresConnection, undefined, udfQuery)).rejects.toThrow(
			'Only a single SQL statement is allowed'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('fetchExternalConnectionSchema', () => {
	it('queries catalog information_schema.columns directly', async () => {
		fetchMock.mockResolvedValueOnce(
			trinoPage(
				[{ name: 'table_schem' }, { name: 'table_name' }, { name: 'column_name' }, { name: 'type_name' }],
				[['public', 'jobs', 'id', 'integer'], ['public', 'jobs', 'title', 'varchar']]
			)
		);

		const result = await fetchExternalConnectionSchema(postgresConnection);
		expect(result.tables).toHaveLength(1);
		expect(result.tables[0]).toEqual({ name: 'jobs', schema: 'public', columns: ['id', 'title'], columnTypes: ['integer', 'varchar'] });

		const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
		expect(headers?.['X-Trino-Catalog']).toBe('primary_postgres');
		const body = fetchMock.mock.calls[0]?.[1]?.body as string;
		expect(body).toContain('"primary_postgres".information_schema.columns');
	});

	it('auto-registers on catalog-not-found then retries', async () => {
		// readFile returns same content → changed=false → no restart on re-register
		readFileMock.mockResolvedValueOnce(PG_CATALOG_CONTENT_PW);
		fetchMock
			// First schema query fails: catalog not found
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ id: 'q1', error: { message: "Catalog 'primary_postgres' does not exist" }, stats: { state: 'FAILED' } }),
					{ status: 200 }
				)
			)
			// SHOW CATALOGS: already active
			.mockResolvedValueOnce(trinoShowCatalogs('tpch', 'primary_postgres'))
			// Retry returns columns
			.mockResolvedValueOnce(
				trinoPage(
					[{ name: 'table_schem' }, { name: 'table_name' }, { name: 'column_name' }, { name: 'type_name' }],
					[['public', 'orders', 'id', 'integer']]
				)
			);

		const result = await fetchExternalConnectionSchema(postgresConnection, { password: 'pw' });
		expect(result.tables).toHaveLength(1);
		expect(result.tables[0].name).toBe('orders');
	});
});

describe('materializeExternalConnection', () => {
	it('materializes as view with 3-part Trino DDL', async () => {
		fetchMock
			.mockResolvedValueOnce(trinoPage([{ name: 'table_type' }], []))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ddl', stats: { state: 'FINISHED' } }), { status: 200 }));

		const result = await materializeExternalConnection(postgresConnection, undefined, 'mart', undefined, 'SELECT 1', 'view');
		expect(result.type).toBe('view');
		expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('CREATE OR REPLACE VIEW "primary_postgres"."public"."mart"');
	});
});
