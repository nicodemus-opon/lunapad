import type { ConnectionType } from '$lib/types/connection';

export interface SqlFunctionDoc {
	name: string;
	signature: string;
	doc: string;
}

// Functions available across (or close enough across) every supported
// connection — DuckDB, Postgres, ClickHouse (via Trino), MySQL (via Trino).
const COMMON: SqlFunctionDoc[] = [
	{ name: 'abs', signature: 'abs(x)', doc: 'Absolute value.' },
	{ name: 'avg', signature: 'avg(x)', doc: 'Average (mean) of a column.' },
	{ name: 'ceil', signature: 'ceil(x)', doc: 'Round up to the nearest integer.' },
	{ name: 'coalesce', signature: 'coalesce(a, b, ...)', doc: 'First non-null argument.' },
	{ name: 'concat', signature: 'concat(a, b, ...)', doc: 'Concatenate strings.' },
	{ name: 'count', signature: 'count(x)', doc: 'Number of (non-null) rows.' },
	{ name: 'current_date', signature: 'current_date', doc: "Today's date." },
	{ name: 'current_timestamp', signature: 'current_timestamp', doc: 'Current date and time.' },
	{ name: 'date_diff', signature: "date_diff(unit, start, end)", doc: 'Difference between two dates/timestamps in the given unit.' },
	{ name: 'date_trunc', signature: "date_trunc('unit', ts)", doc: 'Truncate a timestamp to the given precision (day, month, year, ...).' },
	{ name: 'extract', signature: 'extract(field from ts)', doc: 'Extract a field (year, month, day, ...) from a date/timestamp.' },
	{ name: 'floor', signature: 'floor(x)', doc: 'Round down to the nearest integer.' },
	{ name: 'greatest', signature: 'greatest(a, b, ...)', doc: 'Largest of the given values.' },
	{ name: 'least', signature: 'least(a, b, ...)', doc: 'Smallest of the given values.' },
	{ name: 'length', signature: 'length(s)', doc: 'Length of a string.' },
	{ name: 'like', signature: "s like 'pattern'", doc: 'Pattern match with `%`/`_` wildcards.' },
	{ name: 'ilike', signature: "s ilike 'pattern'", doc: 'Case-insensitive pattern match.' },
	{ name: 'lower', signature: 'lower(s)', doc: 'Convert to lowercase.' },
	{ name: 'upper', signature: 'upper(s)', doc: 'Convert to uppercase.' },
	{ name: 'ltrim', signature: 'ltrim(s)', doc: 'Remove leading whitespace.' },
	{ name: 'rtrim', signature: 'rtrim(s)', doc: 'Remove trailing whitespace.' },
	{ name: 'trim', signature: 'trim(s)', doc: 'Remove leading and trailing whitespace.' },
	{ name: 'max', signature: 'max(x)', doc: 'Maximum value of a column.' },
	{ name: 'min', signature: 'min(x)', doc: 'Minimum value of a column.' },
	{ name: 'sum', signature: 'sum(x)', doc: 'Sum of a column.' },
	{ name: 'now', signature: 'now()', doc: 'Current date and time.' },
	{ name: 'nullif', signature: 'nullif(a, b)', doc: 'Null if a equals b, otherwise a.' },
	{ name: 'replace', signature: "replace(s, from, to)", doc: 'Replace all occurrences of a substring.' },
	{ name: 'round', signature: 'round(x, n)', doc: 'Round to n decimal places.' },
	{ name: 'substr', signature: 'substr(s, start, len)', doc: 'Substring starting at a position.' },
	{ name: 'split_part', signature: "split_part(s, delim, n)", doc: 'Nth field of a delimited string.' },
	{ name: 'strpos', signature: 'strpos(s, sub)', doc: 'Position of a substring (1-based, 0 if not found).' },
	{ name: 'cast', signature: 'cast(x as type)', doc: 'Convert a value to another type, raising on failure.' },
	{ name: 'try_cast', signature: 'try_cast(x as type)', doc: 'Convert a value to another type, returning null on failure.' },
	{ name: 'exists', signature: 'exists (subquery)', doc: 'True if the subquery returns at least one row.' },
	{ name: 'row_number', signature: 'row_number() over (...)', doc: 'Sequential row number within the window.' },
	{ name: 'rank', signature: 'rank() over (...)', doc: 'Rank within the window, with gaps for ties.' },
	{ name: 'dense_rank', signature: 'dense_rank() over (...)', doc: 'Rank within the window, without gaps for ties.' },
	{ name: 'lead', signature: 'lead(x, n) over (...)', doc: 'Value of x, n rows ahead in the window.' },
	{ name: 'lag', signature: 'lag(x, n) over (...)', doc: 'Value of x, n rows behind in the window.' },
	{ name: 'first_value', signature: 'first_value(x) over (...)', doc: 'First value of x in the window.' },
	{ name: 'last_value', signature: 'last_value(x) over (...)', doc: 'Last value of x in the window.' },
	{ name: 'stddev', signature: 'stddev(x)', doc: 'Sample standard deviation of a column.' },
	{ name: 'variance', signature: 'variance(x)', doc: 'Sample variance of a column.' }
];

// DuckDB-specific (also the engine used for the built-in connection).
const DUCKDB: SqlFunctionDoc[] = [
	{ name: 'list_aggregate', signature: "list_aggregate(list, 'agg')", doc: 'Apply an aggregate function to a list value.' },
	{ name: 'list_value', signature: 'list_value(a, b, ...)', doc: 'Construct a list from values.' },
	{ name: 'struct_pack', signature: 'struct_pack(a := x, b := y)', doc: 'Construct a struct from named fields.' },
	{ name: 'unnest', signature: 'unnest(list)', doc: 'Expand a list into one row per element.' },
	{ name: 'read_csv', signature: "read_csv('path')", doc: 'Read a CSV file as a table.' },
	{ name: 'read_parquet', signature: "read_parquet('path')", doc: 'Read a Parquet file as a table.' },
	{ name: 'regexp_matches', signature: "regexp_matches(s, pattern)", doc: 'True if the string matches the regex.' },
	{ name: 'regexp_replace', signature: "regexp_replace(s, pattern, repl)", doc: 'Replace text matching a regex.' },
	{ name: 'epoch_ms', signature: 'epoch_ms(ts)', doc: 'Milliseconds since the epoch for a timestamp.' },
	{ name: 'strftime', signature: "strftime(ts, '%Y-%m-%d')", doc: 'Format a date/timestamp as a string.' },
	{ name: 'strptime', signature: "strptime(s, '%Y-%m-%d')", doc: 'Parse a string into a timestamp.' },
	{ name: 'median', signature: 'median(x)', doc: 'Median value of a column.' },
	{ name: 'mode', signature: 'mode(x)', doc: 'Most frequent value of a column.' }
];

// Postgres/ClickHouse/MySQL connections all execute as Trino SQL (sql.trino
// target) — Trino's own function set, NOT the native dialect's. Native
// functions like jsonb_extract_path, arrayJoin, or group_concat don't exist
// in Trino and would fail to compile against any of these connections.
const TRINO: SqlFunctionDoc[] = [
	{ name: 'json_extract', signature: 'json_extract(json, jsonPath)', doc: 'Extract a JSON value at the given JSONPath.' },
	{ name: 'json_query', signature: 'json_query(json, jsonPath)', doc: 'Extract a JSON value at the given JSONPath as JSON.' },
	{ name: 'json_value', signature: 'json_value(json, jsonPath)', doc: 'Extract a scalar value at the given JSONPath.' },
	{ name: 'approx_distinct', signature: 'approx_distinct(x)', doc: 'Approximate count of distinct values (HyperLogLog).' },
	{ name: 'approx_percentile', signature: 'approx_percentile(x, p)', doc: 'Approximate percentile of a column.' },
	{ name: 'array_agg', signature: 'array_agg(x)', doc: 'Collect values within a group into an array.' },
	{ name: 'array_join', signature: "array_join(arr, ', ')", doc: 'Concatenate array elements into a string, separated by a delimiter.' },
	{ name: 'sequence', signature: 'sequence(start, stop, step)', doc: 'Generate an array of numbers or dates.' },
	{ name: 'date_format', signature: "date_format(ts, '%Y-%m-%d')", doc: 'Format a timestamp using MySQL-style format specifiers.' },
	{ name: 'date_parse', signature: "date_parse(s, '%Y-%m-%d')", doc: 'Parse a string into a timestamp using MySQL-style format specifiers.' },
	{ name: 'from_unixtime', signature: 'from_unixtime(unixtime)', doc: 'Convert epoch seconds to a timestamp.' },
	{ name: 'to_unixtime', signature: 'to_unixtime(ts)', doc: 'Convert a timestamp to epoch seconds.' },
	{ name: 'width_bucket', signature: 'width_bucket(x, bins)', doc: 'Bucket index of x given an array of bin boundaries.' },
	{ name: 'regexp_like', signature: 'regexp_like(s, pattern)', doc: 'True if the string matches the regex.' }
];

const BY_CONNECTION: Record<ConnectionType, SqlFunctionDoc[]> = {
	'duckdb-wasm': DUCKDB,
	postgres: TRINO,
	clickhouse: TRINO,
	mysql: TRINO
};

const indexByDialect = new Map<ConnectionType, Map<string, SqlFunctionDoc>>();

function indexFor(dialect: ConnectionType): Map<string, SqlFunctionDoc> {
	let idx = indexByDialect.get(dialect);
	if (idx) return idx;
	idx = new Map();
	for (const fn of [...COMMON, ...BY_CONNECTION[dialect]]) idx.set(fn.name.toLowerCase(), fn);
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
