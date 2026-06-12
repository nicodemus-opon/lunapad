import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { language as sqlMonarch } from 'monaco-editor/esm/vs/basic-languages/sql/sql.js';
import { PRQL_KEYWORDS, PRQL_BUILTINS } from './prql';

// Completion providers are registered once per language, but completions are
// per cell — this registry maps a model URI to that cell's completion list
// ("table.column" pairs plus bare table/keyword names).
const completionsByModel = new Map<string, string[]>();

export function setModelCompletions(model: Monaco.editor.ITextModel, items: string[]): void {
	completionsByModel.set(model.uri.toString(), items);
}

export function clearModelCompletions(model: Monaco.editor.ITextModel): void {
	completionsByModel.delete(model.uri.toString());
}

// SQL built-in function completions (dialect-agnostic core set)
const SQL_FUNCTIONS = [
	'abs',
	'avg',
	'ceil',
	'coalesce',
	'concat',
	'count',
	'current_date',
	'current_timestamp',
	'date_diff',
	'date_trunc',
	'extract',
	'floor',
	'greatest',
	'ifnull',
	'iif',
	'ilike',
	'least',
	'length',
	'like',
	'lower',
	'ltrim',
	'max',
	'min',
	'now',
	'nullif',
	'nvl',
	'replace',
	'round',
	'rtrim',
	'split_part',
	'strftime',
	'strpos',
	'substr',
	'sum',
	'to_char',
	'to_date',
	'to_timestamp',
	'trim',
	'upper',
	'variance',
	'stddev',
	'median',
	'mode',
	'percentile_cont',
	'percentile_disc',
	'row_number',
	'rank',
	'dense_rank',
	'lead',
	'lag',
	'first_value',
	'last_value',
	'ntile',
	'cast',
	'try_cast',
	'typeof',
	'exists',
	'any',
	'all'
];

const SQL_KEYWORDS: string[] = (sqlMonarch as { keywords?: string[] }).keywords ?? [];

function parseRegistry(items: string[]): { tables: Map<string, string[]>; bare: string[] } {
	const tables = new Map<string, string[]>();
	const bare: string[] = [];
	for (const item of items) {
		if (!item) continue;
		const dot = item.indexOf('.');
		if (dot > 0 && dot < item.length - 1) {
			const table = item.slice(0, dot);
			const column = item.slice(dot + 1);
			let cols = tables.get(table);
			if (!cols) {
				cols = [];
				tables.set(table, cols);
			}
			if (!cols.includes(column)) cols.push(column);
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
								label: c,
								kind: kinds.Field,
								insertText: c,
								range,
								sortText: '0' + c
							}))
						};
					}
					return { suggestions: [] };
				}

				const suggestions: Monaco.languages.CompletionItem[] = [];
				const seen = new Set<string>();
				const push = (
					label: string,
					kind: Monaco.languages.CompletionItemKind,
					sortPrefix: string
				) => {
					if (seen.has(label)) return;
					seen.add(label);
					suggestions.push({ label, kind, insertText: label, range, sortText: sortPrefix + label });
				};

				for (const [table, cols] of tables) {
					push(table, kinds.Struct, '1');
					for (const c of cols) push(`${table}.${c}`, kinds.Field, '3');
				}
				for (const b of bare) push(b, kinds.Variable, '2');

				if (languageId === 'sql') {
					for (const fn of SQL_FUNCTIONS) push(fn, kinds.Function, '4');
					for (const kw of SQL_KEYWORDS) push(kw, kinds.Keyword, '5');
				} else {
					for (const kw of PRQL_KEYWORDS) push(kw, kinds.Keyword, '4');
					for (const fn of PRQL_BUILTINS) push(fn, kinds.Function, '5');
				}

				return { suggestions };
			}
		});
	}
}
