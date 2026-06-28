import {
	javascriptDefaults,
	ScriptTarget,
	ModuleResolutionKind
} from 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import { getPlotlyExtraLibs } from './plotly-dts';

/** Wires up `@types/plotly.js`-backed intellisense for plot cells (and, via
 *  the shared `custom` chart-config code box, the older single-result figure
 *  editor). `checkJs` is deliberately left off — this sandbox code is JS
 *  sketches, not type-checked TS, and returning a plain `{data, layout}`
 *  literal shouldn't need annotating to avoid red squiggles.
 *  `javascriptDefaults` is a module-level singleton independent of any
 *  `monaco.editor` instance, so this needs no `monaco` argument. */
export function registerPlotlyIntellisense(): void {
	javascriptDefaults.setCompilerOptions({
		allowJs: true,
		checkJs: false,
		allowNonTsExtensions: true,
		target: ScriptTarget.ES2020,
		moduleResolution: ModuleResolutionKind.NodeJs
	});
	javascriptDefaults.setDiagnosticsOptions({
		// No type-checking diagnostics for plot cells (see checkJs above) — keep
		// only the genuinely actionable syntax errors (e.g. unmatched braces).
		noSemanticValidation: true,
		noSuggestionDiagnostics: false
	});
	for (const lib of getPlotlyExtraLibs()) {
		javascriptDefaults.addExtraLib(lib.content, lib.filePath);
	}
}
