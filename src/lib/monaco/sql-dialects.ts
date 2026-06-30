import type { ConnectionType } from '$lib/types/connection';
import trinoFunctions from '$lib/data/trino-functions.json';
import duckdbFunctions from '$lib/data/duckdb-functions.json';

export interface SqlFunctionDoc {
	name: string;
	signature: string;
	doc: string;
}

const BY_CONNECTION: Record<ConnectionType, SqlFunctionDoc[]> = {
	'duckdb-wasm': duckdbFunctions as SqlFunctionDoc[],
	postgres: trinoFunctions as SqlFunctionDoc[],
	clickhouse: trinoFunctions as SqlFunctionDoc[],
	mysql: trinoFunctions as SqlFunctionDoc[],
	mariadb: trinoFunctions as SqlFunctionDoc[],
	sqlserver: trinoFunctions as SqlFunctionDoc[],
	oracle: trinoFunctions as SqlFunctionDoc[],
	redshift: trinoFunctions as SqlFunctionDoc[],
	snowflake: trinoFunctions as SqlFunctionDoc[],
	singlestore: trinoFunctions as SqlFunctionDoc[],
	cassandra: trinoFunctions as SqlFunctionDoc[],
	gsheets: trinoFunctions as SqlFunctionDoc[],
	mongodb: trinoFunctions as SqlFunctionDoc[],
	elasticsearch: trinoFunctions as SqlFunctionDoc[],
	bigquery: trinoFunctions as SqlFunctionDoc[]
};

const indexByDialect = new Map<ConnectionType, Map<string, SqlFunctionDoc>>();

function indexFor(dialect: ConnectionType): Map<string, SqlFunctionDoc> {
	let idx = indexByDialect.get(dialect);
	if (idx) return idx;
	idx = new Map();
	for (const fn of BY_CONNECTION[dialect]) idx.set(fn.name.toLowerCase(), fn);
	indexByDialect.set(dialect, idx);
	return idx;
}

export function getSqlFunctionDocs(dialect: ConnectionType | undefined): SqlFunctionDoc[] {
	return Array.from(indexFor(dialect ?? 'duckdb-wasm').values());
}

export function getSqlFunctionDoc(
	name: string,
	dialect: ConnectionType | undefined
): SqlFunctionDoc | undefined {
	return indexFor(dialect ?? 'duckdb-wasm').get(name.toLowerCase());
}
