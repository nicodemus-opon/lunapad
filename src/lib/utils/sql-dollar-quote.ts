const DOLLAR_QUOTE_RE = /\$\$[\s\S]*?\$\$/g;

/**
 * Replaces each dollar-quoted block (`$$ ... $$`, used by Trino's inline Python
 * UDF bodies) with a same-length placeholder of underscores, so naive full-text
 * SQL validation (keyword blocklists, single-statement checks) can run on the
 * surrounding SQL shell without arbitrary Python source inside the block causing
 * false positives.
 *
 * An unbalanced/unterminated `$$` is intentionally left unmasked — Trino UDF
 * bodies can't themselves contain `$$`, so a real UDF block always closes, and
 * leaving an unterminated one unmasked means it safely still trips the
 * surrounding checks rather than being silently let through.
 */
export function maskDollarQuotedBlocks(sql: string): string {
	return sql.replace(
		DOLLAR_QUOTE_RE,
		(match) => '$' + '_'.repeat(Math.max(match.length - 2, 0)) + '$'
	);
}
