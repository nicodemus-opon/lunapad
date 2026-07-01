import type { ConnectionType } from '$lib/types/connection';
import trinoFunctions from '$lib/data/trino-functions.json';
import duckdbFunctions from '$lib/data/duckdb-functions.json';
import commonKeywords from '$lib/data/common-sql-keywords.json';
import duckdbKeywords from '$lib/data/duckdb-keywords.json';

export interface SqlFunctionDoc {
	name: string;
	signature: string;
	doc: string;
}

// External connections all execute through Trino — completions must reflect what
// Trino accepts, not native Postgres/ClickHouse/etc. builtins. Only DuckDB WASM
// runs locally and gets its own catalog.
const TRINO_EXTERNAL: ConnectionType[] = [
	'postgres',
	'clickhouse',
	'mysql',
	'mariadb',
	'sqlserver',
	'oracle',
	'redshift',
	'snowflake',
	'singlestore',
	'cassandra',
	'gsheets',
	'mongodb',
	'elasticsearch',
	'bigquery'
];

const BY_CONNECTION: Record<ConnectionType, SqlFunctionDoc[]> = {
	'duckdb-wasm': duckdbFunctions as SqlFunctionDoc[],
	...Object.fromEntries(TRINO_EXTERNAL.map((t) => [t, trinoFunctions as SqlFunctionDoc[]]))
} as Record<ConnectionType, SqlFunctionDoc[]>;

const KEYWORDS_BY_CONNECTION: Record<ConnectionType, string[]> = {
	'duckdb-wasm': [...commonKeywords, ...duckdbKeywords],
	...Object.fromEntries(TRINO_EXTERNAL.map((t) => [t, commonKeywords as string[]]))
} as Record<ConnectionType, string[]>;

const indexByDialect = new Map<ConnectionType, Map<string, SqlFunctionDoc>>();
const keywordSetByDialect = new Map<ConnectionType, Set<string>>();

function indexFor(dialect: ConnectionType): Map<string, SqlFunctionDoc> {
	let idx = indexByDialect.get(dialect);
	if (idx) return idx;
	idx = new Map();
	for (const fn of BY_CONNECTION[dialect]) idx.set(fn.name.toLowerCase(), fn);
	indexByDialect.set(dialect, idx);
	return idx;
}

function keywordsFor(dialect: ConnectionType): Set<string> {
	let set = keywordSetByDialect.get(dialect);
	if (set) return set;
	set = new Set(KEYWORDS_BY_CONNECTION[dialect].map((k) => k.toUpperCase()));
	keywordSetByDialect.set(dialect, set);
	return set;
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

export function getSqlKeywords(dialect: ConnectionType | undefined): string[] {
	const d = dialect ?? 'duckdb-wasm';
	return KEYWORDS_BY_CONNECTION[d];
}

export function isSqlKeyword(word: string, dialect: ConnectionType | undefined): boolean {
	return keywordsFor(dialect ?? 'duckdb-wasm').has(word.toUpperCase());
}
