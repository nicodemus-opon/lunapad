/**
 * Browser-side SQL LSP client (disabled).
 *
 * MonacoLanguageClient requires vscode/localExtensionHost and throws
 * "Default api is not ready yet" in the browser. All SQL intellisense is
 * handled client-side in completions.ts / hover.ts / registerSqlSignatureHelp.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

let started = false;

export function startSqlLspClient(_monaco: typeof Monaco): void {
	if (started) return;
	started = true;
	void _monaco;
}
