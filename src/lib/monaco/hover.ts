import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { PRQL_DOCS } from './prql';
import { PY_TYPE_TO_TRINO } from '$lib/services/udf';
import { getSqlFunctionDoc } from './sql-dialects';
import {
	getModelDialect,
	getModelPythonContext,
	getModelCompletions,
	parseRegistry
} from './completions';
import { hoverPython } from '$lib/services/python-client';
import { formatDocstring } from '$lib/services/docstring-format';

export function registerHoverProviders(monaco: typeof Monaco): void {
	monaco.languages.registerHoverProvider('prql', {
		provideHover(model, position) {
			const word = model.getWordAtPosition(position);
			if (!word) return null;
			const doc = PRQL_DOCS[word.word];
			if (!doc) return null;
			return {
				range: new monaco.Range(
					position.lineNumber,
					word.startColumn,
					position.lineNumber,
					word.endColumn
				),
				contents: [{ value: `**${word.word}**\n\n${doc}` }]
			};
		}
	});

	monaco.languages.registerHoverProvider('python', {
		async provideHover(model, position, token) {
			const word = model.getWordAtPosition(position);
			if (!word) return null;
			const context = getModelPythonContext(model);

			if (!context || context.kind === 'udf') {
				const trinoType = PY_TYPE_TO_TRINO[word.word];
				if (!trinoType) return null;
				return {
					range: new monaco.Range(
						position.lineNumber,
						word.startColumn,
						position.lineNumber,
						word.endColumn
					),
					contents: [
						{ value: `**${word.word}** → \`${trinoType}\` (Trino UDF parameter/return type)` }
					]
				};
			}

			const controller = new AbortController();
			token.onCancellationRequested(() => controller.abort());
			try {
				const hover = await hoverPython(
					context.notebookId,
					model.getValue(),
					position.lineNumber,
					position.column - 1,
					controller.signal
				);
				if (!hover) return null;
				const doc = hover.doc ? formatDocstring(hover.doc) : '';
				return {
					range: new monaco.Range(
						position.lineNumber,
						word.startColumn,
						position.lineNumber,
						word.endColumn
					),
					contents: [{ value: `**${hover.signature}**${doc ? `\n\n${doc}` : ''}` }]
				};
			} catch {
				return null;
			}
		}
	});

	for (const langId of ['sql', 'trinosql', 'genericsql'] as const)
		monaco.languages.registerHoverProvider(langId, {
			provideHover(model, position) {
				const word = model.getWordAtPosition(position);
				if (!word) return null;
				const range = new monaco.Range(
					position.lineNumber,
					word.startColumn,
					position.lineNumber,
					word.endColumn
				);

				// Schema hover: table name → column list card; column name → type annotation.
				const { tables } = parseRegistry(getModelCompletions(model));
				const tableCols = tables.get(word.word);
				if (tableCols && tableCols.length > 0) {
					const body = tableCols
						.map((c) => `- \`${c.name}\`` + (c.detail ? ` *${c.detail}*` : ''))
						.join('\n');
					return { range, contents: [{ value: `**${word.word}**\n\n${body}` }] };
				}
				const lineText = model.getLineContent(position.lineNumber);
				const colPattern = new RegExp(`([A-Za-z_]\\w*)\\.(${word.word})\\b`);
				const colMatch = lineText.match(colPattern);
				if (colMatch) {
					const cols = tables.get(colMatch[1]);
					const col = cols?.find((c) => c.name === word.word);
					if (col?.detail) {
						return {
							range,
							contents: [{ value: `**${colMatch[1]}.${word.word}** — \`${col.detail}\`` }]
						};
					}
				}

				// Function hover from catalog.
				const dialect = getModelDialect(model);
				const fn = getSqlFunctionDoc(word.word.toLowerCase(), dialect);
				if (!fn) return null;
				return {
					range,
					contents: [{ value: `**${fn.signature}**\n\n${fn.doc}` }]
				};
			}
		});
}
