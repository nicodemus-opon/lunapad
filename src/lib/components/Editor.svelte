<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { format as formatSQL, type SqlLanguage } from 'sql-formatter';
	import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
	import type { PRQLError } from '$lib/services/prql';
	import type { CellLanguage } from '$lib/stores/notebook.svelte';

	interface Props {
		code: string;
		onchange: (code: string) => void;
		errors?: PRQLError[];
		dark?: boolean;
		readonly?: boolean;
		completions?: string[];
		language?: CellLanguage;
		/** SQL dialect for formatter: 'duckdb' | 'postgresql' | 'clickhouse' */
		sqlDialect?: string;
	}

	let {
		code,
		onchange,
		errors = [],
		dark = false,
		readonly = false,
		completions = [],
		language = 'prql',
		sqlDialect = 'sql'
	}: Props = $props();

	let container: HTMLDivElement;
	let monaco = $state.raw<typeof Monaco | null>(null);
	let editor = $state.raw<Monaco.editor.IStandaloneCodeEditor | null>(null);
	let model: Monaco.editor.ITextModel | null = null;
	let setModelCompletions: ((m: Monaco.editor.ITextModel, items: string[]) => void) | null = null;
	let clearModelCompletions: ((m: Monaco.editor.ITextModel) => void) | null = null;
	let suppressUpdate = false;
	let destroyed = false;

	function themeName(isDark: boolean): string {
		return isDark ? 'lunapad-dark' : 'lunapad-light';
	}

	// Monaco intercepts these keys before they bubble; re-dispatch them on the
	// container so NotebookCell's handleKeydown stays the single source of truth.
	function shouldForwardKey(be: KeyboardEvent): boolean {
		const mod = be.metaKey || be.ctrlKey;
		if (be.key === 'Enter' && (be.shiftKey || mod)) return true;
		if (mod && be.shiftKey && (be.key.toLowerCase() === 'l' || be.key.toLowerCase() === 't'))
			return true;
		if (be.key === 'Escape' && !monacoWidgetOpen()) return true;
		return false;
	}

	function monacoWidgetOpen(): boolean {
		const dom = editor?.getDomNode();
		return !!dom?.querySelector(
			'.suggest-widget.visible, .find-widget.visible, .parameter-hints-widget.visible'
		);
	}

	function applyFullReplace(text: string, restoreSelection = true): void {
		if (!editor || !model) return;
		const sel = editor.getSelection();
		const anchorOffset = sel
			? model.getOffsetAt({
					lineNumber: sel.selectionStartLineNumber,
					column: sel.selectionStartColumn
				})
			: 0;
		const headOffset = sel
			? model.getOffsetAt({ lineNumber: sel.positionLineNumber, column: sel.positionColumn })
			: 0;
		// pushEditOperations (not setValue) preserves the undo stack
		model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
		if (restoreSelection) {
			const anchor = model.getPositionAt(Math.min(anchorOffset, text.length));
			const head = model.getPositionAt(Math.min(headOffset, text.length));
			editor.setSelection({
				selectionStartLineNumber: anchor.lineNumber,
				selectionStartColumn: anchor.column,
				positionLineNumber: head.lineNumber,
				positionColumn: head.column
			} as Monaco.ISelection);
		}
	}

	function formatCurrentSQL(): boolean {
		if (!editor || !model || language !== 'sql' || readonly) return false;
		const current = model.getValue();
		if (!current.trim()) return false;
		try {
			const dialectMap: Record<string, SqlLanguage> = {
				'sql.duckdb': 'sql',
				'sql.trino': 'trino',
				postgresql: 'postgresql',
				duckdb: 'sql'
			};
			const formatted = formatSQL(current, {
				language: dialectMap[sqlDialect] ?? 'sql',
				tabWidth: 2,
				keywordCase: 'upper',
				linesBetweenQueries: 1
			});
			if (formatted === current) return true;
			suppressUpdate = true;
			applyFullReplace(formatted);
			suppressUpdate = false;
			onchange(formatted);
		} catch {
			// leave as-is if formatter fails
		}
		return true;
	}

	onMount(async () => {
		const mod = await import('$lib/monaco');
		if (destroyed) return;
		const m = mod.setupMonaco();
		monaco = m;
		setModelCompletions = mod.setModelCompletions;
		clearModelCompletions = mod.clearModelCompletions;

		model = m.editor.createModel(
			code,
			language,
			m.Uri.parse(`inmemory://cell/${crypto.randomUUID()}.${language}`)
		);
		setModelCompletions(model, completions);

		const ed = m.editor.create(container, {
			model,
			theme: themeName(dark),
			readOnly: readonly,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			automaticLayout: true,
			wordWrap: 'off',
			folding: false,
			lineNumbers: 'on',
			lineDecorationsWidth: 8,
			lineNumbersMinChars: 3,
			glyphMargin: false,
			renderLineHighlight: 'all',
			scrollbar: {
				vertical: 'hidden',
				horizontal: 'auto',
				// critical: without this, page scrolling dies over every cell
				alwaysConsumeMouseWheel: false
			},
			overviewRulerLanes: 0,
			hideCursorInOverviewRuler: true,
			overviewRulerBorder: false,
			fontSize: 13.6,
			fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
			contextmenu: false,
			// suggest widget must escape the cell card's overflow clipping
			fixedOverflowWidgets: true,
			quickSuggestions: true,
			suggestOnTriggerCharacters: true,
			tabSize: 2,
			padding: { top: 6, bottom: 6 }
		});
		editor = ed;

		ed.onDidChangeModelContent(() => {
			if (!suppressUpdate && model) onchange(model.getValue());
		});

		ed.onDidContentSizeChange(() => {
			container.style.height = `${Math.max(80, ed.getContentHeight())}px`;
		});
		container.style.height = `${Math.max(80, ed.getContentHeight())}px`;

		ed.onDidBlurEditorWidget(() => {
			formatCurrentSQL();
		});

		ed.onKeyDown((e) => {
			const be = e.browserEvent;
			if (!shouldForwardKey(be)) return;
			e.preventDefault();
			e.stopPropagation();
			container.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: be.key,
					code: be.code,
					shiftKey: be.shiftKey,
					metaKey: be.metaKey,
					ctrlKey: be.ctrlKey,
					altKey: be.altKey,
					bubbles: true,
					cancelable: true
				})
			);
		});
	});

	onDestroy(() => {
		destroyed = true;
		if (model && clearModelCompletions) clearModelCompletions(model);
		editor?.dispose();
		model?.dispose();
		editor = null;
		model = null;
	});

	// Sync code prop → editor (if external change), keeping the cursor where it
	// was (clamped) — a full-doc replace otherwise resets the selection and
	// destroys typing flow.
	$effect(() => {
		if (!editor || !model) return;
		if (model.getValue() !== code) {
			suppressUpdate = true;
			applyFullReplace(code);
			suppressUpdate = false;
		}
	});

	// Sync dark → theme (global across instances; the whole app flips at once)
	$effect(() => {
		if (!monaco) return;
		monaco.editor.setTheme(themeName(dark));
	});

	// Sync readonly
	$effect(() => {
		editor?.updateOptions({ readOnly: readonly });
	});

	// Sync language (cells convert PRQL ↔ SQL)
	$effect(() => {
		if (!monaco || !model) return;
		monaco.editor.setModelLanguage(model, language);
	});

	// Sync completions → per-model registry
	$effect(() => {
		if (!model || !setModelCompletions) return;
		setModelCompletions(model, completions);
	});

	// Sync errors → markers (span offsets are UTF-16, same as getPositionAt)
	$effect(() => {
		if (!monaco || !model) return;
		const markers: Monaco.editor.IMarkerData[] = [];
		for (const e of errors) {
			if (!e.span) continue;
			const [from, to] = e.span;
			const start = model.getPositionAt(Math.min(from, to));
			const end = model.getPositionAt(Math.max(from, to));
			markers.push({
				severity: monaco.MarkerSeverity.Error,
				message: e.display ?? e.reason ?? 'Error',
				startLineNumber: start.lineNumber,
				startColumn: start.column,
				endLineNumber: end.lineNumber,
				endColumn: end.column
			});
		}
		monaco.editor.setModelMarkers(model, 'prql', markers);
	});

	export function focus(): void {
		editor?.focus();
	}

	export function format(): void {
		formatCurrentSQL();
	}

	export function insertAtCursor(text: string): void {
		if (!editor || !monaco) return;
		const sel = editor.getSelection();
		if (!sel) return;
		editor.executeEdits('insert', [{ range: sel, text, forceMoveMarkers: true }]);
		editor.focus();
	}
</script>

<div
	bind:this={container}
	class="editor-container code-editor relative text-sm"
	class:dark-editor={dark}
></div>

{#if errors.length > 0 && !errors[0].span}
	<p class="mt-1 text-xs text-destructive">{errors[0].display ?? errors[0].reason}</p>
{/if}

<style>
	.editor-container {
		min-height: 80px;
		border-radius: 0.375rem;
		overflow: hidden;
	}
	.editor-container :global(.monaco-editor),
	.editor-container :global(.monaco-editor .overflow-guard) {
		border-radius: 0.375rem;
	}
	.editor-container :global(.monaco-editor:focus-within) {
		outline: none;
	}
</style>
