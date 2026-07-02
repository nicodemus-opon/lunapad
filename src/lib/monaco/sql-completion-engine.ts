import type { ConnectionType } from '$lib/types/connection';
import { getRecencyScore } from '$lib/stores/sql-completion-recency';
import type { ExternalSchemaTable } from '$lib/stores/notebook.svelte';
import { formatTableHover, sqlTableBeforeDot, splitRegistryEntry } from './sql-schema-context';
import {
	columnsForRef,
	columnsInScope,
	getCachedSqlScope,
	resolveTableRef,
	type SqlScope
} from './sql-scope';
import {
	detectSqlClauseContext,
	isColumnClause,
	isTableClause,
	textBeforeCursor,
	lineBeforeWord,
	type SqlClauseContext
} from './sql-clause-context';
import { prefixMatches, scoreMatch } from './sql-match';
import {
	buildLeafCollisions,
	generateTableAlias,
	qualifyTableName,
	tableQualificationDetail,
	uniqueAlias,
	type BareEntry,
	type ColumnEntry
} from './sql-qualify';
import {
	buildInsertSnippet,
	buildRelationshipIndex,
	buildRelationshipIndexFromRegistry,
	buildUpdateSetSnippet,
	suggestJoinCompletions,
	suggestJoinOnPairs,
	type SchemaForeignKey
} from './sql-relationships';
import { getSqlFunctionDocs, getSqlKeywords, isSqlKeyword } from './sql-dialects';
import type { CompletionEntry } from './completions';

export type CompletionKind =
	| 'table'
	| 'cte'
	| 'column'
	| 'bare'
	| 'function'
	| 'keyword'
	| 'snippet'
	| 'join'
	| 'cast';

export interface CompletionCandidate {
	label: string;
	insertText: string;
	kind: CompletionKind;
	detail?: string;
	documentation?: string;
	score: number;
	isSnippet?: boolean;
	filterText?: string;
}

export interface SqlCompletionInput {
	modelUri: string;
	registry: CompletionEntry[];
	sql: string;
	lineNumber: number;
	column: number;
	lineContent: string;
	word: string;
	wordStartColumn: number;
	dialect?: ConnectionType;
	connectionId?: string;
	externalSchema?: ExternalSchemaTable[];
}

export interface ParsedRegistryResult {
	tables: Map<string, ColumnEntry[]>;
	bare: BareEntry[];
	leafCollisions: Map<string, string[]>;
	relationshipIndex: ReturnType<typeof buildRelationshipIndexFromRegistry>;
}

export function parseRegistryWithMeta(
	items: CompletionEntry[],
	externalSchema?: ExternalSchemaTable[]
): ParsedRegistryResult {
	const tables = new Map<string, ColumnEntry[]>();
	const bare: BareEntry[] = [];

	for (const item of items) {
		if (!item.text) continue;
		const parsed = splitRegistryEntry(item.text);
		if (parsed) {
			const { table, column } = parsed;
			let cols = tables.get(table);
			if (!cols) {
				cols = [];
				tables.set(table, cols);
			}
			if (!cols.some((c) => c.name === column))
				cols.push({
					name: column,
					detail: item.detail,
					description: item.description
				});
		} else {
			bare.push(item);
		}
	}

	const leafCollisions = buildLeafCollisions(tables);

	const fkMap = new Map<string, SchemaForeignKey[]>();
	if (externalSchema) {
		const idx = buildRelationshipIndex(externalSchema);
		for (const [k, v] of idx.byTable) fkMap.set(k, v);
	}

	const relationshipIndex = buildRelationshipIndexFromRegistry(tables, fkMap);

	return { tables, bare, leafCollisions, relationshipIndex };
}

function columnDocumentation(col: ColumnEntry): string | undefined {
	const parts: string[] = [];
	if (col.detail) parts.push(`\`${col.detail}\``);
	if (col.description) parts.push(col.description);
	return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function scoreCandidate(
	label: string,
	prefix: string,
	baseScore: number,
	connectionId?: string,
	inScope?: boolean
): number {
	const match = scoreMatch(label, prefix);
	if (match.kind === 'none') return -1;
	let score = baseScore + match.score;
	score += getRecencyScore(connectionId, label);
	if (inScope) score += 100;
	return score;
}

function usedAliases(scope: SqlScope | null): Set<string> {
	const used = new Set<string>();
	if (!scope) return used;
	for (const s of scope.sources) {
		if (s.alias) used.add(s.alias.toLowerCase());
	}
	return used;
}

const SQL_SNIPPETS = [
	{
		label: 'SELECT …',
		detail: 'Select columns',
		insertText: 'SELECT ${1:*}\nFROM ${2:table}',
		score: 10
	},
	{
		label: 'LEFT JOIN … ON',
		detail: 'Left join',
		insertText: 'LEFT JOIN ${1:table} ON ${2:left} = ${3:right}',
		score: 10
	},
	{
		label: 'CASE WHEN …',
		detail: 'Case expression',
		insertText: 'CASE\n\tWHEN ${1:condition} THEN ${2:value}\n\tELSE ${3:default}\nEND',
		score: 10
	},
	{
		label: 'GROUP BY …',
		detail: 'Group by columns',
		insertText: 'GROUP BY ${1:column}',
		score: 10
	}
];

const CAST_TYPES = ['VARCHAR', 'INTEGER', 'BIGINT', 'DOUBLE', 'BOOLEAN', 'DATE', 'TIMESTAMP'];

export const MAX_SCHEMA_SUGGESTIONS = 100;
export const MAX_FUNCTION_SUGGESTIONS = 40;

function capCandidates(candidates: CompletionCandidate[], max: number): CompletionCandidate[] {
	return candidates.sort((a, b) => b.score - a.score).slice(0, max);
}

function tableInsertText(qName: string, lineBefore: string): string {
	const leaf = qName.split('.').pop() ?? qName;
	// After `schema.` only complete the table leaf segment.
	if (/\.[\w`"]*$/.test(lineBefore)) return leaf;
	return qName;
}

export function buildSqlCompletions(input: SqlCompletionInput): CompletionCandidate[] {
	const { tables, bare, leafCollisions, relationshipIndex } = parseRegistryWithMeta(
		input.registry,
		input.externalSchema
	);

	const beforeCursor = input.lineContent.slice(0, input.column - 1);
	const lineBefore = lineBeforeWord(input.lineContent, input.wordStartColumn);
	const textBefore = textBeforeCursor(input.sql, input.lineNumber, input.column);
	const prefix = input.word;

	const actualScope = getCachedSqlScope(input.modelUri, input.sql, input.dialect);
	const clause = detectSqlClauseContext(textBefore, lineBefore);
	const qualify = (name: string) => qualifyTableName(name, leafCollisions);

	const candidates: CompletionCandidate[] = [];
	const push = (c: CompletionCandidate) => {
		if (c.score < 0) return;
		candidates.push(c);
	};

	// Dot context: table.| or alias.|
	const tableRef = sqlTableBeforeDot(beforeCursor);
	if (tableRef !== null) {
		const resolved = resolveTableRef(actualScope, tableRef) ?? tableRef;

		// cast suffix: col.cast
		if (tableRef.toLowerCase().endsWith('.cast') || beforeCursor.match(/\.cast\s*$/i)) {
			const baseRef = tableRef.replace(/\.cast$/i, '');
			for (const t of CAST_TYPES) {
				if (!prefixMatches(t, prefix)) continue;
				push({
					label: t,
					insertText: `CAST(${baseRef} AS ${t})`,
					kind: 'cast',
					detail: 'CAST expression',
					score: scoreCandidate(t, prefix, 80, input.connectionId)
				});
			}
			return capCandidates(candidates, MAX_SCHEMA_SUGGESTIONS);
		}

		const cols = columnsForRef(actualScope, tables, resolved);
		if (cols) {
			for (const c of cols) {
				if (!prefixMatches(c.name, prefix)) continue;
				push({
					label: c.name,
					insertText: c.name,
					kind: 'column',
					detail: c.detail,
					documentation: columnDocumentation(c),
					score: scoreCandidate(c.name, prefix, 90, input.connectionId, true)
				});
			}
		}
		return capCandidates(candidates, MAX_SCHEMA_SUGGESTIONS);
	}

	// JOIN table context with relationship snippets
	if (clause === 'joinTable' || clause === 'joinKeyword') {
		const joins = suggestJoinCompletions(
			actualScope,
			relationshipIndex,
			leafCollisions,
			prefix,
			prefixMatches
		);
		for (const j of joins) {
			push({
				label: j.label,
				insertText: j.insertText,
				kind: 'join',
				detail: j.detail,
				score: j.score + scoreMatch(j.targetTable, prefix).score,
				isSnippet: false
			});
		}
	}

	// JOIN ON context
	if (clause === 'joinOn') {
		for (const pair of suggestJoinOnPairs(actualScope, relationshipIndex)) {
			if (prefix && !prefixMatches(pair.label, prefix)) continue;
			push({
				label: pair.label,
				insertText: pair.insertText,
				kind: 'column',
				detail: 'join condition',
				score: pair.score
			});
		}
		if (candidates.length > 0) return capCandidates(candidates, MAX_SCHEMA_SUGGESTIONS);
	}

	// INSERT INTO table
	if (clause === 'insertTable') {
		for (const [table, cols] of tables) {
			if (!prefixMatches(table, prefix) && !prefixMatches(table.split('.').pop() ?? '', prefix))
				continue;
			const qName = qualify(table);
			const snippet = buildInsertSnippet(table, cols, qualify);
			push({
				label: qName,
				insertText: `${qName} ${snippet}`,
				kind: 'snippet',
				detail: 'INSERT columns',
				documentation: formatTableHover(table, cols),
				score: scoreCandidate(table, prefix, 120, input.connectionId),
				isSnippet: true
			});
		}
		return capCandidates(candidates, MAX_SCHEMA_SUGGESTIONS);
	}

	// INSERT column list inside parens
	if (clause === 'insertColumns') {
		const tableMatch = textBefore.match(/\bINSERT\s+INTO\s+([`"\w.]+)/i);
		if (tableMatch) {
			const tableName = tableMatch[1]!.replace(/^[`"]|[`"]$/g, '');
			const cols = columnsForRef(actualScope, tables, tableName);
			if (cols) {
				for (const c of cols) {
					if (!prefixMatches(c.name, prefix)) continue;
					push({
						label: c.name,
						insertText: c.name,
						kind: 'column',
						detail: c.detail,
						score: scoreCandidate(c.name, prefix, 90, input.connectionId)
					});
				}
			}
		}
		return capCandidates(candidates, MAX_SCHEMA_SUGGESTIONS);
	}

	// UPDATE SET
	if (clause === 'updateSet') {
		const tableMatch = textBefore.match(/\bUPDATE\s+([`"\w.]+)/i);
		if (tableMatch) {
			const tableName = tableMatch[1]!.replace(/^[`"]|[`"]$/g, '');
			const cols = columnsForRef(actualScope, tables, tableName);
			if (cols) {
				for (const c of cols) {
					if (!prefixMatches(c.name, prefix)) continue;
					push({
						label: c.name,
						insertText: `${c.name} = `,
						kind: 'column',
						detail: c.detail,
						score: scoreCandidate(c.name, prefix, 90, input.connectionId)
					});
				}
			}
		}
		return capCandidates(candidates, MAX_SCHEMA_SUGGESTIONS);
	}

	// FROM / table clauses
	if (isTableClause(clause)) {
		const used = usedAliases(actualScope);
		for (const [table, cols] of tables) {
			if (!prefixMatches(table, prefix) && !prefixMatches(table.split('.').pop() ?? '', prefix))
				continue;
			const qName = qualify(table);
			const qualDetail = tableQualificationDetail(table);
			const alias = uniqueAlias(generateTableAlias(table), used);
			used.add(alias.toLowerCase());
			const leaf = table.split('.').pop() ?? table;

			push({
				label: qName,
				insertText: tableInsertText(qName, lineBefore),
				kind: 'table',
				detail: qualDetail,
				documentation: formatTableHover(table, cols),
				score: scoreCandidate(table, prefix, 80, input.connectionId),
				filterText: leaf
			});
			push({
				label: `${qName} ${alias}`,
				insertText: `${tableInsertText(qName, lineBefore)} ${alias}`,
				kind: 'table',
				detail: `alias: ${alias}`,
				documentation: formatTableHover(table, cols),
				score: scoreCandidate(table, prefix, 75, input.connectionId),
				filterText: leaf
			});
		}
		for (const cteName of actualScope?.cteNames ?? []) {
			if (!prefixMatches(cteName, prefix)) continue;
			const cteCols = columnsForRef(actualScope, tables, cteName) ?? [];
			push({
				label: cteName,
				insertText: cteName,
				kind: 'cte',
				documentation: formatTableHover(cteName, cteCols),
				score: scoreCandidate(cteName, prefix, 85, input.connectionId)
			});
		}
		for (const b of bare) {
			if (!prefixMatches(b.text, prefix)) continue;
			push({
				label: b.text,
				insertText: b.text,
				kind: 'bare',
				detail: b.detail,
				documentation: b.description,
				score: scoreCandidate(b.text, prefix, 70, input.connectionId)
			});
		}
		return capCandidates(candidates, MAX_SCHEMA_SUGGESTIONS);
	}

	// Column clauses
	const columnClause = isColumnClause(clause);
	const scoped = columnsInScope(actualScope, tables);

	if (scoped.length > 0 && columnClause) {
		for (const { columns, qualifiedPrefix } of scoped) {
			for (const c of columns) {
				const qualified = `${qualifiedPrefix}.${c.name}`;
				if (prefix && !prefixMatches(c.name, prefix) && !prefixMatches(qualified, prefix)) continue;
				push({
					label: qualified,
					insertText: qualified,
					kind: 'column',
					detail: c.detail,
					documentation: columnDocumentation(c),
					score: scoreCandidate(qualified, prefix, 95, input.connectionId, true)
				});
				push({
					label: c.name,
					insertText: c.name,
					kind: 'column',
					detail: c.detail,
					documentation: columnDocumentation(c),
					score: scoreCandidate(c.name, prefix, 85, input.connectionId, true),
					filterText: qualified
				});
			}
		}
	} else if (!columnClause || !prefix) {
		for (const [table, cols] of tables) {
			if (prefix && !prefixMatches(table, prefix)) {
				const anyCol = cols.some(
					(c) => prefixMatches(c.name, prefix) || prefixMatches(`${table}.${c.name}`, prefix)
				);
				if (!anyCol) continue;
			}
			push({
				label: table,
				insertText: qualify(table),
				kind: 'table',
				documentation: formatTableHover(table, cols),
				score: scoreCandidate(table, prefix, 60, input.connectionId)
			});
			for (const c of cols) {
				const qualified = `${table}.${c.name}`;
				if (prefix && !prefixMatches(qualified, prefix) && !prefixMatches(c.name, prefix)) continue;
				push({
					label: qualified,
					insertText: qualified,
					kind: 'column',
					detail: c.detail,
					documentation: columnDocumentation(c),
					score: scoreCandidate(qualified, prefix, 55, input.connectionId)
				});
			}
		}
	}

	for (const b of bare) {
		if (prefix && !prefixMatches(b.text, prefix)) continue;
		push({
			label: b.text,
			insertText: b.text,
			kind: 'bare',
			detail: b.detail,
			documentation: b.description,
			score: scoreCandidate(b.text, prefix, 50, input.connectionId)
		});
	}

	const fnAllowed = !columnClause || prefix.length >= 1;
	if (fnAllowed) {
		let fnCount = 0;
		for (const fn of getSqlFunctionDocs(input.dialect)) {
			if (!prefixMatches(fn.name, prefix)) continue;
			push({
				label: fn.name,
				insertText: fn.name,
				kind: 'function',
				detail: fn.signature,
				documentation: fn.doc,
				score: scoreCandidate(fn.name, prefix, 40, input.connectionId)
			});
			if (++fnCount >= MAX_FUNCTION_SUGGESTIONS) break;
		}
	}

	if (!columnClause) {
		for (const kw of getSqlKeywords(input.dialect)) {
			if (!prefixMatches(kw, prefix)) continue;
			push({
				label: kw,
				insertText: kw,
				kind: 'keyword',
				score: scoreCandidate(kw, prefix, 20, input.connectionId)
			});
		}
		for (const snippet of SQL_SNIPPETS) {
			if (prefix && !prefixMatches(snippet.label, prefix)) continue;
			push({
				label: snippet.label,
				insertText: snippet.insertText,
				kind: 'snippet',
				detail: snippet.detail,
				score: snippet.score,
				isSnippet: true
			});
		}
	}

	// Hippie completion lite: identifiers already present in this query.
	if (prefix.length >= 2) {
		const seenLabels = new Set(candidates.map((c) => c.label.toLowerCase()));
		const idRe = /\b([A-Za-z_][\w]{2,})\b/g;
		let m: RegExpExecArray | null;
		while ((m = idRe.exec(input.sql))) {
			const id = m[1]!;
			if (seenLabels.has(id.toLowerCase()) || isSqlKeyword(id, input.dialect)) continue;
			if (!prefixMatches(id, prefix)) continue;
			push({
				label: id,
				insertText: id,
				kind: 'bare',
				detail: 'from query',
				score: scoreCandidate(id, prefix, 5, input.connectionId)
			});
		}
	}

	return capCandidates(candidates, MAX_SCHEMA_SUGGESTIONS + MAX_FUNCTION_SUGGESTIONS);
}

/** Map clause to legacy type for backward compatibility. */
export function clauseToLegacy(clause: SqlClauseContext): 'from' | 'join' | 'column' | 'general' {
	if (clause === 'from' || clause === 'insertTable' || clause === 'joinTable') return 'from';
	if (clause === 'joinKeyword' || clause === 'joinOn') return 'join';
	if (isColumnClause(clause)) return 'column';
	return 'general';
}
