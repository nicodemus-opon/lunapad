<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		formatDialect,
		sql as sqlDialectDef,
		postgresql as postgresqlDialectDef,
		trino as trinoDialectDef,
		type DialectOptions
	} from 'sql-formatter';
	import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
	import type { PRQLError } from '$lib/services/prql';
	import type { CellLanguage } from '$lib/stores/notebook.svelte';
	import type {
		CompletionEntry,
		PythonCellContext,
		PythonUpstreamSchema,
		SqlModelContext
	} from '$lib/monaco/completions';
	import type { ConnectionType } from '$lib/types/connection';
	import type { ExternalSchemaTable } from '$lib/stores/notebook.svelte';
	import { shouldForwardFromMonaco } from '$lib/keyboard/monaco-bridge';
	import { setGhostInlineEditActive } from '$lib/monaco/ghost-completions';

	export type EditorLanguage = CellLanguage | 'javascript' | 'python';

	interface Props {
		code: string;
		onchange: (code: string) => void;
		errors?: PRQLError[];
		dark?: boolean;
		readonly?: boolean;
		completions?: CompletionEntry[];
		language?: EditorLanguage;
		/** Only meaningful when language is 'python' — distinguishes UDF cells
		 * (fixed type-hint skeleton) from Python data cells (jedi-backed
		 * completion/hover against that notebook's warm worker). */
		pythonContext?: PythonCellContext;
		/** Ambient .d.ts text declaring this editor's JS sandbox globals (e.g. an
		 * upstream cell's outputName → {rows, columns}, for plot cells) — only
		 * meaningful when language is 'javascript'. See $lib/monaco/plot-globals.ts
		 * for why only the focused JS editor's globals are ever live. */
		plotGlobalsDts?: string;
		/** SQL dialect for formatter: 'duckdb' | 'postgresql' | 'clickhouse' */
		sqlDialect?: string;
		/** Drives dialect-specific SQL function completions/hover */
		connectionType?: ConnectionType;
		/** Connection id for recency ranking and FK-aware JOIN completion. */
		connectionId?: string;
		/** External schema tables for this connection (FK metadata for JOIN completion). */
		externalSchema?: ExternalSchemaTable[];
		/** Names of UDFs defined elsewhere in the notebook — told to the SQL
		 * formatter as known function names so it doesn't add a space before
		 * their call parens (it otherwise treats unrecognized identifiers as
		 * plain tokens, not function calls). */
		udfFunctionNames?: string[];
		/** Upstream cell schemas for Python data cells — each entry is a cell that
		 * has a result, with its outputName and column list. Fed into the ghost-text
		 * registry so completions can show "orders: id, status, amount" rather than
		 * guessing from jedi names. */
		pythonSchemas?: PythonUpstreamSchema[];
		/** `auto` grows to content height; `fill` fills the parent with internal scroll */
		layout?: 'auto' | 'fill';
	}

	let {
		code,
		onchange,
		errors = [],
		dark = false,
		readonly = false,
		completions = [],
		language = 'prql',
		sqlDialect = 'sql',
		connectionType = 'duckdb-wasm',
		connectionId,
		externalSchema = [],
		udfFunctionNames = [],
		plotGlobalsDts,
		pythonContext,
		pythonSchemas = [],
		layout = 'auto'
	}: Props = $props();

	let container: HTMLDivElement;
	let monaco = $state.raw<typeof Monaco | null>(null);
	let editor = $state.raw<Monaco.editor.IStandaloneCodeEditor | null>(null);
	let model: Monaco.editor.ITextModel | null = null;
	let setModelCompletions:
		| ((m: Monaco.editor.ITextModel, items: CompletionEntry[]) => void)
		| null = null;
	let clearModelCompletions: ((m: Monaco.editor.ITextModel) => void) | null = null;
	let setModelDialect: ((m: Monaco.editor.ITextModel, dialect: ConnectionType) => void) | null =
		null;
	let setSqlModelLanguage: ((m: Monaco.editor.ITextModel, dialect: ConnectionType) => void) | null =
		null;
	let setModelSqlContext: ((m: Monaco.editor.ITextModel, context: SqlModelContext) => void) | null =
		null;
	let clearModelDialect: ((m: Monaco.editor.ITextModel) => void) | null = null;
	let setModelPythonContext:
		| ((m: Monaco.editor.ITextModel, context: PythonCellContext) => void)
		| null = null;
	let clearModelPythonContext: ((m: Monaco.editor.ITextModel) => void) | null = null;
	let setModelPlotGlobals: ((m: Monaco.editor.ITextModel, dts: string) => void) | null = null;
	let clearModelPlotGlobals: ((m: Monaco.editor.ITextModel) => void) | null = null;
	let setModelPythonSchema:
		| ((m: Monaco.editor.ITextModel, schemas: PythonUpstreamSchema[]) => void)
		| null = null;
	let clearModelPythonSchema: ((m: Monaco.editor.ITextModel) => void) | null = null;
	let activatePlotGlobals: ((modelUri: string) => void) | null = null;
	let suppressUpdate = false;
	let previewLocked = false;
	let destroyed = false;

	function themeName(isDark: boolean): string {
		return isDark ? 'lunapad-dark' : 'lunapad-light';
	}

	// Monaco may consume some keys before they bubble; re-dispatch when the central
	// capture dispatcher cannot see them (see monaco-bridge.ts).

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
			const dialectMap: Record<string, DialectOptions> = {
				'sql.duckdb': sqlDialectDef,
				'sql.trino': trinoDialectDef,
				postgresql: postgresqlDialectDef,
				duckdb: sqlDialectDef
			};
			const baseDialect = dialectMap[sqlDialect] ?? sqlDialectDef;
			// Tell the formatter about UDFs defined elsewhere in the notebook so it
			// treats their names as known functions (no space before the call paren) —
			// otherwise it formats `mult(10)` as `mult (10)` like any other identifier.
			const dialect: DialectOptions =
				udfFunctionNames.length === 0
					? baseDialect
					: {
							...baseDialect,
							tokenizerOptions: {
								...baseDialect.tokenizerOptions,
								reservedFunctionNames: [
									...baseDialect.tokenizerOptions.reservedFunctionNames,
									...udfFunctionNames
								]
							}
						};
			const formatted = formatDialect(current, {
				dialect,
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
		setModelDialect = mod.setModelDialect;
		setModelSqlContext = mod.setModelSqlContext;
		setSqlModelLanguage = mod.setSqlModelLanguage;
		clearModelDialect = mod.clearModelDialect;
		setModelPythonContext = mod.setModelPythonContext;
		clearModelPythonContext = mod.clearModelPythonContext;
		setModelPlotGlobals = mod.setModelPlotGlobals;
		clearModelPlotGlobals = mod.clearModelPlotGlobals;
		setModelPythonSchema = mod.setModelPythonSchema;
		clearModelPythonSchema = mod.clearModelPythonSchema;
		activatePlotGlobals = mod.activatePlotGlobals;

		model = m.editor.createModel(
			code,
			language,
			m.Uri.parse(`inmemory://cell/${crypto.randomUUID()}.${language}`)
		);
		setModelCompletions(model, completions);
		if (language === 'sql') {
			setSqlModelLanguage?.(model, connectionType);
			setModelSqlContext?.(model, { connectionId, externalSchema });
		} else {
			setModelDialect(model, connectionType);
		}
		if (pythonContext) setModelPythonContext(model, pythonContext);
		if (pythonSchemas.length > 0) setModelPythonSchema(model, pythonSchemas);
		if (plotGlobalsDts != null) {
			setModelPlotGlobals(model, plotGlobalsDts);
			// Make this editor's globals live immediately on mount rather than
			// waiting for an explicit focus click — most plot cells are mounted
			// because the user just opened/added them.
			if (language === 'javascript' && activatePlotGlobals)
				activatePlotGlobals(model.uri.toString());
		}

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
				vertical: layout === 'fill' ? 'auto' : 'hidden',
				horizontal: 'auto',
				// critical: without this, page scrolling dies over every cell
				alwaysConsumeMouseWheel: false
			},
			overviewRulerLanes: 0,
			hideCursorInOverviewRuler: true,
			overviewRulerBorder: false,
			fontSize: 13.6,
			fontFamily:
				"'IBM Plex Mono','JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
			contextmenu: false,
			// suggest widget must escape the cell card's overflow clipping
			fixedOverflowWidgets: true,
			quickSuggestions: { other: true, comments: false, strings: false },
			suggestOnTriggerCharacters: true,
			// Word-based suggestions query the editor worker async and can leave the
			// suggest widget stuck on "Loading…" while our sync schema provider runs.
			wordBasedSuggestions: language === 'sql' ? 'off' : 'currentDocument',
			hover: { enabled: true, delay: 300 },
			inlineSuggest: { enabled: true },
			tabSize: 2,
			padding: { top: 6, bottom: 6 }
		});
		editor = ed;

		ed.onDidChangeModelContent(() => {
			if (!suppressUpdate && model) onchange(model.getValue());
		});

		if (layout === 'auto') {
			ed.onDidContentSizeChange(() => {
				container.style.height = `${Math.max(80, ed.getContentHeight())}px`;
			});
			container.style.height = `${Math.max(80, ed.getContentHeight())}px`;
		} else {
			container.style.height = '100%';
		}

		ed.onDidBlurEditorWidget(() => {
			formatCurrentSQL();
		});

		// JS sandbox globals (plot cells, and the `custom` chart-config code box)
		// share one live extraLib across all JS editors — make this one active
		// whenever it's focused. See $lib/monaco/plot-globals.ts.
		ed.onDidFocusEditorWidget(() => {
			if (language === 'javascript' && activatePlotGlobals && model) {
				activatePlotGlobals(model.uri.toString());
			}
		});

		ed.onKeyDown((e) => {
			const be = e.browserEvent;
			if (!shouldForwardFromMonaco(be, monacoWidgetOpen())) return;
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
		if (model && clearModelDialect) clearModelDialect(model);
		if (model && clearModelPythonContext) clearModelPythonContext(model);
		if (model && clearModelPlotGlobals) clearModelPlotGlobals(model);
		editor?.dispose();
		model?.dispose();
		editor = null;
		model = null;
	});

	// Sync code prop → editor (if external change), keeping the cursor where it
	// was (clamped) — a full-doc replace otherwise resets the selection and
	// destroys typing flow. Skipped while inline AI is previewing into the editor.
	$effect(() => {
		if (!editor || !model || previewLocked) return;
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

	// Sync layout mode (auto-grow vs fill parent)
	$effect(() => {
		if (!editor || !container) return;
		const fill = layout === 'fill';
		editor.updateOptions({
			scrollbar: {
				vertical: fill ? 'auto' : 'hidden',
				horizontal: 'auto',
				alwaysConsumeMouseWheel: false
			}
		});
		if (fill) {
			container.style.height = '100%';
		} else {
			container.style.height = `${Math.max(80, editor.getContentHeight())}px`;
		}
	});

	// Sync language + SQL dialect (cells convert PRQL ↔ SQL)
	$effect(() => {
		if (!monaco || !model) return;
		if (language === 'sql') {
			setSqlModelLanguage?.(model, connectionType);
		} else {
			monaco.editor.setModelLanguage(model, language);
			setModelDialect?.(model, connectionType);
		}
	});

	// Sync SQL context (connection id + FK metadata for JOIN completion)
	$effect(() => {
		if (!model || !setModelSqlContext || language !== 'sql') return;
		setModelSqlContext(model, { connectionId, externalSchema });
	});

	// Sync completions → per-model registry
	$effect(() => {
		if (!model || !setModelCompletions) return;
		setModelCompletions(model, completions);
	});

	// Sync python cell kind (udf vs data) → per-model registry
	$effect(() => {
		if (!model || !setModelPythonContext || !pythonContext) return;
		setModelPythonContext(model, pythonContext);
	});

	// Sync upstream DataFrame schemas → per-model registry (ghost completions)
	$effect(() => {
		if (!model || !setModelPythonSchema) return;
		setModelPythonSchema(model, pythonSchemas);
	});

	// Sync sandbox-globals dts → per-model registry (and the live extraLib, if
	// this editor happens to be the currently-focused one)
	$effect(() => {
		if (!model || !setModelPlotGlobals) return;
		setModelPlotGlobals(model, plotGlobalsDts ?? '');
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
				// prqlc's hint (e.g. "did you mean `derive`?") is otherwise never shown
				message: e.hint
					? `${e.display ?? e.reason ?? 'Error'}\n\n${e.hint}`
					: (e.display ?? e.reason ?? 'Error'),
				startLineNumber: start.lineNumber,
				startColumn: start.column,
				endLineNumber: end.lineNumber,
				endColumn: end.column
			});
		}
		monaco.editor.setModelMarkers(
			model,
			['sql', 'trinosql', 'genericsql'].includes(model.getLanguageId()) ? 'sql' : 'prql',
			markers
		);
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

	/** Update editor content without firing onchange — used for inline AI preview streaming. */
	export function setPreviewCode(text: string): void {
		if (!editor || !model) return;
		previewLocked = true;
		if (model.getValue() === text) return;
		suppressUpdate = true;
		applyFullReplace(text);
		suppressUpdate = false;
	}

	export function clearPreviewLock(): void {
		previewLocked = false;
	}

	/** Suspend ghost-text completions on this editor while inline AI is generating. */
	export function setInlineEditActive(active: boolean): void {
		if (!model) return;
		setGhostInlineEditActive(model.uri.toString(), active);
	}
</script>

<div
	bind:this={container}
	class="editor-container code-editor relative rounded-md border text-sm"
	class:dark-editor={dark}
	class:editor-fill={layout === 'fill'}
></div>

{#if errors.length > 0 && !errors[0].span}
	<p class="mt-1 text-xs text-destructive">{errors[0].display ?? errors[0].reason}</p>
{/if}

<style>
	.editor-container {
		min-height: 80px;

		overflow: hidden;
	}
	.editor-container.editor-fill {
		min-height: 0;
		height: 100%;
	}
	.editor-container :global(.monaco-editor),
	.editor-container :global(.monaco-editor .overflow-guard) {
		border-radius: 0.375rem;
	}
	.editor-container :global(.monaco-editor:focus-within) {
		outline: none;
	}
</style>
