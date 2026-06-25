import {
	javascriptDefaults,
	ScriptTarget,
	ModuleResolutionKind
} from 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import { getPlotExtraLibs } from './plot-dts';

/** Wires up real Plot.* autocomplete/hover/signature-help for plot cells (and,
 *  via the shared `custom` chart-config code box, the older single-result
 *  Plot-spec editor). `checkJs` is deliberately left off — plot cells are JS
 *  sketches, not type-checked TS, and we don't want red squiggles for not
 *  satisfying strict typing on what's meant to be quick exploratory code.
 *  `javascriptDefaults` is a module-level singleton independent of any
 *  `monaco.editor` instance, so this needs no `monaco` argument. */
export function registerPlotIntellisense(): void {
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
	for (const lib of getPlotExtraLibs()) {
		javascriptDefaults.addExtraLib(lib.content, lib.filePath);
	}
}
