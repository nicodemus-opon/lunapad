export type ConnectionType = 'duckdb-wasm' | 'postgres' | 'clickhouse' | 'mysql';

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

export type Connection = DuckDBWASMConnection | PostgresConnection | ClickHouseConnection | MySQLDataSource;

export interface ConnectionSecret {
	password?: string;
	token?: string;
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
	return connections.find((connection) => connection.id === connectionId) ?? BUILTIN_DUCKDB_CONNECTION;
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
			.replace(/^[^a-z]+/, '')  // strip leading non-alpha
			.replace(/_+$/, '')       // strip trailing underscores
		|| 'source'
	).slice(0, 64);
}
