import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { PRQL_KEYWORDS, PRQL_BUILTINS, PRQL_DOCS } from './prql';
import { PY_TYPE_TO_TRINO } from '$lib/services/udf';
import { getSqlFunctionDoc } from './sql-dialects';
import { clearSqlScopeCache } from './sql-scope';
import type { ConnectionType } from '$lib/types/connection';
import type { ExternalSchemaTable } from '$lib/stores/notebook.svelte';
import { completePython, type PythonTableDescriptor } from '$lib/services/python-client';
import { formatDocstring } from '$lib/services/docstring-format';
import { formatPythonTableHintDoc, type PythonTableHint } from '$lib/services/python-tables';
import {
	buildSqlCompletions,
	parseRegistryWithMeta,
	type CompletionCandidate,
	type CompletionKind
} from './sql-completion-engine';
import { recordCompletionAcceptance } from '$lib/stores/sql-completion-recency';
export type { PythonTableHint } from '$lib/services/python-tables';

// Both UDF cells and Python data cells use Monaco language id 'python', but
// want very different completions (UDF: fixed type-hint skeleton; data cell:
// jedi-backed completion against that notebook's warm worker) — keyed by
// model URI like dialectByModel below.
export type PythonCellContext = { kind: 'udf' } | { kind: 'data'; notebookId: string };
const pythonContextByModel = new Map<string, PythonCellContext>();

export function setModelPythonContext(
	model: Monaco.editor.ITextModel,
	context: PythonCellContext
): void {
	pythonContextByModel.set(model.uri.toString(), context);
}

export function clearModelPythonContext(model: Monaco.editor.ITextModel): void {
	pythonContextByModel.delete(model.uri.toString());
}

export function getModelPythonContext(
	model: Monaco.editor.ITextModel
): PythonCellContext | undefined {
	return pythonContextByModel.get(model.uri.toString());
}

// Upstream cell DataFrame schemas for Python data cells — { name, columns[] } per
// upstream cell that has a result. Lets ghost completions show structured schema
// ("orders: id, status, amount") instead of guessing from jedi names alone.
export interface PythonUpstreamSchema {
	name: string;
	columns: string[];
}
const pythonSchemaByModel = new Map<string, PythonUpstreamSchema[]>();

export function setModelPythonSchema(
	model: Monaco.editor.ITextModel,
	schemas: PythonUpstreamSchema[]
): void {
	pythonSchemaByModel.set(model.uri.toString(), schemas);
}

export function clearModelPythonSchema(model: Monaco.editor.ITextModel): void {
	pythonSchemaByModel.delete(model.uri.toString());
}

export function getModelPythonSchema(model: Monaco.editor.ITextModel): PythonUpstreamSchema[] {
	return pythonSchemaByModel.get(model.uri.toString()) ?? [];
}

const pythonTableHintsByModel = new Map<string, PythonTableHint[]>();

export function setModelPythonTableHints(
	model: Monaco.editor.ITextModel,
	hints: PythonTableHint[]
): void {
	pythonTableHintsByModel.set(model.uri.toString(), hints);
}

export function clearModelPythonTableHints(model: Monaco.editor.ITextModel): void {
	pythonTableHintsByModel.delete(model.uri.toString());
}

export function getModelPythonTableHints(model: Monaco.editor.ITextModel): PythonTableHint[] {
	return pythonTableHintsByModel.get(model.uri.toString()) ?? [];
}

// A completion candidate from the per-cell registry: "table.column" pairs or
// bare table/cell names, optionally carrying a type (detail) and description.
export interface CompletionEntry {
	text: string;
	detail?: string;
	description?: string;
}

// Completion providers are registered once per language, but completions are
// per cell — this registry maps a model URI to that cell's completion list.
const completionsByModel = new Map<string, CompletionEntry[]>();

export function setModelCompletions(
	model: Monaco.editor.ITextModel,
	items: CompletionEntry[]
): void {
	completionsByModel.set(model.uri.toString(), items);
}

export function clearModelCompletions(model: Monaco.editor.ITextModel): void {
	completionsByModel.delete(model.uri.toString());
	clearSqlScopeCache(model.uri.toString());
}

export function getModelCompletions(model: Monaco.editor.ITextModel): CompletionEntry[] {
	return completionsByModel.get(model.uri.toString()) ?? [];
}

// Per-cell connection type — drives which dialect-specific SQL functions
// (DuckDB/Postgres/ClickHouse/MySQL) are offered for completion/hover.
const dialectByModel = new Map<string, ConnectionType>();

export function setModelDialect(model: Monaco.editor.ITextModel, dialect: ConnectionType): void {
	dialectByModel.set(model.uri.toString(), dialect);
}

export function clearModelDialect(model: Monaco.editor.ITextModel): void {
	dialectByModel.delete(model.uri.toString());
}

export function getModelDialect(model: Monaco.editor.ITextModel): ConnectionType | undefined {
	return dialectByModel.get(model.uri.toString());
}

export interface SqlModelContext {
	connectionId?: string;
	externalSchema?: ExternalSchemaTable[];
}

const sqlContextByModel = new Map<string, SqlModelContext>();

export function setModelSqlContext(
	model: Monaco.editor.ITextModel,
	context: SqlModelContext
): void {
	sqlContextByModel.set(model.uri.toString(), context);
}

export function clearModelSqlContext(model: Monaco.editor.ITextModel): void {
	sqlContextByModel.delete(model.uri.toString());
}

export function getModelSqlContext(model: Monaco.editor.ITextModel): SqlModelContext {
	return sqlContextByModel.get(model.uri.toString()) ?? {};
}

interface ColumnEntry {
	name: string;
	detail?: string;
	description?: string;
}

export function parseRegistry(items: CompletionEntry[]): {
	tables: Map<string, ColumnEntry[]>;
	bare: CompletionEntry[];
} {
	const parsed = parseRegistryWithMeta(items);
	return { tables: parsed.tables, bare: parsed.bare };
}

const MAX_SCHEMA_SUGGESTIONS = 100;
const MAX_FUNCTION_SUGGESTIONS = 40;

function kindToMonaco(
	kind: CompletionKind,
	kinds: typeof Monaco.languages.CompletionItemKind
): Monaco.languages.CompletionItemKind {
	switch (kind) {
		case 'table':
		case 'cte':
			return kinds.Struct;
		case 'column':
			return kinds.Field;
		case 'bare':
			return kinds.Variable;
		case 'function':
			return kinds.Function;
		case 'keyword':
			return kinds.Keyword;
		case 'snippet':
		case 'join':
		case 'cast':
			return kinds.Snippet;
		default:
			return kinds.Text;
	}
}

function candidateToMonaco(
	c: CompletionCandidate,
	range: Monaco.IRange,
	kinds: typeof Monaco.languages.CompletionItemKind,
	monaco: typeof Monaco,
	connectionId?: string
): Monaco.languages.CompletionItem {
	const sortKey = String(9999 - Math.min(c.score, 9999)).padStart(4, '0');
	return {
		label: c.label,
		kind: kindToMonaco(c.kind, kinds),
		insertText: c.insertText,
		insertTextRules: c.isSnippet
			? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
			: undefined,
		detail: c.detail,
		documentation: c.documentation ? { value: c.documentation } : undefined,
		range,
		sortText: sortKey + c.label,
		filterText: c.filterText ?? c.label.split('.').pop() ?? c.label,
		command: {
			id: 'lunapad.recordCompletion',
			title: 'Record completion',
			arguments: [c.label, connectionId]
		}
	};
}

function capSuggestions<T>(items: T[], max: number): T[] {
	return items.length <= max ? items : items.slice(0, max);
}

export function registerCompletions(monaco: typeof Monaco): void {
	monaco.editor.registerCommand(
		'lunapad.recordCompletion',
		(_accessor, label: string, connectionId?: string) => {
			if (typeof label === 'string') recordCompletionAcceptance(connectionId, label);
		}
	);

	for (const languageId of ['prql', 'sql', 'trinosql', 'genericsql'] as const) {
		const isSql = languageId === 'sql' || languageId === 'trinosql' || languageId === 'genericsql';
		monaco.languages.registerCompletionItemProvider(languageId, {
			// Dot completion is helpful for aliases/table refs. Comma/space triggers are
			// too eager in SQL SELECT lists: while typing normally, Monaco can accept the
			// currently selected function suggestion (often `abs`) as the next token.
			triggerCharacters: ['.'],
			provideCompletionItems(model, position) {
				try {
					return provideSqlLikeCompletions(monaco, languageId, isSql, model, position);
				} catch (err) {
					console.warn('[sql-completion] provider error', err);
					return { suggestions: [] };
				}
			}
		});
	}

	registerPythonCompletions(monaco);
}

function provideSqlLikeCompletions(
	monaco: typeof Monaco,
	languageId: 'prql' | 'sql' | 'trinosql' | 'genericsql',
	isSql: boolean,
	model: Monaco.editor.ITextModel,
	position: Monaco.Position
): Monaco.languages.ProviderResult<Monaco.languages.CompletionList> {
	const items = completionsByModel.get(model.uri.toString()) ?? [];
	const { tables, bare } = parseRegistry(items);

	const word = model.getWordUntilPosition(position);
	const range: Monaco.IRange = {
		startLineNumber: position.lineNumber,
		endLineNumber: position.lineNumber,
		startColumn: word.startColumn,
		endColumn: word.endColumn
	};
	const kinds = monaco.languages.CompletionItemKind;

	const lineContent = model.getLineContent(position.lineNumber);
	const lineBefore = lineContent.slice(0, word.startColumn - 1);

	if (isSql) {
		const dialect = getModelDialect(model);
		const sqlCtx = getModelSqlContext(model);
		const candidates = buildSqlCompletions({
			modelUri: model.uri.toString(),
			registry: items,
			sql: model.getValue(),
			lineNumber: position.lineNumber,
			column: position.column,
			lineContent,
			word: word.word,
			wordStartColumn: word.startColumn,
			dialect,
			connectionId: sqlCtx.connectionId,
			externalSchema: sqlCtx.externalSchema
		});
		return {
			suggestions: candidates.map((c) =>
				candidateToMonaco(c, range, kinds, monaco, sqlCtx.connectionId)
			),
			incomplete: false
		};
	}

	// PRQL relation context: `from|join|append|intersect|remove <here>` →
	// only relations make sense, not transform keywords/builtins.
	if (languageId === 'prql') {
		const relationMatch = lineBefore.match(/\b(from|join|append|intersect|remove)\s+[\w.`]*$/i);
		if (relationMatch) {
			const relSuggestions: Monaco.languages.CompletionItem[] = [];
			for (const table of tables.keys()) {
				relSuggestions.push({
					label: table,
					kind: kinds.Struct,
					insertText: table,
					range,
					sortText: '0' + table
				});
			}
			for (const b of bare) {
				relSuggestions.push({
					label: b.text,
					kind: kinds.Variable,
					insertText: b.text,
					detail: b.detail,
					range,
					sortText: '1' + b.text
				});
			}
			return { suggestions: relSuggestions };
		}
	}

	const suggestions: Monaco.languages.CompletionItem[] = [];
	const seen = new Set<string>();
	const push = (
		label: string,
		kind: Monaco.languages.CompletionItemKind,
		sortPrefix: string,
		detail?: string,
		documentation?: string
	) => {
		if (seen.has(label)) return;
		seen.add(label);
		suggestions.push({
			label,
			kind,
			insertText: label,
			detail,
			documentation: documentation ? { value: documentation } : undefined,
			range,
			sortText: sortPrefix + label
		});
	};

	for (const [table, cols] of tables) {
		push(table, kinds.Struct, '1');
		for (const c of cols) push(`${table}.${c.name}`, kinds.Field, '3', c.detail);
	}
	for (const b of bare) push(b.text, kinds.Variable, '2', b.detail);
	for (const kw of PRQL_KEYWORDS) push(kw, kinds.Keyword, '4', PRQL_DOCS[kw]);
	for (const fn of PRQL_BUILTINS) push(fn, kinds.Function, '5', PRQL_DOCS[fn]);
	for (const snippet of PRQL_SNIPPETS) {
		suggestions.push({
			label: snippet.label,
			kind: kinds.Snippet,
			insertText: snippet.insertText,
			insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
			detail: snippet.detail,
			range,
			sortText: '6' + snippet.label
		});
	}

	return {
		suggestions: capSuggestions(suggestions, MAX_SCHEMA_SUGGESTIONS + MAX_FUNCTION_SUGGESTIONS)
	};
}

// Multi-token PRQL transforms are easier to reach for as fill-in-the-blank
// snippets than to type from a bare keyword completion.
const PRQL_SNIPPETS = [
	{
		label: 'join …',
		detail: 'Join snippet',
		insertText: 'join ${1:side} ${2:table} (${3:condition})'
	},
	{
		label: 'window …',
		detail: 'Window snippet',
		insertText: 'window rows:${1:-3..3} (\n\t${2:derive {value = lag x}}\n)'
	},
	{
		label: 'case …',
		detail: 'Case snippet',
		insertText: 'case [\n\t${1:condition} => ${2:value},\n\ttrue => ${3:default},\n]'
	}
];

// UDF cells parse exactly one `def name(param: type, ...) -> type:` line — only
// the six Trino-mappable type hints and a starter snippet are worth suggesting.
const UDF_TYPE_HINTS = Object.keys(PY_TYPE_TO_TRINO);

// Available from the first keystroke, before the notebook's worker has ever
// run (jedi needs a live worker — see completePython) and merged alongside
// jedi's results afterwards.
const PY_KEYWORDS = [
	'and',
	'as',
	'assert',
	'break',
	'class',
	'continue',
	'def',
	'del',
	'elif',
	'else',
	'except',
	'False',
	'finally',
	'for',
	'from',
	'if',
	'import',
	'in',
	'is',
	'lambda',
	'None',
	'not',
	'or',
	'pass',
	'raise',
	'return',
	'True',
	'try',
	'while',
	'with',
	'yield'
];
const PY_DATA_CELL_BARE = ['pd', 'np', 'go', 'px', 'result', 'tables'];

function pythonTableDescriptorsForIntel(hints: PythonTableHint[]): PythonTableDescriptor[] {
	return hints.map((hint) => ({
		dataKey: hint.canonicalName,
		canonicalName: hint.canonicalName,
		source: hint.source,
		aliases: hint.aliases,
		attributeAlias: hint.attributeAlias ?? null,
		columns: hint.columns,
		columnTypes: hint.columnTypes,
		description: hint.description,
		rowMode: 'preview'
	}));
}

function formatPythonSchemaDoc(schema: PythonUpstreamSchema): string {
	const columns = schema.columns.slice(0, 10);
	if (columns.length === 0) return `**${schema.name}**\n\nUpstream cell DataFrame.`;
	return `**${schema.name}**\n\nUpstream cell DataFrame.\n\nColumns:\n${columns.map((column) => `- \`${column}\``).join('\n')}`;
}

export function buildPythonIntelDescriptors(
	hints: PythonTableHint[],
	schemas: PythonUpstreamSchema[]
): PythonTableDescriptor[] {
	const descriptors: PythonTableDescriptor[] = [];
	const seen = new Set<string>();

	for (const schema of schemas) {
		if (!schema.name || seen.has(schema.name)) continue;
		seen.add(schema.name);
		descriptors.push({
			dataKey: schema.name,
			canonicalName: schema.name,
			source: 'cell',
			aliases: [schema.name],
			attributeAlias: schema.name,
			bindBareGlobal: schema.name,
			columns: schema.columns,
			rowMode: 'preview'
		});
	}

	for (const descriptor of pythonTableDescriptorsForIntel(hints)) {
		if (seen.has(descriptor.canonicalName)) continue;
		seen.add(descriptor.canonicalName);
		descriptors.push(descriptor);
	}

	return descriptors;
}

function jediKindToMonaco(
	type: string,
	kinds: typeof Monaco.languages.CompletionItemKind
): Monaco.languages.CompletionItemKind {
	switch (type) {
		case 'function':
			return kinds.Function;
		case 'class':
			return kinds.Class;
		case 'module':
			return kinds.Module;
		case 'keyword':
			return kinds.Keyword;
		case 'param':
			return kinds.Variable;
		case 'property':
			return kinds.Field;
		case 'statement':
		case 'instance':
		default:
			return kinds.Variable;
	}
}

function registerPythonCompletions(monaco: typeof Monaco): void {
	monaco.languages.registerCompletionItemProvider('python', {
		triggerCharacters: [':', ' ', '.'],
		async provideCompletionItems(model, position, _context, token) {
			const word = model.getWordUntilPosition(position);
			const range: Monaco.IRange = {
				startLineNumber: position.lineNumber,
				endLineNumber: position.lineNumber,
				startColumn: word.startColumn,
				endColumn: word.endColumn
			};
			const kinds = monaco.languages.CompletionItemKind;
			const lineBefore = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
			const context = getModelPythonContext(model);
			const tableHints = getModelPythonTableHints(model);
			const upstreamSchemas = getModelPythonSchema(model);

			if (!context || context.kind === 'udf') {
				// Param type hint (`x:`) or return type (`->`) position — only the
				// six UDF-compatible types are ever valid here.
				if (/(:|->)\s*[\w.]*$/.test(lineBefore)) {
					return {
						suggestions: UDF_TYPE_HINTS.map((t) => ({
							label: t,
							kind: kinds.TypeParameter,
							insertText: t,
							detail: `→ ${PY_TYPE_TO_TRINO[t]}`,
							range
						}))
					};
				}

				return {
					suggestions: [
						{
							label: 'def',
							kind: kinds.Snippet,
							insertText: 'def ${1:my_udf}(${2:x}: ${3:int}) -> ${4:float}:\n\t${0:return ...}',
							insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
							detail: 'UDF function skeleton',
							range
						}
					]
				};
			}

			// Python data cell: static baseline (instant, before any run) + a
			// real jedi-backed completion against the notebook's warm worker
			// (sees actual bound DataFrames/imports once a cell has run there).
			const suggestions: Monaco.languages.CompletionItem[] = [];
			const seen = new Set<string>();
			const push = (
				label: string,
				kind: Monaco.languages.CompletionItemKind,
				sortPrefix: string,
				detail?: string,
				documentation?: string
			) => {
				if (seen.has(label)) return;
				seen.add(label);
				suggestions.push({
					label,
					kind,
					insertText: label,
					detail,
					documentation: documentation ? { value: formatDocstring(documentation) } : undefined,
					range,
					sortText: sortPrefix + label
				});
			};
			for (const name of PY_DATA_CELL_BARE) push(name, kinds.Variable, '0');
			for (const schema of upstreamSchemas) {
				push(
					schema.name,
					kinds.Variable,
					'0',
					'Upstream DataFrame',
					formatPythonSchemaDoc(schema)
				);
			}
			for (const kw of PY_KEYWORDS) push(kw, kinds.Keyword, '3');
			if (/tables\.[A-Za-z_0-9]*$/.test(lineBefore)) {
				push(
					'available',
					kinds.Method,
					'0',
					'available()',
					'List the current bounded table working set.'
				);
				push(
					'find',
					kinds.Method,
					'0',
					'find(query)',
					'Search the current bounded table working set.'
				);
				push(
					'load',
					kinds.Method,
					'0',
					'load(name)',
					'Load a table by canonical or alias name.'
				);
				for (const hint of tableHints) {
					if (!hint.attributeAlias) continue;
					push(
						hint.attributeAlias,
						kinds.Field,
						'1',
						hint.canonicalName,
						formatPythonTableHintDoc(hint)
					);
				}
			}
			if (/tables(?:\.load)?\(\s*["'][^"']*$/.test(lineBefore) || /tables\[\s*["'][^"']*$/.test(lineBefore)) {
				for (const hint of tableHints) {
					push(
						hint.canonicalName,
						kinds.Value,
						'1',
						hint.source,
						formatPythonTableHintDoc(hint)
					);
				}
			}

			const controller = new AbortController();
			token.onCancellationRequested(() => controller.abort());
			try {
				const items = await completePython(
					context.notebookId,
					model.getValue(),
					position.lineNumber,
					position.column - 1,
					buildPythonIntelDescriptors(tableHints, upstreamSchemas),
					controller.signal
				);
				for (const item of items) {
					push(item.name, jediKindToMonaco(item.type, kinds), '1', item.detail, item.doc);
				}
			} catch {
				// worker unavailable/cancelled — static baseline above still stands
			}

			return { suggestions };
		}
	});
}

export function registerSqlSignatureHelp(monaco: typeof Monaco): void {
	for (const langId of ['sql', 'trinosql', 'genericsql'] as const) {
		monaco.languages.registerSignatureHelpProvider(langId, {
			signatureHelpTriggerCharacters: ['('],
			signatureHelpRetriggerCharacters: [','],
			provideSignatureHelp(model, position) {
				const textBefore = model.getValueInRange({
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: position.lineNumber,
					endColumn: position.column
				});

				// Walk backwards to find the matching open paren and count commas at depth 0.
				let depth = 0;
				let commas = 0;
				for (let i = textBefore.length - 1; i >= 0; i--) {
					const ch = textBefore[i];
					if (ch === ')') {
						depth++;
					} else if (ch === '(') {
						if (depth > 0) {
							depth--;
						} else {
							// Found the open paren for the current call — look left for the function name.
							const fnMatch = textBefore.slice(0, i).match(/([A-Za-z_][\w]*)$/);
							if (!fnMatch) return null;
							const dialect = getModelDialect(model);
							const fn = getSqlFunctionDoc(fnMatch[1].toLowerCase(), dialect);
							if (!fn) return null;
							const paramStr = fn.signature.match(/\(([^)]*)\)/)?.[1] ?? '';
							const params = paramStr ? paramStr.split(',').map((p) => p.trim()) : [];
							return {
								dispose: () => {},
								value: {
									signatures: [
										{
											label: fn.signature,
											documentation: { value: fn.doc },
											parameters: params.map((p) => ({ label: p }))
										}
									],
									activeSignature: 0,
									activeParameter: Math.min(commas, Math.max(0, params.length - 1))
								}
							};
						}
					} else if (ch === ',' && depth === 0) {
						commas++;
					}
				}
				return null;
			}
		});
	}
}
