import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { PRQL_DOCS } from './prql';
import { PY_TYPE_TO_TRINO } from '$lib/services/udf';
import { getSqlFunctionDoc } from './sql-dialects';
import { getModelDialect } from './completions';

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
		provideHover(model, position) {
			const word = model.getWordAtPosition(position);
			if (!word) return null;
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
