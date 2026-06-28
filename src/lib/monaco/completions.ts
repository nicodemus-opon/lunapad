import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { language as sqlMonarch } from 'monaco-editor/esm/vs/basic-languages/sql/sql.js';
import { PRQL_KEYWORDS, PRQL_BUILTINS, PRQL_DOCS } from './prql';
import { PY_TYPE_TO_TRINO } from '$lib/services/udf';
import { getSqlFunctionDocs } from './sql-dialects';
import type { ConnectionType } from '$lib/types/connection';
import { completePython } from '$lib/services/python-client';

// Both UDF cells and Python data cells use Monaco language id 'python', but
// want very different completions (UDF: fixed type-hint skeleton; data cell:
// jedi-backed completion against that notebook's warm worker) — keyed by
// model URI like dialectByModel below.
export type PythonCellContext = { kind: 'udf' } | { kind: 'data'; notebookId: string };
const pythonContextByModel = new Map<string, PythonCellContext>();

export function setModelPythonContext(model: Monaco.editor.ITextModel, context: PythonCellContext): void {
	pythonContextByModel.set(model.uri.toString(), context);
}

export function clearModelPythonContext(model: Monaco.editor.ITextModel): void {
	pythonContextByModel.delete(model.uri.toString());
}

export function getModelPythonContext(model: Monaco.editor.ITextModel): PythonCellContext | undefined {
	return pythonContextByModel.get(model.uri.toString());
}

// A completion candidate from the per-cell registry: "table.column" pairs or
// bare table/cell names, optionally carrying a type to show as completion detail.
export interface CompletionEntry {
	text: string;
	detail?: string;
}

// Completion providers are registered once per language, but completions are
// per cell — this registry maps a model URI to that cell's completion list.
const completionsByModel = new Map<string, CompletionEntry[]>();

export function setModelCompletions(model: Monaco.editor.ITextModel, items: CompletionEntry[]): void {
	completionsByModel.set(model.uri.toString(), items);
}

export function clearModelCompletions(model: Monaco.editor.ITextModel): void {
	completionsByModel.delete(model.uri.toString());
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

const SQL_KEYWORDS: string[] = (sqlMonarch as { keywords?: string[] }).keywords ?? [];

interface ColumnEntry {
	name: string;
	detail?: string;
}

function parseRegistry(
	items: CompletionEntry[]
): { tables: Map<string, ColumnEntry[]>; bare: CompletionEntry[] } {
	const tables = new Map<string, ColumnEntry[]>();
	const bare: CompletionEntry[] = [];
	for (const item of items) {
		if (!item.text) continue;
		const dot = item.text.indexOf('.');
		if (dot > 0 && dot < item.text.length - 1) {
			const table = item.text.slice(0, dot);
			const column = item.text.slice(dot + 1);
			let cols = tables.get(table);
			if (!cols) {
				cols = [];
				tables.set(table, cols);
			}
			if (!cols.some((c) => c.name === column)) cols.push({ name: column, detail: item.detail });
		} else {
			bare.push(item);
		}
	}
	return { tables, bare };
}

export function registerCompletions(monaco: typeof Monaco): void {
	for (const languageId of ['prql', 'sql'] as const) {
		monaco.languages.registerCompletionItemProvider(languageId, {
			triggerCharacters: ['.'],
			provideCompletionItems(model, position) {
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

				// Dot context: `table.|` → only that table's columns
				const lineBefore = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
				const dotMatch = lineBefore.match(/([A-Za-z_][\w]*|`[^`]+`)\.$/);
				if (dotMatch) {
					const cols = tables.get(dotMatch[1].replace(/`/g, ''));
					if (cols) {
						return {
							suggestions: cols.map((c) => ({
								label: c.name,
								kind: kinds.Field,
								insertText: c.name,
								detail: c.detail,
								range,
								sortText: '0' + c.name
							}))
						};
					}
					return { suggestions: [] };
				}

				// PRQL relation context: `from|join|append|intersect|remove <here>` →
				// only relations make sense, not transform keywords/builtins.
				if (languageId === 'prql') {
					const relationMatch = lineBefore.match(
						/\b(from|join|append|intersect|remove)\s+[\w.`]*$/i
					);
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
					detail?: string
				) => {
					if (seen.has(label)) return;
					seen.add(label);
					suggestions.push({
						label,
						kind,
						insertText: label,
						detail,
						range,
						sortText: sortPrefix + label
					});
				};

				for (const [table, cols] of tables) {
					push(table, kinds.Struct, '1');
					for (const c of cols) push(`${table}.${c.name}`, kinds.Field, '3', c.detail);
				}
				for (const b of bare) push(b.text, kinds.Variable, '2', b.detail);

				if (languageId === 'sql') {
					const dialect = getModelDialect(model);
					for (const fn of getSqlFunctionDocs(dialect)) {
						push(fn.name, kinds.Function, '4', fn.signature);
					}
					for (const kw of SQL_KEYWORDS) push(kw, kinds.Keyword, '5');
				} else {
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
				}

				return { suggestions };
			}
		});
	}

	registerPythonCompletions(monaco);
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
	'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
	'except', 'False', 'finally', 'for', 'from', 'if', 'import', 'in', 'is', 'lambda',
	'None', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield'
];
const PY_DATA_CELL_BARE = ['pd', 'go', 'result'];

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
				suggestions.push({ label, kind, insertText: label, detail, documentation, range, sortText: sortPrefix + label });
			};
			for (const name of PY_DATA_CELL_BARE) push(name, kinds.Variable, '0');
			for (const kw of PY_KEYWORDS) push(kw, kinds.Keyword, '3');

			const controller = new AbortController();
			token.onCancellationRequested(() => controller.abort());
			try {
				const items = await completePython(
					context.notebookId,
					model.getValue(),
					position.lineNumber,
					position.column - 1,
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
