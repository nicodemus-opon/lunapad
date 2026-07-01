/** SQL clause detection for context-aware completion (multi-line lookback). */

export type SqlClauseContext =
	| 'from'
	| 'joinKeyword'
	| 'joinTable'
	| 'joinOn'
	| 'insertTable'
	| 'insertColumns'
	| 'updateSet'
	| 'selectList'
	| 'where'
	| 'groupBy'
	| 'orderBy'
	| 'having'
	| 'functionArg'
	| 'castTarget'
	| 'column'
	| 'general';

const LOOKBACK = 500;

/** Extract text before cursor from full SQL (multi-line). */
export function textBeforeCursor(sql: string, lineNumber: number, column: number): string {
	const lines = sql.split('\n');
	let offset = 0;
	for (let i = 0; i < lineNumber - 1; i++) offset += lines[i]!.length + 1;
	offset += column - 1;
	return sql.slice(Math.max(0, offset - LOOKBACK), offset);
}

/** Line-local text before the word being completed. */
export function lineBeforeWord(line: string, wordStartColumn: number): string {
	return line.slice(0, Math.max(0, wordStartColumn - 1));
}

export function detectSqlClauseContext(
	textBefore: string,
	lineBeforeWord?: string
): SqlClauseContext {
	const ctx = textBefore.replace(/\s+/g, ' ').trimEnd();
	// Keep trailing whitespace — `FROM ` / `SELECT ` at end-of-line is meaningful context.
	const line = lineBeforeWord ?? textBefore.split('\n').pop() ?? '';

	if (/\b(LEFT|RIGHT|INNER|FULL|CROSS|OUTER)?\s*JOIN\s*$/i.test(line)) return 'joinKeyword';
	if (/\b(LEFT|RIGHT|INNER|FULL|CROSS|OUTER)?\s*JOIN\s+[`"\w.]*$/i.test(line)) return 'joinTable';
	if (/\bON\s+[\w`".,=\s]*$/i.test(line) && /\bJOIN\b/i.test(ctx)) return 'joinOn';

	if (/\bINSERT\s+INTO\s+[`"\w.]+\s*$/i.test(line)) return 'insertTable';
	if (/\bINSERT\s+INTO\s+[`"\w.]+\s*\(\s*[\w`".,\s]*$/i.test(line)) return 'insertColumns';
	if (/\bUPDATE\s+[`"\w.]+\s+SET\s+[\w`".,=\s]*$/i.test(line)) return 'updateSet';

	if (/\bFROM\s+[`"\w.]*$/i.test(line)) return 'from';

	if (/\bSELECT\s+[\w`".,\s*]*$/i.test(line)) return 'selectList';
	if (/\bWHERE\s+[\w`".,\s]*$/i.test(line)) return 'where';
	if (/\bGROUP\s+BY\s+[\w`".,\s]*$/i.test(line)) return 'groupBy';
	if (/\bORDER\s+BY\s+[\w`".,\s]*$/i.test(line)) return 'orderBy';
	if (/\bHAVING\s+[\w`".,\s]*$/i.test(line)) return 'having';

	if (/\bSET\s+[\w`".,=\s]*$/i.test(line) && /\bUPDATE\b/i.test(ctx)) return 'updateSet';

	if (/\.cast\s*$/i.test(line)) return 'castTarget';

	if (/\([\w`".,\s]*$/i.test(line) && /\w\s*\($/.test(line.slice(-20))) return 'functionArg';

	if (
		/\b(SELECT|WHERE|HAVING|ON|GROUP\s+BY|ORDER\s+BY|AND|OR|NOT|SET|,)\s+[\w`".,\s*]*$/i.test(line)
	)
		return 'column';

	return 'general';
}

/** Whether this clause primarily expects column suggestions. */
export function isColumnClause(clause: SqlClauseContext): boolean {
	return (
		clause === 'column' ||
		clause === 'selectList' ||
		clause === 'where' ||
		clause === 'groupBy' ||
		clause === 'orderBy' ||
		clause === 'having' ||
		clause === 'joinOn' ||
		clause === 'updateSet' ||
		clause === 'insertColumns' ||
		clause === 'functionArg'
	);
}

/** Whether this clause primarily expects table/relation suggestions. */
export function isTableClause(clause: SqlClauseContext): boolean {
	return (
		clause === 'from' ||
		clause === 'joinTable' ||
		clause === 'insertTable' ||
		clause === 'joinKeyword'
	);
}
