import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { PRQL_DOCS } from './prql';
import { PY_TYPE_TO_TRINO } from '$lib/services/udf';
import { getSqlFunctionDoc } from './sql-dialects';
import { getModelDialect, getModelPythonContext } from './completions';
import { hoverPython } from '$lib/services/python-client';

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
					contents: [{ value: `**${word.word}** → \`${trinoType}\` (Trino UDF parameter/return type)` }]
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
				return {
					range: new monaco.Range(
						position.lineNumber,
						word.startColumn,
						position.lineNumber,
						word.endColumn
					),
					contents: [{ value: `**${hover.signature}**${hover.doc ? `\n\n${hover.doc}` : ''}` }]
				};
			} catch {
				return null;
			}
		}
	});

	monaco.languages.registerHoverProvider('sql', {
		provideHover(model, position) {
			const word = model.getWordAtPosition(position);
			if (!word) return null;
			const dialect = getModelDialect(model);
			const fn = getSqlFunctionDoc(word.word.toLowerCase(), dialect);
			if (!fn) return null;
			return {
				range: new monaco.Range(
					position.lineNumber,
					word.startColumn,
					position.lineNumber,
					word.endColumn
				),
				contents: [{ value: `**${fn.signature}**\n\n${fn.doc}` }]
			};
		}
	});
}
