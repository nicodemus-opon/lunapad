import { maskDollarQuotedBlocks } from '$lib/utils/sql-dollar-quote';

/**
 * Shared read-only SQL guard used by both the server connection layer and the
 * client-side AI data tools. Rejects multi-statement SQL and anything that isn't
 * a single read-only statement (SELECT / WITH / VALUES / EXPLAIN), so untrusted
 * SQL (LLM-authored `query_data`, external connection queries) can't run DDL/DML.
 *
 * Dollar-quoted blocks (e.g. Trino inline Python UDF bodies) are masked first so
 * only the surrounding SQL shell is validated, not literal text inside the body.
 */
const WRITE_KEYWORD_RE =
	/\b(insert|update|delete|drop|create|alter|truncate|replace|merge|grant|revoke|call|execute|exec|copy|vacuum|analyze|refresh|set\s+local|set\s+session|do\b)\b/i;

/** Returns an error message when the SQL is not a single read-only statement, else null. */
export function checkReadableSQL(sql: string): string | null {
	const normalized = maskDollarQuotedBlocks(sql.trim()).toLowerCase();
	if (!normalized) return 'SQL query is required.';
	if (normalized.includes(';')) return 'Only a single SQL statement is allowed.';
	if (
		!normalized.startsWith('select') &&
		!normalized.startsWith('with') &&
		!normalized.startsWith('values') &&
		!normalized.startsWith('explain')
	) {
		return 'Only read-only SQL statements are allowed.';
	}
	if (WRITE_KEYWORD_RE.test(normalized)) {
		return 'Only read-only SQL statements are allowed.';
	}
	return null;
}

export function assertReadableSQL(sql: string): void {
	const err = checkReadableSQL(sql);
	if (err) throw new Error(err);
}
