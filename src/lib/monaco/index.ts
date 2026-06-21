// Monaco singleton — slim ESM build: editor core + SQL/Python Monarch tokenizers only
// (no JSON/TS/CSS/HTML language services, so only the base editor worker is needed).
// Always load this module lazily from the client (await import('$lib/monaco')) —
// it touches `self` and must never run during SSR/prerender.
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';

import { registerPRQL } from './prql';
import { defineThemes } from './themes';
import { registerCompletions } from './completions';
import { registerHoverProviders } from './hover';
import { registerPrqlCodeActions } from './prql-actions';

export { monaco };
export {
	setModelCompletions,
	clearModelCompletions,
	setModelDialect,
	clearModelDialect
} from './completions';
export type { CompletionEntry } from './completions';

let initialized = false;

export function setupMonaco(): typeof monaco {
	if (initialized) return monaco;
	initialized = true;

	self.MonacoEnvironment = {
		getWorker: () => new EditorWorker()
	};

	registerPRQL(monaco);
	defineThemes(monaco);
	registerCompletions(monaco);
	registerHoverProviders(monaco);
	registerPrqlCodeActions(monaco);

	return monaco;
}
