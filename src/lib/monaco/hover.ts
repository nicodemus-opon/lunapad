import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { PRQL_DOCS } from './prql';
import { PY_TYPE_TO_TRINO } from '$lib/services/udf';
import { getSqlFunctionDoc } from './sql-dialects';
import {
	buildPythonIntelDescriptors,
	getModelDialect,
	getModelPythonContext,
	getModelPythonSchema,
	getModelPythonTableHints,
	getModelCompletions,
	parseRegistry
} from './completions';
import { formatTableHover, lookupTable, sqlIdentBeforeCursor } from './sql-schema-context';
import { findColumnInScope, getCachedSqlScope, resolveTableRef } from './sql-scope';
import { hoverPython } from '$lib/services/python-client';
import { formatDocstring } from '$lib/services/docstring-format';
import { formatPythonTableHintDoc } from '$lib/services/python-tables';

function columnHoverMarkdown(
	tableRef: string,
	columnName: string,
	col: { detail?: string; description?: string }
): string {
	const parts: string[] = [`**${tableRef}.${columnName}**`];
	if (col.detail) parts.push(`\`${col.detail}\``);
	if (col.description) parts.push(col.description);
	return parts.join('\n\n');
}

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
			const tableHints = getModelPythonTableHints(model);
			const upstreamSchemas = getModelPythonSchema(model);

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

			const lineText = model.getLineContent(position.lineNumber);
			if (word.word === 'tables') {
				return {
					range: new monaco.Range(
						position.lineNumber,
						word.startColumn,
						position.lineNumber,
						word.endColumn
					),
					contents: [
						{
							value:
								'**tables**\n\nWorkspace table namespace. Use `tables["schema.table"]`, `tables.load("catalog.schema.table")`, `tables.available()`, and `tables.find("name")`.'
						}
					]
				};
			}
			if (/tables\./.test(lineText.slice(0, word.startColumn - 1))) {
				if (word.word === 'load') {
					return {
						range: new monaco.Range(
							position.lineNumber,
							word.startColumn,
							position.lineNumber,
							word.endColumn
						),
						contents: [{ value: '**tables.load(name)**\n\nExplicit full-table load by canonical or alias name.' }]
					};
				}
				if (word.word === 'find') {
					return {
						range: new monaco.Range(
							position.lineNumber,
							word.startColumn,
							position.lineNumber,
							word.endColumn
						),
						contents: [{ value: '**tables.find(query)**\n\nSearch the current bounded table working set.' }]
					};
				}
				if (word.word === 'available') {
					return {
						range: new monaco.Range(
							position.lineNumber,
							word.startColumn,
							position.lineNumber,
							word.endColumn
						),
						contents: [{ value: '**tables.available()**\n\nList the current bounded table working set.' }]
					};
				}
				const staticHint = tableHints.find((hint) => hint.attributeAlias === word.word);
				if (staticHint) {
					return {
						range: new monaco.Range(
							position.lineNumber,
							word.startColumn,
							position.lineNumber,
							word.endColumn
						),
						contents: [{ value: formatPythonTableHintDoc(staticHint) }]
					};
				}
			}
			const upstreamSchema = upstreamSchemas.find((schema) => schema.name === word.word);
			if (upstreamSchema) {
				const columns = upstreamSchema.columns.slice(0, 10);
				return {
					range: new monaco.Range(
						position.lineNumber,
						word.startColumn,
						position.lineNumber,
						word.endColumn
					),
					contents: [
						{
							value:
								columns.length > 0
									? `**${upstreamSchema.name}**\n\nUpstream cell DataFrame.\n\nColumns:\n${columns.map((column) => `- \`${column}\``).join('\n')}`
									: `**${upstreamSchema.name}**\n\nUpstream cell DataFrame.`
						}
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
					buildPythonIntelDescriptors(tableHints, upstreamSchemas),
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
				try {
					return provideSqlHover(model, position, monaco);
				} catch (err) {
					console.warn('[sql-hover] provider error', err);
					return null;
				}
			}
		});
}

function provideSqlHover(
	model: Monaco.editor.ITextModel,
	position: Monaco.Position,
	monaco: typeof Monaco
): Monaco.languages.ProviderResult<Monaco.languages.Hover> {
	const lineText = model.getLineContent(position.lineNumber);
	const ident = sqlIdentBeforeCursor(lineText, position.column);
	const monacoWord = ident ? null : model.getWordAtPosition(position);
	if (!ident && !monacoWord) return null;
	const range = new monaco.Range(
		position.lineNumber,
		ident?.startColumn ?? monacoWord!.startColumn,
		position.lineNumber,
		ident ? position.column : monacoWord!.endColumn
	);
	const identText = ident?.text ?? monacoWord!.word;

	const dialect = getModelDialect(model);
	const scope = getCachedSqlScope(model.uri.toString(), model.getValue(), dialect);
	const { tables } = parseRegistry(getModelCompletions(model));

	// Qualified names may be `schema.table` (registry key) or `alias.column`.
	if (ident?.parts && ident.parts.length >= 2) {
		const asTable = lookupTable(tables, identText);
		if (asTable && asTable.length > 0) {
			return {
				range,
				contents: [{ value: formatTableHover(identText, asTable) }]
			};
		}

		const columnName = ident.parts[ident.parts.length - 1]!;
		const tableRef = ident.parts.slice(0, -1).join('.');
		const resolvedRef = resolveTableRef(scope, tableRef) ?? tableRef;
		const col =
			findColumnInScope(scope, tables, tableRef, columnName) ??
			findColumnInScope(scope, tables, resolvedRef, columnName);
		if (col) {
			return {
				range,
				contents: [{ value: columnHoverMarkdown(resolvedRef, columnName, col) }]
			};
		}
	}

	const resolvedTable = resolveTableRef(scope, identText) ?? identText;
	const tableCols = lookupTable(tables, resolvedTable);
	if (tableCols && tableCols.length > 0) {
		return {
			range,
			contents: [{ value: formatTableHover(resolvedTable, tableCols) }]
		};
	}

	const fnName = identText.split('.').pop() ?? identText;
	const fn = getSqlFunctionDoc(fnName.toLowerCase(), dialect);
	if (!fn) return null;
	return {
		range,
		contents: [{ value: `**${fn.signature}**\n\n${fn.doc}` }]
	};
}
