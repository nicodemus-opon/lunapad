import type { ConnectionType } from '$lib/types/connection';
import type { SchemaColumn } from './sql-schema-context';
import { lookupTable, type SchemaColumn as RegistryColumn } from './sql-schema-context';
import {
	connectionToParserDialect,
	parseSqlAst,
	type SqlParserDialect
} from './sql-parser-dialect';

export type ScopedSourceKind = 'table' | 'cte' | 'subquery';

export interface ScopedSource {
	/** Canonical table key used in the completion registry (e.g. catalog.schema.orders). */
	name: string;
	/** Alias usable in SQL (e.g. `o` in `orders o`). */
	alias?: string;
	kind: ScopedSourceKind;
	/** Columns when known from CTE/subquery SELECT list. */
	columns?: SchemaColumn[];
}

export interface SqlScope {
	sources: ScopedSource[];
	/** alias or bare name → canonical registry key or scoped source name */
	aliasToName: Map<string, string>;
	cteNames: Set<string>;
}

interface SelectAst {
	type?: string;
	with?: CteAst[] | null;
	from?: FromEntry[] | null;
	columns?: ColumnEntry[] | null;
}

interface CteAst {
	name?: { value?: string };
	stmt?: { ast?: SelectAst };
}

interface FromEntry {
	db?: string | null;
	schema?: string | null;
	table?: string;
	as?: string | null;
	join?: string;
	expr?: { ast?: SelectAst };
	prefix?: unknown;
}

interface ColumnEntry {
	as?: string | null;
	expr?: {
		type?: string;
		column?: { expr?: { value?: string } };
	};
}

function qualifyTableName(entry: FromEntry): string {
	const parts: string[] = [];
	if (entry.db) parts.push(entry.db);
	if (entry.schema) parts.push(entry.schema);
	if (entry.table) parts.push(entry.table);
	return parts.join('.');
}

function columnNameFromSelectItem(item: ColumnEntry): string | null {
	if (item.as) return item.as;
	const col = item.expr?.column?.expr?.value;
	if (col) return col;
	if (item.expr?.type === 'column_ref') return col ?? null;
	return null;
}

function columnsFromSelect(ast: SelectAst | undefined): SchemaColumn[] | undefined {
	if (!ast?.columns?.length) return undefined;
	const cols: SchemaColumn[] = [];
	for (const item of ast.columns) {
		const name = columnNameFromSelectItem(item);
		if (name) cols.push({ name });
	}
	return cols.length > 0 ? cols : undefined;
}

function addSource(scope: SqlScope, source: ScopedSource, registryKey?: string): void {
	scope.sources.push(source);
	const key = registryKey ?? source.name;
	if (source.alias) scope.aliasToName.set(source.alias.toLowerCase(), key);
	scope.aliasToName.set(source.name.toLowerCase(), key);
	const leaf = source.name.split('.').pop();
	if (leaf) scope.aliasToName.set(leaf.toLowerCase(), key);
}

function walkFromEntries(scope: SqlScope, from: FromEntry[] | null | undefined): void {
	if (!from) return;
	for (const entry of from) {
		if (entry.expr?.ast) {
			const subCols = columnsFromSelect(entry.expr.ast);
			const alias = entry.as ?? undefined;
			const name = alias ?? `_subquery_${scope.sources.length}`;
			addSource(scope, {
				name,
				alias,
				kind: 'subquery',
				columns: subCols
			});
			walkFromEntries(scope, entry.expr.ast.from ?? null);
			continue;
		}
		if (!entry.table) continue;
		const name = qualifyTableName(entry);
		addSource(scope, {
			name,
			alias: entry.as ?? undefined,
			kind: 'table'
		});
	}
}

const SQL_KEYWORDS_AFTER_TABLE = new Set([
	'where',
	'group',
	'order',
	'having',
	'limit',
	'union',
	'join',
	'inner',
	'left',
	'right',
	'full',
	'cross',
	'on',
	'using'
]);

/** Regex fallback for incomplete SQL (parser fails while typing). */
export function buildRegexScope(sql: string): SqlScope | null {
	const scope: SqlScope = {
		sources: [],
		aliasToName: new Map(),
		cteNames: new Set()
	};

	const cteRe = /\bwith\s+([`"]?)(\w+)\1\s+as\s*\(/gi;
	let cteMatch: RegExpExecArray | null;
	while ((cteMatch = cteRe.exec(sql)) !== null) {
		const cteName = cteMatch[2];
		if (cteName) {
			scope.cteNames.add(cteName);
			addSource(scope, { name: cteName, kind: 'cte' }, cteName);
		}
	}

	const fromJoinRe =
		/\b(?:from|join)\s+(`[^`]+`|"[^"]+"|[a-zA-Z_][\w.]*)(?:\s+(?:as\s+)?([a-zA-Z_]\w*))?/gi;
	let match: RegExpExecArray | null;
	while ((match = fromJoinRe.exec(sql)) !== null) {
		const rawTable = match[1];
		if (!rawTable) continue;
		const table = rawTable.replace(/^[`"]|[`"]$/g, '');
		let alias: string | undefined = match[2];
		if (alias && SQL_KEYWORDS_AFTER_TABLE.has(alias.toLowerCase())) alias = undefined;
		addSource(scope, { name: table, alias, kind: 'table' });
	}

	return scope.sources.length > 0 ? scope : null;
}

function mergeScopes(primary: SqlScope, fallback: SqlScope): SqlScope {
	const merged: SqlScope = {
		sources: [...primary.sources],
		aliasToName: new Map(primary.aliasToName),
		cteNames: new Set(primary.cteNames)
	};
	for (const source of fallback.sources) {
		const exists = merged.sources.some(
			(s) =>
				s.name.toLowerCase() === source.name.toLowerCase() ||
				(s.alias && source.alias && s.alias.toLowerCase() === source.alias.toLowerCase())
		);
		if (!exists) merged.sources.push(source);
		if (source.alias) merged.aliasToName.set(source.alias.toLowerCase(), source.name);
	}
	for (const cte of fallback.cteNames) merged.cteNames.add(cte);
	return merged;
}

function buildScopeFromSelect(ast: SelectAst): SqlScope {
	const scope: SqlScope = {
		sources: [],
		aliasToName: new Map(),
		cteNames: new Set()
	};

	if (ast.with) {
		for (const cte of ast.with) {
			const cteName = cte.name?.value;
			if (!cteName) continue;
			scope.cteNames.add(cteName);
			const innerAst = cte.stmt?.ast;
			const cols = columnsFromSelect(innerAst);
			addSource(
				scope,
				{
					name: cteName,
					kind: 'cte',
					columns: cols
				},
				cteName
			);
			walkFromEntries(scope, innerAst?.from ?? null);
		}
	}

	walkFromEntries(scope, ast.from ?? null);
	return scope;
}

export function getSqlScope(sql: string, connectionType?: ConnectionType): SqlScope | null {
	const dialect = connectionToParserDialect(connectionType);
	const regexScope = buildRegexScope(sql);
	const ast = parseSqlAst(sql, dialect);

	if (!ast || typeof ast !== 'object') return regexScope;

	const selects: SelectAst[] = [];
	if (Array.isArray(ast)) {
		for (const node of ast) {
			if (node && typeof node === 'object' && (node as SelectAst).type === 'select') {
				selects.push(node as SelectAst);
			}
		}
	} else if ((ast as SelectAst).type === 'select') {
		selects.push(ast as SelectAst);
	}

	if (selects.length === 0) return regexScope;
	const primary = selects[selects.length - 1]!;
	const parserScope = buildScopeFromSelect(primary);
	if (regexScope) return mergeScopes(parserScope, regexScope);
	return parserScope;
}

/** Resolve `o`, `orders`, or `catalog.schema.orders` to a registry lookup key. */
export function resolveTableRef(scope: SqlScope | null, ref: string): string | null {
	if (!scope) return ref;
	const lower = ref.toLowerCase();
	if (scope.aliasToName.has(lower)) return scope.aliasToName.get(lower)!;
	if (scope.cteNames.has(ref) || scope.cteNames.has(lower)) return ref;
	return ref;
}

export function tablesInScope(scope: SqlScope | null): ScopedSource[] {
	return scope?.sources ?? [];
}

export function columnsForRef(
	scope: SqlScope | null,
	registry: Map<string, RegistryColumn[]>,
	ref: string
): SchemaColumn[] | undefined {
	if (!scope) return lookupTable(registry, ref);

	const resolved = resolveTableRef(scope, ref) ?? ref;
	const lower = resolved.toLowerCase();

	for (const source of scope.sources) {
		if (
			source.name.toLowerCase() === lower ||
			source.alias?.toLowerCase() === lower ||
			ref.toLowerCase() === source.alias?.toLowerCase()
		) {
			if (source.columns?.length) return source.columns;
			return lookupTable(registry, source.name);
		}
	}

	return lookupTable(registry, resolved);
}

export function columnsInScope(
	scope: SqlScope | null,
	registry: Map<string, RegistryColumn[]>
): { source: ScopedSource; columns: SchemaColumn[]; qualifiedPrefix: string }[] {
	if (!scope) return [];
	const out: { source: ScopedSource; columns: SchemaColumn[]; qualifiedPrefix: string }[] = [];
	for (const source of scope.sources) {
		const cols =
			source.columns ??
			lookupTable(registry, source.name) ??
			lookupTable(registry, resolveTableRef(scope, source.name) ?? source.name);
		if (!cols?.length) continue;
		const prefix = source.alias ?? source.name.split('.').pop() ?? source.name;
		out.push({ source, columns: cols, qualifiedPrefix: prefix });
	}
	return out;
}

export function findColumnInScope(
	scope: SqlScope | null,
	registry: Map<string, RegistryColumn[]>,
	tableRef: string,
	columnName: string
): SchemaColumn | undefined {
	const cols = columnsForRef(scope, registry, tableRef);
	const lower = columnName.toLowerCase();
	return cols?.find((c) => c.name.toLowerCase() === lower);
}

// ── Per-model cache (debounced invalidation via version counter) ─────────────

const scopeCache = new Map<
	string,
	{ sql: string; dialect: SqlParserDialect; scope: SqlScope | null }
>();

export function getCachedSqlScope(
	modelUri: string,
	sql: string,
	connectionType?: ConnectionType
): SqlScope | null {
	const dialect = connectionToParserDialect(connectionType);
	const cached = scopeCache.get(modelUri);
	if (cached && cached.sql === sql && cached.dialect === dialect) return cached.scope;
	const scope = getSqlScope(sql, connectionType);
	scopeCache.set(modelUri, { sql, dialect, scope });
	return scope;
}

export function clearSqlScopeCache(modelUri?: string): void {
	if (modelUri) scopeCache.delete(modelUri);
	else scopeCache.clear();
}

export { prefixMatches } from './sql-match';
export {
	detectSqlClauseContext as detectSqlClauseContextFull,
	isColumnClause,
	isTableClause,
	textBeforeCursor,
	lineBeforeWord,
	type SqlClauseContext
} from './sql-clause-context';
import { detectSqlClauseContext as detectFull, isColumnClause } from './sql-clause-context';

/** Legacy single-line clause detection for backward compatibility. */
export type SqlClauseContextLegacy = 'from' | 'join' | 'column' | 'general';

export function detectSqlClauseContext(lineBeforeCursor: string): SqlClauseContextLegacy {
	const ctx = detectFull(lineBeforeCursor);
	if (ctx === 'from' || ctx === 'insertTable' || ctx === 'joinTable') return 'from';
	if (ctx === 'joinKeyword' || ctx === 'joinOn') return 'join';
	if (isColumnClause(ctx)) return 'column';
	return 'general';
}
