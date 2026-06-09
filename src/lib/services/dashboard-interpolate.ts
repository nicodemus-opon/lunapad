/**
 * Resolves {queryName.columnName} and {queryName.columnName[N]} tokens
 * embedded in markdown text against a map of query results.
 * Returns the original token on miss so text doesn't break.
 */
export type QueryResults = Map<string, { columns: string[]; rows: Record<string, unknown>[] }>;

export function interpolate(text: string, results: QueryResults): string {
	return text.replace(/\{(\w+)\.(\w+)(?:\[(\d+)\])?\}/g, (_match, query, col, rowIdxStr) => {
		const result = results.get(query);
		if (!result) return _match;
		const rowIdx = rowIdxStr !== undefined ? parseInt(rowIdxStr, 10) : 0;
		const row = result.rows[rowIdx];
		if (!row) return _match;
		const val = row[col];
		return val !== null && val !== undefined ? String(val) : _match;
	});
}
