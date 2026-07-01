import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { Cell } from '$lib/stores/notebook.svelte';
import { validateMarkdocMarkdown } from '$lib/services/markdoc-interp';

const cellsByModel = new Map<string, Cell[]>();

export function setMarkdownValidationCells(modelUri: string, cells: Cell[]): void {
	cellsByModel.set(modelUri, cells);
}

export function clearMarkdownValidationCells(modelUri: string): void {
	cellsByModel.delete(modelUri);
}

export function updateMarkdownDiagnostics(m: typeof Monaco, model: Monaco.editor.ITextModel): void {
	const cells = cellsByModel.get(model.uri.toString()) ?? [];
	const diagnostics = validateMarkdocMarkdown(model.getValue(), cells);
	const markers: Monaco.editor.IMarkerData[] = diagnostics.map((d) => ({
		severity: m.MarkerSeverity.Warning,
		message: d.message,
		startLineNumber: d.line,
		startColumn: d.column,
		endLineNumber: d.endLine ?? d.line,
		endColumn: d.endColumn ?? d.column + 1
	}));
	m.editor.setModelMarkers(model, 'markdoc', markers);
}

let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleMarkdownDiagnostics(
	m: typeof Monaco,
	model: Monaco.editor.ITextModel,
	delayMs = 300
): void {
	const uri = model.uri.toString();
	const existing = debounceTimers.get(uri);
	if (existing) clearTimeout(existing);
	debounceTimers.set(
		uri,
		setTimeout(() => {
			debounceTimers.delete(uri);
			updateMarkdownDiagnostics(m, model);
		}, delayMs)
	);
}

export function clearMarkdownDiagnosticsTimer(modelUri: string): void {
	const existing = debounceTimers.get(modelUri);
	if (existing) clearTimeout(existing);
	debounceTimers.delete(modelUri);
}
