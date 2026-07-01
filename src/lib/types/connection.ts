export type ConnectionType =
	| 'duckdb-wasm'
	| 'postgres'
	| 'clickhouse'
	| 'mysql'
	| 'mariadb'
	| 'sqlserver'
	| 'oracle'
	| 'redshift'
	| 'snowflake'
	| 'singlestore'
	| 'cassandra'
	| 'gsheets'
	| 'mongodb'
	| 'elasticsearch'
	| 'bigquery';

export type PRQLTarget = 'sql.duckdb' | 'sql.trino';

export const BUILTIN_DUCKDB_CONNECTION_ID = 'builtin.duckdb';

interface ConnectionBase {
	id: string;
	name: string;
	type: ConnectionType;
	builtin?: boolean;
}

export interface DuckDBWASMConnection extends ConnectionBase {
	type: 'duckdb-wasm';
	builtin: true;
}

export type PostgresSSLMode = 'disable' | 'require' | 'verify-full';

export interface PostgresConnection extends ConnectionBase {
	type: 'postgres';
	/** Trino catalog name for this source, e.g. "local_postgres". Used in SQL as catalogName.schema.table. */
	catalogName: string;
	host: string;
	port: number;
	database: string;
	username: string;
	ssl: boolean;
	/** If ssl is true, controls certificate verification. Defaults to 'require' (no cert check). */
	sslMode?: PostgresSSLMode;
}

export interface ClickHouseConnection extends ConnectionBase {
	type: 'clickhouse';
	/** Trino catalog name for this source, e.g. "analytics". Used in SQL as catalogName.schema.table. */
	catalogName: string;
	host: string;
	port: number;
	database: string;
	username: string;
	secure: boolean;
}

export interface MySQLDataSource extends ConnectionBase {
	type: 'mysql';
	/** Trino catalog name for this source, e.g. "prod_mysql". Used in SQL as catalogName.schema.table. */
	catalogName: string;
	host: string;
	port: number;
	database: string;
	username: string;
	ssl: boolean;
}

export interface MariaDBConnection extends ConnectionBase {
	type: 'mariadb';
	catalogName: string;
	host: string;
	port: number;
	database: string;
	username: string;
	ssl: boolean;
}

export interface RedshiftConnection extends ConnectionBase {
	type: 'redshift';
	catalogName: string;
	host: string;
	port: number;
	database: string;
	username: string;
	ssl: boolean;
}

export interface SingleStoreConnection extends ConnectionBase {
	type: 'singlestore';
	catalogName: string;
	host: string;
	port: number;
	database: string;
	username: string;
	ssl: boolean;
}

export interface MongoDBConnection extends ConnectionBase {
	type: 'mongodb';
	catalogName: string;
	host: string;
	port: number;
	database: string;
	username: string;
	ssl: boolean;
}

export interface ElasticsearchConnection extends ConnectionBase {
	type: 'elasticsearch';
	catalogName: string;
	host: string;
	port: number;
	/** Maps to elasticsearch.default-schema-name */
	database: string;
	/** Optional — only used if set (enables elasticsearch.security=PASSWORD) */
	username?: string;
}

export interface SQLServerConnection extends ConnectionBase {
	type: 'sqlserver';
	catalogName: string;
	host: string;
	port: number;
	database: string;
	username: string;
	encrypt: boolean;
	/** Only meaningful when encrypt is true. */
	trustServerCertificate: boolean;
}

export type OracleIdentifierType = 'sid' | 'service_name';

export interface OracleConnection extends ConnectionBase {
	type: 'oracle';
	catalogName: string;
	host: string;
	port: number;
	username: string;
	/** Whether `serviceName` holds a SID or a Service Name — the JDBC URL syntax differs. */
	identifierType: OracleIdentifierType;
	serviceName: string;
}

export interface SnowflakeConnection extends ConnectionBase {
	type: 'snowflake';
	catalogName: string;
	/** e.g. "xy12345.us-east-1" — no host/port for Snowflake. */
	account: string;
	warehouse: string;
	database: string;
	username: string;
	role?: string;
}

export interface CassandraConnection extends ConnectionBase {
	type: 'cassandra';
	catalogName: string;
	/** Comma-separated list of contact-point hosts, e.g. "10.0.0.1,10.0.0.2". */
	contactPoints: string;
	port: number;
	/** Required by Trino's cassandra.load-policy.dc-aware.local-dc. */
	localDatacenter: string;
	/** Present only when cassandra.security=PASSWORD auth is enabled. */
	username?: string;
}

export interface GoogleSheetsConnection extends ConnectionBase {
	type: 'gsheets';
	catalogName: string;
	metadataSheetId: string;
}

export interface BigQueryConnection extends ConnectionBase {
	type: 'bigquery';
	catalogName: string;
	/** The GCP project queried for data. */
	projectId: string;
	/** The project billed for the query, if different from projectId. */
	parentProjectId?: string;
}

export type Connection =
	| DuckDBWASMConnection
	| PostgresConnection
	| ClickHouseConnection
	| MySQLDataSource
	| MariaDBConnection
	| RedshiftConnection
	| SingleStoreConnection
	| MongoDBConnection
	| ElasticsearchConnection
	| SQLServerConnection
	| OracleConnection
	| SnowflakeConnection
	| CassandraConnection
	| GoogleSheetsConnection
	| BigQueryConnection;

export interface ConnectionSecret {
	password?: string;
	token?: string;
	/** Raw JSON text of a GCP service-account key — Google Sheets connections only. */
	credentialsJson?: string;
}

export type ConnectionSecrets = Record<string, ConnectionSecret>;

export const BUILTIN_DUCKDB_CONNECTION: DuckDBWASMConnection = {
	id: BUILTIN_DUCKDB_CONNECTION_ID,
	name: 'DuckDB (built-in)',
	type: 'duckdb-wasm',
	builtin: true
};

export function getPRQLTargetForConnection(connection: Connection | null | undefined): PRQLTarget {
	if (connection?.type === 'duckdb-wasm') return 'sql.duckdb';
	return 'sql.trino';
}

export function resolveConnection(
	connections: Connection[],
	connectionId: string | null | undefined
): Connection {
	if (!connectionId) return BUILTIN_DUCKDB_CONNECTION;
	return (
		connections.find((connection) => connection.id === connectionId) ?? BUILTIN_DUCKDB_CONNECTION
	);
}

export function isBuiltinDuckDBConnection(connection: Connection | null | undefined): boolean {
	return !connection || connection.type === 'duckdb-wasm';
}

/** Derive a valid Trino catalog name from a connection's display name. */
export function slugifyCatalogName(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^[^a-z]+/, '') // strip leading non-alpha
			.replace(/_+$/, '') || // strip trailing underscores
		'source'
	).slice(0, 64);
}
