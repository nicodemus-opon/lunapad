/** FK index + heuristic relationship inference for JOIN completion. */

import type { ExternalSchemaTable } from '$lib/stores/notebook.svelte';
import type { SqlScope } from './sql-scope';
import {
	generateTableAlias,
	qualifyTableName,
	type ColumnEntry,
	uniqueAlias
} from './sql-qualify';

export interface SchemaForeignKey {
	column: string;
	referencedTable: string;
	referencedColumn: string;
	source: 'catalog' | 'heuristic';
}

export interface JoinSuggestion {
	label: string;
	insertText: string;
	detail: string;
	score: number;
	targetTable: string;
}

export interface RelationshipIndex {
	/** sourceTable → FK list */
	byTable: Map<string, SchemaForeignKey[]>;
	/** all table keys in schema */
	allTables: Set<string>;
}

function tableKey(schema: string | undefined, name: string): string {
	return schema ? `${schema}.${name}` : name;
}

function resolveTableKey(index: RelationshipIndex, ref: string): string | null {
	const lower = ref.toLowerCase();
	for (const t of index.allTables) {
		if (t.toLowerCase() === lower) return t;
		const leaf = t.split('.').pop()?.toLowerCase();
		if (leaf === lower) return t;
		if (t.toLowerCase().endsWith('.' + lower)) return t;
	}
	return null;
}

function pluralizeStem(stem: string): string[] {
	const s = stem.toLowerCase();
	const candidates = [s, s + 's', s + 'es'];
	if (s.endsWith('y')) candidates.push(s.slice(0, -1) + 'ies');
	if (s.endsWith('s')) candidates.push(s + 'es');
	return candidates;
}

function inferHeuristicFks(
	tableKeyStr: string,
	columns: string[],
	index: RelationshipIndex
): SchemaForeignKey[] {
	const fks: SchemaForeignKey[] = [];
	for (const col of columns) {
		const lower = col.toLowerCase();
		let stem: string | null = null;
		if (lower.endsWith('_id') && lower !== 'id') {
			stem = lower.slice(0, -3);
		} else if (lower.endsWith('id') && lower !== 'id' && lower.length > 2) {
			stem = lower.slice(0, -2);
		}
		if (!stem) continue;

		for (const candidate of pluralizeStem(stem)) {
			const target = resolveTableKey(index, candidate);
			if (!target || target === tableKeyStr) continue;
			const targetCols = index.byTable.get(target);
			const refCol =
				targetCols?.find((fk) => fk.column.toLowerCase() === 'id')?.column ??
				(index.byTable.has(target) ? 'id' : 'id');
			fks.push({
				column: col,
				referencedTable: target,
				referencedColumn: refCol,
				source: 'heuristic'
			});
			break;
		}
	}
	return fks;
}

export function buildRelationshipIndex(tables: ExternalSchemaTable[]): RelationshipIndex {
	const byTable = new Map<string, SchemaForeignKey[]>();
	const allTables = new Set<string>();

	for (const t of tables) {
		const key = t.schema ? `${t.schema}.${t.name}` : t.name;
		allTables.add(key);
		if (t.foreignKeys?.length) {
			byTable.set(key, [...t.foreignKeys]);
		}
	}

	// Pass 2: heuristic fallback where no catalog FKs
	for (const t of tables) {
		const key = t.schema ? `${t.schema}.${t.name}` : t.name;
		if (byTable.has(key) && byTable.get(key)!.length > 0) continue;
		const heuristic = inferHeuristicFks(key, t.columns, { byTable, allTables });
		if (heuristic.length > 0) {
			byTable.set(key, heuristic);
		}
	}

	return { byTable, allTables };
}

export function buildRelationshipIndexFromRegistry(
	tables: Map<string, ColumnEntry[]>,
	foreignKeysByTable?: Map<string, SchemaForeignKey[]>
): RelationshipIndex {
	const byTable = new Map<string, SchemaForeignKey[]>();
	const allTables = new Set<string>(tables.keys());

	if (foreignKeysByTable) {
		for (const [k, fks] of foreignKeysByTable) {
			byTable.set(k, fks);
		}
	}

	for (const [tableKeyStr, cols] of tables) {
		if (byTable.has(tableKeyStr) && byTable.get(tableKeyStr)!.length > 0) continue;
		const heuristic = inferHeuristicFks(
			tableKeyStr,
			cols.map((c) => c.name),
			{ byTable, allTables }
		);
		if (heuristic.length > 0) byTable.set(tableKeyStr, heuristic);
	}

	return { byTable, allTables };
}

function getScopeAlias(scope: SqlScope | null, tableKeyStr: string): string | undefined {
	if (!scope) return undefined;
	for (const source of scope.sources) {
		if (
			source.name.toLowerCase() === tableKeyStr.toLowerCase() ||
			source.name.split('.').pop()?.toLowerCase() === tableKeyStr.split('.').pop()?.toLowerCase()
		) {
			return source.alias ?? source.name.split('.').pop();
		}
	}
	return undefined;
}

function usedAliases(scope: SqlScope | null): Set<string> {
	const used = new Set<string>();
	if (!scope) return used;
	for (const source of scope.sources) {
		if (source.alias) used.add(source.alias.toLowerCase());
	}
	return used;
}

/** JOIN table suggestions with ON clause snippets. */
export function suggestJoinCompletions(
	scope: SqlScope | null,
	relationshipIndex: RelationshipIndex,
	leafCollisions: Map<string, string[]>,
	prefix: string,
	matchFn: (label: string, prefix: string) => boolean
): JoinSuggestion[] {
	const suggestions: JoinSuggestion[] = [];
	const used = usedAliases(scope);
	const seen = new Set<string>();

	if (!scope?.sources.length) return suggestions;

	for (const source of scope.sources) {
		const sourceKey = source.name;
		const sourceAlias = source.alias ?? source.name.split('.').pop() ?? source.name;
		const fks = relationshipIndex.byTable.get(sourceKey) ?? [];

		for (const fk of fks) {
			const targetKey = resolveTableKey(relationshipIndex, fk.referencedTable) ?? fk.referencedTable;
			if (scope.sources.some((s) => s.name.toLowerCase() === targetKey.toLowerCase())) continue;

			const insertName = qualifyTableName(targetKey, leafCollisions);
			if (!matchFn(insertName, prefix) && !matchFn(targetKey.split('.').pop() ?? '', prefix)) continue;

			const alias = uniqueAlias(generateTableAlias(targetKey), used);
			used.add(alias.toLowerCase());

			const label = `${insertName} (via ${fk.column})`;
			if (seen.has(label)) continue;
			seen.add(label);

			const insertText = `${insertName} ${alias} ON ${sourceAlias}.${fk.column} = ${alias}.${fk.referencedColumn}`;
			suggestions.push({
				label,
				insertText,
				detail: fk.source === 'catalog' ? 'FK join' : 'name-matched join',
				score: fk.source === 'catalog' ? 140 : 100,
				targetTable: targetKey
			});
		}
	}

	return suggestions.sort((a, b) => b.score - a.score);
}

/** INSERT column list snippet. */
export function buildInsertSnippet(
	tableName: string,
	columns: ColumnEntry[],
	qualifyFn: (name: string) => string
): string {
	const insertName = qualifyFn(tableName);
	const writableCols = columns.filter((c) => {
		const lower = c.name.toLowerCase();
		return lower !== 'id' && !lower.endsWith('_serial');
	});
	const cols = writableCols.length > 0 ? writableCols : columns;
	const colList = cols.map((c) => c.name).join(', ');
	const placeholders = cols.map((_, i) => `\${${i + 1}:value}`).join(', ');
	return `(${colList}) VALUES (${placeholders})`;
}

/** UPDATE SET column snippet. */
export function buildUpdateSetSnippet(columns: ColumnEntry[]): string {
	if (columns.length === 0) return '';
	const first = columns[0]!;
	return `${first.name} = \${1:value}`;
}

/** JOIN ON column pair suggestions. */
export function suggestJoinOnPairs(
	scope: SqlScope | null,
	relationshipIndex: RelationshipIndex
): Array<{ label: string; insertText: string; score: number }> {
	const pairs: Array<{ label: string; insertText: string; score: number }> = [];
	if (!scope || scope.sources.length < 2) return pairs;

	const left = scope.sources[0]!;
	const right = scope.sources[1]!;
	const leftAlias = left.alias ?? left.name.split('.').pop() ?? left.name;
	const rightAlias = right.alias ?? right.name.split('.').pop() ?? right.name;

	const fks = relationshipIndex.byTable.get(left.name) ?? [];
	for (const fk of fks) {
		if (
			fk.referencedTable.toLowerCase() === right.name.toLowerCase() ||
			fk.referencedTable.split('.').pop()?.toLowerCase() === right.name.split('.').pop()?.toLowerCase()
		) {
			pairs.push({
				label: `${leftAlias}.${fk.column} = ${rightAlias}.${fk.referencedColumn}`,
				insertText: `${leftAlias}.${fk.column} = ${rightAlias}.${fk.referencedColumn}`,
				score: fk.source === 'catalog' ? 100 : 70
			});
		}
	}

	return pairs.sort((a, b) => b.score - a.score);
}

export { tableKey };
