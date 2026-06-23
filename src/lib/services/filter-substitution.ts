// Raw substitution, dbt/Jinja-style: the caller wraps ${param} in their own quotes in SQL
// when they need a string literal (e.g. region = '${region}'). Only escape embedded single
// quotes so a value like "O'Brien" doesn't break out of a quoted literal.
//
// Shared between the client (notebook.svelte.ts, substituting against the live notebook's
// filter values) and the server (the public report run endpoint, substituting against an
// anonymous viewer's locally-chosen filter values against a stored SQL template).

export function formatFilterValueForCode(value: string): string {
	return value.replace(/'/g, "''");
}

export function substituteFilterTokens(code: string, filters: Record<string, string>): string {
	let result = code;
	for (const [paramName, value] of Object.entries(filters)) {
		const token = `\${${paramName}}`;
		if (result.includes(token)) result = result.split(token).join(formatFilterValueForCode(value));
	}
	return result;
}
