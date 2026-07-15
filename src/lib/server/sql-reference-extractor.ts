export interface SqlReferenceExtraction {
	tables: string[];
	ctes: string[];
}

const TABLE_FUNCTIONS = new Set([
	'unnest',
	'generate_series',
	'json_table',
	'table',
	'lateral',
	'values'
]);

const RESERVED = new Set([
	'select',
	'from',
	'join',
	'where',
	'group',
	'order',
	'by',
	'having',
	'limit',
	'offset',
	'union',
	'all',
	'with',
	'as',
	'on',
	'cross',
	'inner',
	'left',
	'right',
	'full',
	'outer',
	'lateral'
]);

function stripCommentsAndStrings(sql: string): string {
	return sql
		.replace(/--.*$/gm, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/'(?:''|[^'])*'/g, "''")
		.replace(/"(?:\\"|[^"])*"/g, (m) => m);
}

function normalizeIdent(ref: string): string {
	return ref
		.split('.')
		.map((part) => part.trim().replace(/^["`[]|["`\]]$/g, ''))
		.filter(Boolean)
		.join('.');
}

function baseName(ref: string): string {
	return normalizeIdent(ref).split('.').pop()?.toLowerCase() ?? '';
}

function collectCtes(sql: string): Set<string> {
	const ctes = new Set<string>();
	const withMatch = sql.match(/\bwith\b([\s\S]+?)\bselect\b/i);
	if (!withMatch) return ctes;
	for (const m of withMatch[1].matchAll(/(?:^|,)\s*(["`[]?[a-z_][\w$]*["`\]]?)\s+as\s*\(/gi)) {
		ctes.add(normalizeIdent(m[1]).toLowerCase());
	}
	return ctes;
}

export function tablesReferencedInSql(code: string): string[] {
	const stripped = stripCommentsAndStrings(code);
	const ctes = collectCtes(stripped);
	const refs = new Set<string>();
	const pattern =
		/\b(?:from|join|table)\s+(?!\()((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[a-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[a-z_][\w$]*)){0,2})/gi;

	for (const match of stripped.matchAll(pattern)) {
		const raw = match[1];
		const after = stripped.slice((match.index ?? 0) + match[0].length).trimStart();
		const ref = normalizeIdent(raw.replace(/\s*\.\s*/g, '.'));
		const leaf = baseName(ref);
		if (!ref || RESERVED.has(leaf) || TABLE_FUNCTIONS.has(leaf) || ctes.has(leaf)) continue;
		if (after.startsWith('(')) continue;
		refs.add(ref);
	}

	return [...refs];
}

export function extractSqlReferences(code: string): SqlReferenceExtraction {
	return {
		tables: tablesReferencedInSql(code),
		ctes: [...collectCtes(stripCommentsAndStrings(code))]
	};
}
