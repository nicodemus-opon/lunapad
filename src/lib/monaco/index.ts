// Monaco singleton — editor core + SQL/Python Monarch tokenizers + the JS/TS
// language service (for plot cells' real Plot.* intellisense). Always load
// this module lazily from the client (await import('$lib/monaco')) — it
// touches `self` and must never run during SSR/prerender.
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import TSWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

import { registerPRQL } from './prql';
import { defineThemes } from './themes';
import { registerCompletions } from './completions';
import { registerHoverProviders } from './hover';
import { registerPrqlCodeActions } from './prql-actions';
import { registerPlotIntellisense } from './plot-intellisense';

export { monaco };
export {
	setModelCompletions,
	clearModelCompletions,
	setModelDialect,
	clearModelDialect
} from './completions';
export type { CompletionEntry } from './completions';
export { setModelPlotGlobals, clearModelPlotGlobals, activatePlotGlobals } from './plot-globals';

let initialized = false;

export function setupMonaco(): typeof monaco {
	if (initialized) return monaco;
	initialized = true;

	self.MonacoEnvironment = {
		getWorker: (_workerId: string, label: string) =>
			label === 'typescript' || label === 'javascript' ? new TSWorker() : new EditorWorker()
	};

	registerPRQL(monaco);
	defineThemes(monaco);
	registerCompletions(monaco);
	registerHoverProviders(monaco);
	registerPrqlCodeActions(monaco);
	registerPlotIntellisense();

	return monaco;
}
