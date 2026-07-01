// Monaco singleton — editor core + SQL/Python Monarch tokenizers + the JS/TS
// language service (for plot cells' Plotly intellisense). Always load
// this module lazily from the client (await import('$lib/monaco')) — it
// touches `self` and must never run during SSR/prerender.
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import TSWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

// Trino/generic SQL Monarch tokenizers from monaco-sql-languages
// (imported directly — no contribution/worker setup, so no side effects)
import {
	conf as trinoConf,
	language as trinoLanguage
} from 'monaco-sql-languages/esm/languages/trino/trino.js';
import {
	conf as genericConf,
	language as genericLanguage
} from 'monaco-sql-languages/esm/languages/generic/generic.js';

import { registerPRQL } from './prql';
import { registerLunapadMarkdown } from './lunapad-markdown';
import { defineThemes } from './themes';
import { registerCompletions, registerSqlSignatureHelp } from './completions';
import { registerGhostCompletions, setGhostInlineEditActive } from './ghost-completions';
import { registerHoverProviders } from './hover';
import { registerMarkdownCompletions } from './markdown-completions';
import { registerMarkdownHover } from './markdown-hover';
import { registerPrqlCodeActions } from './prql-actions';
import { registerPlotlyIntellisense } from './plotly-intellisense';
import { startSqlLspClient } from './sql-lsp-client';
import { setModelDialect } from './completions';
import type { ConnectionType } from '$lib/types/connection';

export { monaco };
export {
	setModelCompletions,
	clearModelCompletions,
	setModelDialect,
	clearModelDialect,
	setModelPythonContext,
	clearModelPythonContext,
	setModelPythonSchema,
	clearModelPythonSchema
} from './completions';
export { setGhostInlineEditActive } from './ghost-completions';
export type { CompletionEntry, PythonCellContext, PythonUpstreamSchema } from './completions';
export { setModelPlotGlobals, clearModelPlotGlobals, activatePlotGlobals } from './plot-globals';

let initialized = false;

// Dialect → Monaco language ID mapping.
// All external connections execute as Trino SQL; DuckDB is generic SQL.
function toLanguageId(connectionType: ConnectionType): 'trinosql' | 'genericsql' {
	return connectionType === 'duckdb-wasm' ? 'genericsql' : 'trinosql';
}

/**
 * Switch a SQL model to the correct dialect language ID and update the
 * catalog index for hover/completion. Call whenever a cell's connection changes.
 */
export function setSqlModelLanguage(
	model: monaco.editor.ITextModel,
	connectionType: ConnectionType
): void {
	const langId = toLanguageId(connectionType);
	if (model.getLanguageId() !== langId) {
		monaco.editor.setModelLanguage(model, langId);
	}
	setModelDialect(model, connectionType);
}

function registerSqlDialects(): void {
	// trinosql — all external (Trino-routed) connections
	monaco.languages.register({
		id: 'trinosql',
		extensions: ['.trinosql'],
		aliases: ['TrinoSQL', 'Trino']
	});
	monaco.languages.setLanguageConfiguration('trinosql', trinoConf);
	monaco.languages.setMonarchTokensProvider('trinosql', trinoLanguage);

	// genericsql — DuckDB builtin connection
	monaco.languages.register({ id: 'genericsql', extensions: ['.sql'], aliases: ['GenericSQL'] });
	monaco.languages.setLanguageConfiguration('genericsql', genericConf);
	monaco.languages.setMonarchTokensProvider('genericsql', genericLanguage);
}

export function setupMonaco(): typeof monaco {
	if (initialized) return monaco;
	initialized = true;

	self.MonacoEnvironment = {
		getWorker: (_workerId: string, label: string) =>
			label === 'typescript' || label === 'javascript' ? new TSWorker() : new EditorWorker()
	};

	registerSqlDialects();
	registerPRQL(monaco);
	registerLunapadMarkdown(monaco);
	defineThemes(monaco);
	registerCompletions(monaco);
	registerSqlSignatureHelp(monaco);
	registerGhostCompletions(monaco);
	registerHoverProviders(monaco);
	registerMarkdownCompletions(monaco);
	registerMarkdownHover(monaco);
	registerPrqlCodeActions(monaco);
	registerPlotlyIntellisense();
	startSqlLspClient(monaco);

	return monaco;
}
