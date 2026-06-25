// monaco-editor's ESM split build types `monaco.languages.typescript` as a
// deprecated `{ deprecated: true }` stub (see editor.api.d.ts) — the real API
// lives as plain named exports from the language contribution module itself,
// confirmed directly in its compiled JS (`export { ... javascriptDefaults,
// typescriptDefaults, ScriptTarget, ModuleResolutionKind, ... }`), but its own
// .d.ts is just `export {}`. These are runtime singletons, independent of any
// `monaco.editor.api` instance — only typed here for what this app actually
// calls, not Monaco's full internal surface.
declare module 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js' {
	export interface LunaTSCompilerOptions {
		allowJs?: boolean;
		checkJs?: boolean;
		allowNonTsExtensions?: boolean;
		target?: number;
		moduleResolution?: number;
	}
	export interface LunaTSDiagnosticsOptions {
		noSemanticValidation?: boolean;
		noSuggestionDiagnostics?: boolean;
	}
	export interface LunaTSExtraLibHandle {
		dispose(): void;
	}
	export interface LunaTSLanguageServiceDefaults {
		setCompilerOptions(options: LunaTSCompilerOptions): void;
		setDiagnosticsOptions(options: LunaTSDiagnosticsOptions): void;
		addExtraLib(content: string, filePath?: string): LunaTSExtraLibHandle;
	}
	export const javascriptDefaults: LunaTSLanguageServiceDefaults;
	export const typescriptDefaults: LunaTSLanguageServiceDefaults;
	export const ScriptTarget: Record<string, number>;
	export const ModuleResolutionKind: Record<string, number>;
}
