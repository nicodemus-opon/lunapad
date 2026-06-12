// Ambient declarations for monaco deep-ESM imports that ship no .d.ts,
// and for Vite's `?worker` import suffix (vite/client types are not loadable
// here because tsconfig restricts typeRoots to node_modules/@types).

declare module 'monaco-editor/esm/vs/basic-languages/sql/sql.js' {
	import type { languages } from 'monaco-editor/esm/vs/editor/editor.api.js';
	export const conf: languages.LanguageConfiguration;
	export const language: languages.IMonarchLanguage & { keywords: string[] };
}

declare module '*?worker' {
	const workerConstructor: new (options?: { name?: string }) => Worker;
	export default workerConstructor;
}
