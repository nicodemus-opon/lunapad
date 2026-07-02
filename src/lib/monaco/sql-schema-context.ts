/** Shared SQL identifier parsing + schema lookup for Monaco hover/completions. */

export interface SchemaColumn {
	name: string;
	detail?: string;
	description?: string;
}

const IDENT_PART = '(?:`[^`]*`|"[^"]*"|[A-Za-z_][\\w]*)';
const QUALIFIED_IDENT_RE = new RegExp(`(${IDENT_PART}(?:\\.${IDENT_PART})*)$`);
const DOT_CONTEXT_RE = new RegExp(`(${IDENT_PART}(?:\\.${IDENT_PART})*)\\.$`);

export function unquoteSqlIdent(part: string): string {
	if (part.startsWith('`') && part.endsWith('`')) return part.slice(1, -1);
	if (part.startsWith('"') && part.endsWith('"')) return part.slice(1, -1);
	return part;
}

export function parseSqlIdentParts(raw: string): string[] {
	return raw.split('.').map(unquoteSqlIdent);
}

/** Qualified identifier ending at `column` (1-based Monaco column). */
export function sqlIdentBeforeCursor(
	line: string,
	column: number
): { text: string; startColumn: number; parts: string[] } | null {
	const before = line.slice(0, Math.max(0, column - 1));
	const m = before.match(QUALIFIED_IDENT_RE);
	if (!m) return null;
	const raw = m[1];
	const parts = parseSqlIdentParts(raw);
	return { text: parts.join('.'), startColumn: column - raw.length, parts };
}

/** Table qualifier immediately before a trailing dot, e.g. `schema.table.|` */
export function sqlTableBeforeDot(lineBeforeCursor: string): string | null {
	const m = lineBeforeCursor.match(DOT_CONTEXT_RE);
	if (!m) return null;
	return parseSqlIdentParts(m[1]).join('.');
}

export function splitRegistryEntry(text: string): { table: string; column: string } | null {
	const dot = text.lastIndexOf('.');
	if (dot <= 0 || dot >= text.length - 1) return null;
	return { table: text.slice(0, dot), column: text.slice(dot + 1) };
}

export function lookupTable(
	tables: Map<string, SchemaColumn[]>,
	name: string
): SchemaColumn[] | undefined {
	const direct = tables.get(name);
	if (direct) return direct;

	const lower = name.toLowerCase();
	for (const [key, cols] of tables) {
		if (key.toLowerCase() === lower) return cols;
	}

	// `mm_raw.mpesa_raw` → registry key `catalog.mm_raw.mpesa_raw`
	for (const [key, cols] of tables) {
		const keyLower = key.toLowerCase();
		if (keyLower.endsWith('.' + lower)) return cols;
	}

	// Unqualified leaf: `mpesa_raw` → `catalog.mm_raw.mpesa_raw`
	for (const [key, cols] of tables) {
		const leaf = key.split('.').pop();
		if (leaf?.toLowerCase() === lower) return cols;
	}
	return undefined;
}

export function lookupColumn(
	tables: Map<string, SchemaColumn[]>,
	tableRef: string,
	column: string
): SchemaColumn | undefined {
	const cols = lookupTable(tables, tableRef);
	if (!cols) return undefined;
	const lower = column.toLowerCase();
	return cols.find((c) => c.name.toLowerCase() === lower);
}

export function formatTableHover(name: string, cols: SchemaColumn[]): string {
	const body = cols.map((c) => `- \`${c.name}\`` + (c.detail ? ` *${c.detail}*` : '')).join('\n');
	return `**${name}**\n\n${body}`;
}
