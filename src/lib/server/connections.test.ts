import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ConnectionSecret } from '$lib/types/connection';

const { fetchMock, mkdirMock, writeFileMock, unlinkMock } = vi.hoisted(() => ({
	fetchMock: vi.fn(),
	mkdirMock: vi.fn(),
	writeFileMock: vi.fn(),
	unlinkMock: vi.fn()
}));

vi.mock('node:fs/promises', () => ({
	default: { mkdir: mkdirMock, writeFile: writeFileMock, unlink: unlinkMock }
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
		JSON.stringify({
			id: 'q1',
			columns: columns.map((c) => ({ type: 'varchar', ...c })),
			data,
			stats: { state: 'FINISHED' }
		}),
		{ status: 200 }
	);
}

/** A bare successful Trino response for DDL statements (DROP/CREATE CATALOG) with no result rows. */
function trinoOK(): Response {
	return new Response(JSON.stringify({ id: 'q1', stats: { state: 'FINISHED' } }), { status: 200 });
}

/**
 * Registers a catalog (DROP CATALOG IF EXISTS, then CREATE CATALOG ... USING ... WITH (...))
 * and returns the CREATE CATALOG SQL text sent to Trino, for asserting on its WITH-clause properties.
 */
async function registerAndCapture(
	conn: Exclude<Connection, { type: 'duckdb-wasm' }>,
	secret: ConnectionSecret | undefined
): Promise<string> {
	fetchMock.mockResolvedValueOnce(trinoOK()); // DROP CATALOG IF EXISTS
	fetchMock.mockResolvedValueOnce(trinoOK()); // CREATE CATALOG ... USING ... WITH (...)
	await registerCatalog(conn, secret);
	const createCall = fetchMock.mock.calls.find((c) =>
		String(c[1]?.body ?? '').startsWith('CREATE CATALOG')
	);
	return createCall?.[1]?.body as string;
}

beforeEach(() => {
	fetchMock.mockReset();
	mkdirMock.mockReset().mockResolvedValue(undefined);
	writeFileMock.mockReset().mockResolvedValue(undefined);
	unlinkMock.mockReset().mockResolvedValue(undefined);
	process.env.TRINO_CATALOG_DIR = '/tmp/test-catalog';
});

describe('registerCatalog', () => {
	it('drops then creates the catalog via SQL', async () => {
		const content = await registerAndCapture(postgresConnection, { password: 'pw' });

		expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('DROP CATALOG IF EXISTS "primary_postgres"');
		expect(content).toContain('CREATE CATALOG "primary_postgres" USING postgresql WITH (');
		expect(content).toContain(`"connection-url" = 'jdbc:postgresql://localhost:5432/jobs'`);
		expect(content).toContain(`"connection-user" = 'postgres'`);
		expect(content).toContain(`"connection-password" = 'pw'`);
	});

	it('rejects invalid catalogName before issuing any SQL', async () => {
		const bad = { ...postgresConnection, catalogName: 'INVALID!' };
		await expect(registerCatalog(bad, {})).rejects.toThrow('Invalid source ID');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('writes correct JDBC URL for ClickHouse (no SSL)', async () => {
		const content = await registerAndCapture(clickHouseConnection, { password: 'secret' });
		expect(content).toContain('USING clickhouse');
		expect(content).toContain('jdbc:clickhouse://127.0.0.1:8123/analytics');
		expect(content).not.toContain('ssl');
		expect(content).toContain(`"connection-password" = 'secret'`);
	});

	it('adds sslmode=none for secure ClickHouse', async () => {
		const secureConn = { ...clickHouseConnection, secure: true };
		const content = await registerAndCapture(secureConn, { password: 'secret' });
		expect(content).toContain('jdbc:clickhouse://127.0.0.1:8123/analytics?ssl=true&sslmode=none');
	});

	it('uses sslMode=verify-full for Postgres when set', async () => {
		const verifyConn = { ...postgresConnection, ssl: true, sslMode: 'verify-full' as const };
		const content = await registerAndCapture(verifyConn, { password: 'pw' });
		expect(content).toContain('sslmode=verify-full');
		expect(content).not.toContain('sslmode=require');
	});

	it('doubles single quotes in the password as SQL string literal escaping', async () => {
		const content = await registerAndCapture(postgresConnection, { password: `p'word` });
		expect(content).toContain(`"connection-password" = 'p''word'`);
	});
});

describe('unregisterCatalog', () => {
	it('drops the catalog via SQL', async () => {
		fetchMock.mockResolvedValueOnce(trinoOK());
		await unregisterCatalog('primary_postgres');
		expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('DROP CATALOG IF EXISTS "primary_postgres"');
	});

	it('silently ignores a failed drop (e.g. catalog never existed)', async () => {
		fetchMock.mockRejectedValueOnce(new Error('boom'));
		await expect(unregisterCatalog('nonexistent')).resolves.toBeUndefined();
	});

	it('also deletes the Google Sheets and BigQuery credentials files', async () => {
		fetchMock.mockResolvedValueOnce(trinoOK());
		await unregisterCatalog('my_gsheets_source');
		expect(unlinkMock).toHaveBeenCalledWith(
			expect.stringContaining('secrets/my_gsheets_source-gsheets.json')
		);
		expect(unlinkMock).toHaveBeenCalledWith(
			expect.stringContaining('secrets/my_gsheets_source-bigquery.json')
		);
	});

	it('silently ignores ENOENT when deleting credential files', async () => {
		fetchMock.mockResolvedValueOnce(trinoOK());
		unlinkMock.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));
		await expect(unregisterCatalog('nonexistent')).resolves.toBeUndefined();
	});
});

describe('new connector catalog content', () => {
	it('writes MariaDB JDBC URL with SSL', async () => {
		const conn: Connection = {
			id: 'maria-1',
			name: 'MariaDB',
			type: 'mariadb',
			catalogName: 'maria_main',
			host: 'localhost',
			port: 3306,
			database: 'mydb',
			username: 'root',
			ssl: true
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('USING mariadb');
		expect(content).toContain(
			'jdbc:mariadb://localhost:3306/mydb?useSsl=true&trustServerCertificate=true'
		);
		expect(content).toContain(`"connection-password" = 'pw'`);
	});

	it('writes Redshift JDBC URL with semicolon-delimited SSL param', async () => {
		const conn: Connection = {
			id: 'rs-1',
			name: 'Redshift',
			type: 'redshift',
			catalogName: 'rs_main',
			host: 'redshift.example.com',
			port: 5439,
			database: 'dev',
			username: 'awsuser',
			ssl: true
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('USING redshift');
		expect(content).toContain('jdbc:redshift://redshift.example.com:5439/dev;SSL=TRUE;');
	});

	it('writes SingleStore JDBC URL with lowercase useSsl param', async () => {
		const conn: Connection = {
			id: 'ss-1',
			name: 'SingleStore',
			type: 'singlestore',
			catalogName: 'ss_main',
			host: 'localhost',
			port: 3306,
			database: 'mydb',
			username: 'root',
			ssl: true
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('USING singlestore');
		expect(content).toContain('jdbc:singlestore://localhost:3306/mydb?useSsl=true');
	});

	it('writes MongoDB connection-url with URI-encoded credentials', async () => {
		const conn: Connection = {
			id: 'mongo-1',
			name: 'Mongo',
			type: 'mongodb',
			catalogName: 'mongo_main',
			host: 'localhost',
			port: 27017,
			database: 'mydb',
			username: 'appuser',
			ssl: false
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('USING mongodb');
		expect(content).toContain(
			`"mongodb.connection-url" = 'mongodb://appuser:pw@localhost:27017/mydb'`
		);
	});

	it('URI-encodes special characters in MongoDB username/password', async () => {
		const conn: Connection = {
			id: 'mongo-2',
			name: 'Mongo',
			type: 'mongodb',
			catalogName: 'mongo_special',
			host: 'localhost',
			port: 27017,
			database: 'mydb',
			username: 'a@b',
			ssl: false
		};
		const content = await registerAndCapture(conn, { password: 'p/w' });
		expect(content).toContain(encodeURIComponent('a@b'));
		expect(content).toContain(encodeURIComponent('p/w'));
	});

	it('writes Elasticsearch host/port/schema and auth properties', async () => {
		const conn: Connection = {
			id: 'es-1',
			name: 'ES',
			type: 'elasticsearch',
			catalogName: 'es_main',
			host: 'es.example.com',
			port: 9200,
			database: 'default',
			username: 'elastic'
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('USING elasticsearch');
		expect(content).toContain(`"elasticsearch.host" = 'es.example.com'`);
		expect(content).toContain(`"elasticsearch.port" = '9200'`);
		expect(content).toContain(`"elasticsearch.default-schema-name" = 'default'`);
		expect(content).toContain(`"elasticsearch.security" = 'PASSWORD'`);
		expect(content).toContain(`"elasticsearch.auth.user" = 'elastic'`);
		expect(content).toContain(`"elasticsearch.auth.password" = 'pw'`);
	});

	it('omits Elasticsearch auth properties when no username is set', async () => {
		const conn: Connection = {
			id: 'es-2',
			name: 'ES',
			type: 'elasticsearch',
			catalogName: 'es_noauth',
			host: 'es.example.com',
			port: 9200,
			database: 'default'
		};
		const content = await registerAndCapture(conn, undefined);
		expect(content).not.toContain('elasticsearch.security');
		expect(content).not.toContain('elasticsearch.auth');
	});

	it('writes SQL Server semicolon-delimited URL with encrypt=true', async () => {
		const conn: Connection = {
			id: 'mssql-1',
			name: 'SQL Server',
			type: 'sqlserver',
			catalogName: 'mssql_main',
			host: 'sql.example.com',
			port: 1433,
			database: 'master',
			username: 'sa',
			encrypt: true,
			trustServerCertificate: true
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('USING sqlserver');
		expect(content).toContain(
			'jdbc:sqlserver://sql.example.com:1433;databaseName=master;encrypt=true;trustServerCertificate=true'
		);
	});

	it('writes SQL Server URL with encrypt=false', async () => {
		const conn: Connection = {
			id: 'mssql-2',
			name: 'SQL Server',
			type: 'sqlserver',
			catalogName: 'mssql_noenc',
			host: 'sql.example.com',
			port: 1433,
			database: 'master',
			username: 'sa',
			encrypt: false,
			trustServerCertificate: false
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('encrypt=false;trustServerCertificate=false');
	});

	it('writes Oracle Service Name URL (double-slash syntax)', async () => {
		const conn: Connection = {
			id: 'ora-1',
			name: 'Oracle',
			type: 'oracle',
			catalogName: 'ora_main',
			host: 'ora.example.com',
			port: 1521,
			username: 'system',
			identifierType: 'service_name',
			serviceName: 'ORCLPDB1'
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('USING oracle');
		expect(content).toContain('jdbc:oracle:thin:@//ora.example.com:1521/ORCLPDB1');
	});

	it('writes Oracle SID URL (colon syntax)', async () => {
		const conn: Connection = {
			id: 'ora-2',
			name: 'Oracle',
			type: 'oracle',
			catalogName: 'ora_sid',
			host: 'ora.example.com',
			port: 1521,
			username: 'system',
			identifierType: 'sid',
			serviceName: 'ORCL'
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('jdbc:oracle:thin:@ora.example.com:1521:ORCL');
	});

	it('writes Snowflake properties with account/warehouse/database as separate keys, with role', async () => {
		const conn: Connection = {
			id: 'sf-1',
			name: 'Snowflake',
			type: 'snowflake',
			catalogName: 'sf_main',
			account: 'xy12345.us-east-1',
			warehouse: 'COMPUTE_WH',
			database: 'MYDB',
			username: 'svc_user',
			role: 'ANALYST'
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain('USING snowflake');
		expect(content).toContain('jdbc:snowflake://xy12345.us-east-1.snowflakecomputing.com');
		expect(content).not.toContain('?warehouse'); // not a URL param
		expect(content).toContain(`"snowflake.account" = 'xy12345.us-east-1'`);
		expect(content).toContain(`"snowflake.database" = 'MYDB'`);
		expect(content).toContain(`"snowflake.warehouse" = 'COMPUTE_WH'`);
		expect(content).toContain(`"snowflake.role" = 'ANALYST'`);
	});

	it('omits Snowflake role property when not set', async () => {
		const conn: Connection = {
			id: 'sf-2',
			name: 'Snowflake',
			type: 'snowflake',
			catalogName: 'sf_norole',
			account: 'xy12345.us-east-1',
			warehouse: 'COMPUTE_WH',
			database: 'MYDB',
			username: 'svc_user'
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).not.toContain('snowflake.role');
	});

	it('writes Cassandra contact-points and required local-dc, no auth when no username', async () => {
		const conn: Connection = {
			id: 'cass-1',
			name: 'Cassandra',
			type: 'cassandra',
			catalogName: 'cass_main',
			contactPoints: '10.0.0.1,10.0.0.2',
			port: 9042,
			localDatacenter: 'datacenter1'
		};
		const content = await registerAndCapture(conn, undefined);
		expect(content).toContain('USING cassandra');
		expect(content).toContain(`"cassandra.contact-points" = '10.0.0.1,10.0.0.2'`);
		expect(content).toContain(`"cassandra.native-protocol-port" = '9042'`);
		expect(content).toContain(`"cassandra.load-policy.dc-aware.local-dc" = 'datacenter1'`);
		expect(content).not.toContain('cassandra.security');
	});

	it('adds Cassandra PASSWORD auth when username is set', async () => {
		const conn: Connection = {
			id: 'cass-2',
			name: 'Cassandra',
			type: 'cassandra',
			catalogName: 'cass_auth',
			contactPoints: '10.0.0.1',
			port: 9042,
			localDatacenter: 'datacenter1',
			username: 'cassandra_user'
		};
		const content = await registerAndCapture(conn, { password: 'pw' });
		expect(content).toContain(`"cassandra.security" = 'PASSWORD'`);
		expect(content).toContain(`"cassandra.username" = 'cassandra_user'`);
		expect(content).toContain(`"cassandra.password" = 'pw'`);
	});

	it('writes Google Sheets credentials file and references its path in the catalog properties', async () => {
		const conn: Connection = {
			id: 'gs-1',
			name: 'Sheets',
			type: 'gsheets',
			catalogName: 'my_gsheets_source',
			metadataSheetId: 'sheet123'
		};
		const content = await registerAndCapture(conn, {
			credentialsJson: '{"type":"service_account"}'
		});

		const credsCall = writeFileMock.mock.calls.find((c) => String(c[0]).includes('-gsheets.json'));
		expect(credsCall?.[1]).toBe('{"type":"service_account"}');
		expect(credsCall?.[2]).toMatchObject({ mode: 0o600 });

		expect(content).toContain('USING gsheets');
		expect(content).toContain(`"gsheets.metadata-sheet-id" = 'sheet123'`);
		expect(content).toContain('gsheets.credentials-path');
		expect(content).toContain('my_gsheets_source-gsheets.json');
	});

	it('rejects Google Sheets registration without credentialsJson', async () => {
		const conn: Connection = {
			id: 'gs-2',
			name: 'Sheets',
			type: 'gsheets',
			catalogName: 'gs_missing_creds',
			metadataSheetId: 'sheet123'
		};
		await expect(registerCatalog(conn, undefined)).rejects.toThrow(
			'requires a service-account credentials JSON'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects Google Sheets registration with invalid JSON', async () => {
		const conn: Connection = {
			id: 'gs-3',
			name: 'Sheets',
			type: 'gsheets',
			catalogName: 'gs_bad_json',
			metadataSheetId: 'sheet123'
		};
		await expect(registerCatalog(conn, { credentialsJson: 'not json' })).rejects.toThrow(
			'must be valid JSON'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('writes BigQuery credentials file and references it via bigquery.credentials-file', async () => {
		const conn: Connection = {
			id: 'bq-1',
			name: 'BigQuery',
			type: 'bigquery',
			catalogName: 'my_bigquery_source',
			projectId: 'my-gcp-project',
			parentProjectId: 'billing-project'
		};
		const content = await registerAndCapture(conn, {
			credentialsJson: '{"type":"service_account"}'
		});

		const credsCall = writeFileMock.mock.calls.find((c) => String(c[0]).includes('-bigquery.json'));
		expect(credsCall?.[1]).toBe('{"type":"service_account"}');
		expect(credsCall?.[2]).toMatchObject({ mode: 0o600 });

		expect(content).toContain('USING bigquery');
		expect(content).toContain(`"bigquery.project-id" = 'my-gcp-project'`);
		expect(content).toContain(`"bigquery.parent-project-id" = 'billing-project'`);
		expect(content).toContain('bigquery.credentials-file');
		expect(content).toContain('my_bigquery_source-bigquery.json');
	});

	it('omits bigquery.parent-project-id when not set', async () => {
		const conn: Connection = {
			id: 'bq-2',
			name: 'BigQuery',
			type: 'bigquery',
			catalogName: 'bq_noparent',
			projectId: 'my-gcp-project'
		};
		const content = await registerAndCapture(conn, {
			credentialsJson: '{"type":"service_account"}'
		});
		expect(content).not.toContain('bigquery.parent-project-id');
	});

	it('rejects BigQuery registration without credentialsJson', async () => {
		const conn: Connection = {
			id: 'bq-3',
			name: 'BigQuery',
			type: 'bigquery',
			catalogName: 'bq_missing_creds',
			projectId: 'my-gcp-project'
		};
		await expect(registerCatalog(conn, undefined)).rejects.toThrow(
			'requires a service-account credentials JSON'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects BigQuery registration with invalid JSON', async () => {
		const conn: Connection = {
			id: 'bq-4',
			name: 'BigQuery',
			type: 'bigquery',
			catalogName: 'bq_bad_json',
			projectId: 'my-gcp-project'
		};
		await expect(registerCatalog(conn, { credentialsJson: 'not json' })).rejects.toThrow(
			'must be valid JSON'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('testExternalConnection', () => {
	it('succeeds when probe returns rows', async () => {
		fetchMock
			.mockResolvedValueOnce(trinoOK()) // DROP CATALOG IF EXISTS
			.mockResolvedValueOnce(trinoOK()) // CREATE CATALOG ...
			.mockResolvedValueOnce(trinoPage([{ name: '1' }], [[1]])); // probe

		await expect(testExternalConnection(postgresConnection, { password: 'pw' })).resolves.toEqual({
			ok: true
		});

		const probeBody = fetchMock.mock.calls[2]?.[1]?.body as string;
		expect(probeBody).toContain('information_schema.schemata');
	});

	it('throws when probe returns 0 rows (database unreachable)', async () => {
		fetchMock
			.mockResolvedValueOnce(trinoOK())
			.mockResolvedValueOnce(trinoOK())
			// Trino returns empty result when it can't reach the underlying DB
			.mockResolvedValueOnce(trinoPage([{ name: '1' }], []));

		await expect(testExternalConnection(postgresConnection, { password: 'pw' })).rejects.toThrow(
			'got no response from the postgres database'
		);
	});
});

describe('queryExternalConnection', () => {
	it('routes read-only SQL through Trino with catalog/schema headers', async () => {
		fetchMock.mockResolvedValueOnce(
			trinoPage([{ name: 'id' }, { name: 'title' }], [[1, 'Engineer']])
		);

		const result = await queryExternalConnection(
			postgresConnection,
			undefined,
			'SELECT id, title FROM jobs'
		);

		expect(result.columns).toEqual(['id', 'title']);
		expect(result.rows).toEqual([{ id: 1, title: 'Engineer' }]);
		const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
		expect(headers?.['X-Trino-Catalog']).toBe('primary_postgres');
		expect(headers?.['X-Trino-Schema']).toBe('public');
	});

	it('auto-registers on catalog-not-found then retries', async () => {
		fetchMock
			// First query fails: catalog not found
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 'q1',
						error: { message: "Catalog 'primary_postgres' does not exist" },
						stats: { state: 'FAILED' }
					}),
					{ status: 200 }
				)
			)
			// Re-register: DROP then CREATE
			.mockResolvedValueOnce(trinoOK())
			.mockResolvedValueOnce(trinoOK())
			// Retry query succeeds
			.mockResolvedValueOnce(trinoPage([{ name: 'id' }], [[1]]));

		const result = await queryExternalConnection(
			postgresConnection,
			{ password: 'pw' },
			'SELECT id FROM t'
		);
		expect(result.rows).toEqual([{ id: 1 }]);
	});

	it('handles paginated responses', async () => {
		fetchMock
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 'q1',
						columns: [{ name: 'id' }],
						data: [[1]],
						nextUri: 'http://trino:8080/v1/statement/executing/q1?token=1'
					}),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: 'q1', data: [[2], [3]], stats: { state: 'FINISHED' } }), {
					status: 200
				})
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
				[
					{ name: 'table_schem' },
					{ name: 'table_name' },
					{ name: 'column_name' },
					{ name: 'type_name' }
				],
				[
					['public', 'jobs', 'id', 'integer'],
					['public', 'jobs', 'title', 'varchar']
				]
			)
		);

		const result = await fetchExternalConnectionSchema(postgresConnection);
		expect(result.tables).toHaveLength(1);
		expect(result.tables[0]).toEqual({
			name: 'jobs',
			schema: 'public',
			columns: ['id', 'title'],
			columnTypes: ['integer', 'varchar']
		});

		const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
		expect(headers?.['X-Trino-Catalog']).toBe('primary_postgres');
		const body = fetchMock.mock.calls[0]?.[1]?.body as string;
		expect(body).toContain('"primary_postgres".information_schema.columns');
	});

	it('merges table and column comments fetched via the system.query passthrough (Postgres)', async () => {
		fetchMock
			.mockResolvedValueOnce(
				trinoPage(
					[
						{ name: 'table_schem' },
						{ name: 'table_name' },
						{ name: 'column_name' },
						{ name: 'type_name' }
					],
					[
						['public', 'jobs', 'id', 'integer'],
						['public', 'jobs', 'title', 'varchar']
					]
				)
			)
			.mockResolvedValueOnce(
				trinoPage(
					[
						{ name: 'table_schem' },
						{ name: 'table_name' },
						{ name: 'column_name' },
						{ name: 'comment' }
					],
					[
						['public', 'jobs', null, 'Job postings'],
						['public', 'jobs', 'title', 'The job title']
					]
				)
			);

		const result = await fetchExternalConnectionSchema(postgresConnection);
		expect(result.tables).toHaveLength(1);
		expect(result.tables[0].description).toBe('Job postings');
		expect(result.tables[0].columnDescriptions).toEqual([undefined, 'The job title']);

		const commentQueryBody = fetchMock.mock.calls[1]?.[1]?.body as string;
		expect(commentQueryBody).toContain('system.query');
	});

	it('merges table and column comments fetched via the system.query passthrough (ClickHouse)', async () => {
		fetchMock
			.mockResolvedValueOnce(
				trinoPage(
					[
						{ name: 'table_schem' },
						{ name: 'table_name' },
						{ name: 'column_name' },
						{ name: 'type_name' }
					],
					[['analytics', 'events', 'id', 'UInt64']]
				)
			)
			.mockResolvedValueOnce(
				trinoPage(
					[
						{ name: 'table_schem' },
						{ name: 'table_name' },
						{ name: 'column_name' },
						{ name: 'comment' }
					],
					[['analytics', 'events', 'id', 'Primary key']]
				)
			);

		const result = await fetchExternalConnectionSchema(clickHouseConnection);
		expect(result.tables[0].columnDescriptions).toEqual(['Primary key']);
	});

	it('returns plain schema (no descriptions) when the comment passthrough query fails', async () => {
		fetchMock
			.mockResolvedValueOnce(
				trinoPage(
					[
						{ name: 'table_schem' },
						{ name: 'table_name' },
						{ name: 'column_name' },
						{ name: 'type_name' }
					],
					[['public', 'jobs', 'id', 'integer']]
				)
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 'q2',
						error: { message: 'system.query not supported' },
						stats: { state: 'FAILED' }
					}),
					{ status: 200 }
				)
			);

		const result = await fetchExternalConnectionSchema(postgresConnection);
		expect(result.tables).toHaveLength(1);
		expect(result.tables[0]).toEqual({
			name: 'jobs',
			schema: 'public',
			columns: ['id'],
			columnTypes: ['integer']
		});
	});

	it('auto-registers on catalog-not-found then retries', async () => {
		fetchMock
			// First schema query fails: catalog not found
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 'q1',
						error: { message: "Catalog 'primary_postgres' does not exist" },
						stats: { state: 'FAILED' }
					}),
					{ status: 200 }
				)
			)
			// Re-register: DROP then CREATE
			.mockResolvedValueOnce(trinoOK())
			.mockResolvedValueOnce(trinoOK())
			// Retry returns columns
			.mockResolvedValueOnce(
				trinoPage(
					[
						{ name: 'table_schem' },
						{ name: 'table_name' },
						{ name: 'column_name' },
						{ name: 'type_name' }
					],
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
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: 'ddl', stats: { state: 'FINISHED' } }), { status: 200 })
			);

		const result = await materializeExternalConnection(
			postgresConnection,
			undefined,
			'mart',
			undefined,
			'SELECT 1',
			'view'
		);
		expect(result.type).toBe('view');
		expect(fetchMock.mock.calls[1]?.[1]?.body).toContain(
			'CREATE OR REPLACE VIEW "primary_postgres"."public"."mart"'
		);
	});
});
