/** Collision-aware table qualification and alias generation. */

export interface ParsedRegistry {
	tables: Map<string, ColumnEntry[]>;
	bare: BareEntry[];
	/** leaf table name (lowercase) → all qualified registry keys */
	leafCollisions: Map<string, string[]>;
}

export interface ColumnEntry {
	name: string;
	detail?: string;
	description?: string;
}

export interface BareEntry {
	text: string;
	detail?: string;
	description?: string;
}

export function buildLeafCollisions(tables: Map<string, ColumnEntry[]>): Map<string, string[]> {
	const byLeaf = new Map<string, string[]>();
	for (const table of tables.keys()) {
		const leaf = table.split('.').pop()?.toLowerCase() ?? table.toLowerCase();
		const list = byLeaf.get(leaf) ?? [];
		list.push(table);
		byLeaf.set(leaf, list);
	}
	return byLeaf;
}

/** Pick insert text for a table: shortest unambiguous, or fully qualified on collision. */
export function qualifyTableName(fullName: string, leafCollisions: Map<string, string[]>): string {
	const leaf = fullName.split('.').pop()?.toLowerCase() ?? fullName.toLowerCase();
	const collisions = leafCollisions.get(leaf);
	if (!collisions || collisions.length <= 1) {
		// Prefer 2-part name when 3-part exists and is unambiguous
		const parts = fullName.split('.');
		if (parts.length === 3) return `${parts[1]}.${parts[2]}`;
		return fullName;
	}
	return fullName;
}

/** Schema/catalog detail for popup when name is ambiguous. */
export function tableQualificationDetail(fullName: string): string | undefined {
	const parts = fullName.split('.');
	if (parts.length >= 2) return parts.slice(0, -1).join('.');
	return undefined;
}

/** Generate a short alias from a table name (DataGrip-style). */
export function generateTableAlias(tableName: string): string {
	const leaf = tableName.split('.').pop() ?? tableName;
	const tokens = leaf
		.replace(/([a-z])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.split(/[_\-.]+/)
		.filter(Boolean);

	if (tokens.length >= 2) {
		return tokens.map((t) => t[0]).join('');
	}
	if (tokens.length === 1 && tokens[0]!.length > 3) {
		return tokens[0]!.slice(0, 3);
	}
	return tokens[0]?.slice(0, 1) ?? 't';
}

/** Ensure alias doesn't collide with existing aliases in scope. */
export function uniqueAlias(base: string, used: Set<string>): string {
	let alias = base;
	let i = 2;
	while (used.has(alias.toLowerCase())) {
		alias = base + i;
		i++;
	}
	return alias;
}
