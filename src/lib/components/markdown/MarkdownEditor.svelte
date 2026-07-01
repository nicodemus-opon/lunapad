<script lang="ts" module>
	import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
	import type { FormatAction } from '$lib/components/markdown/MarkdownToolbar.svelte';

	export function executeFormat(
		editor: Monaco.editor.IStandaloneCodeEditor,
		m: typeof Monaco,
		action: FormatAction
	): void {
		const model = editor.getModel();
		if (!model) return;
		const sel = editor.getSelection();
		if (!sel) return;

		if (action.type === 'wrap') {
			const selectedText = model.getValueInRange(sel);
			if (
				selectedText.startsWith(action.prefix) &&
				selectedText.endsWith(action.suffix) &&
				selectedText.length >= action.prefix.length + action.suffix.length
			) {
				const inner = selectedText.slice(
					action.prefix.length,
					selectedText.length - action.suffix.length
				);
				editor.executeEdits('md-wrap', [{ range: sel, text: inner }]);
				editor.focus();
				return;
			}
			const inner = selectedText || (action.placeholder ?? '');
			const newText = action.prefix + inner + action.suffix;
			editor.executeEdits('md-wrap', [{ range: sel, text: newText }]);
			if (!selectedText && action.placeholder) {
				const insertOffset = model.getOffsetAt({
					lineNumber: sel.startLineNumber,
					column: sel.startColumn
				});
				const innerStart = model.getPositionAt(insertOffset + action.prefix.length);
				const innerEnd = model.getPositionAt(insertOffset + action.prefix.length + inner.length);
				editor.setSelection(m.Selection.fromPositions(innerStart, innerEnd));
			}
		} else if (action.type === 'line-prefix') {
			const startLine = sel.startLineNumber;
			const endLine = sel.endLineNumber;
			const lines: string[] = [];
			for (let i = startLine; i <= endLine; i++) {
				lines.push(model.getLineContent(i));
			}
			const allHavePrefix = lines.every((l) => l.startsWith(action.prefix));
			const newLines = allHavePrefix
				? lines.map((l) => l.slice(action.prefix.length))
				: lines.map((l) => action.prefix + l);
			const editRange: Monaco.IRange = {
				startLineNumber: startLine,
				startColumn: 1,
				endLineNumber: endLine,
				endColumn: model.getLineMaxColumn(endLine)
			};
			editor.executeEdits('md-prefix', [{ range: editRange, text: newLines.join('\n') }]);
		} else if (action.type === 'snippet') {
			editor.executeEdits('md-snippet', [{ range: sel, text: action.text }]);
			const insertOffset = model.getOffsetAt({
				lineNumber: sel.startLineNumber,
				column: sel.startColumn
			});
			const endPos = model.getPositionAt(insertOffset + action.text.length);
			editor.setPosition(endPos);
		}

		editor.focus();
	}

	export interface MarkdownEditorHandle {
		format: (action: FormatAction) => void;
		insertText: (text: string) => void;
		focus: () => void;
		isFocused: () => boolean;
	}
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { watchTheme } from '$lib/services/plotly-render.svelte';
	import { getListContinuation } from '$lib/services/markdown-format';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { LUNAPAD_MARKDOWN_LANG } from '$lib/monaco/lunapad-markdown';
	import { setMarkdownModelRefs, clearMarkdownModelRefs } from '$lib/monaco/markdown-completions';
	import {
		setMarkdownValidationCells,
		clearMarkdownValidationCells,
		scheduleMarkdownDiagnostics,
		clearMarkdownDiagnosticsTimer,
		updateMarkdownDiagnostics
	} from '$lib/monaco/markdown-diagnostics';
	import { shouldForwardFromMarkdownMonaco } from '$lib/keyboard/monaco-bridge';

	interface Props {
		value: string;
		onchange: (v: string) => void;
		/** Upstream query cells for $ completion */
		refEntries?: MarkdownRefEntry[];
		/** Cells used for Markdoc validation markers */
		cellsForValidation?: Cell[];
		handle?: MarkdownEditorHandle | null;
	}

	let {
		value,
		onchange,
		refEntries = [],
		cellsForValidation = [],
		handle = $bindable(null as MarkdownEditorHandle | null)
	}: Props = $props();

	let container: HTMLDivElement;
	let monacoRef: typeof Monaco | null = null;
	let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
	let model: Monaco.editor.ITextModel | null = null;
	let suppressUpdate = false;
	let destroyed = false;
	let modelUri = '';

	let isDark = $state(false);

	$effect(() => {
		void watchTheme();
		if (typeof document !== 'undefined') {
			isDark = document.documentElement.classList.contains('dark');
		}
	});
	$effect(() => {
		if (editor) editor.updateOptions({ theme: isDark ? 'lunapad-dark' : 'lunapad-light' });
	});

	$effect(() => {
		if (modelUri) {
			setMarkdownModelRefs(modelUri, refEntries);
			setMarkdownValidationCells(modelUri, cellsForValidation);
			if (monacoRef && model) updateMarkdownDiagnostics(monacoRef, model);
		}
	});

	$effect(() => {
		const v = value;
		if (editor && model && !suppressUpdate) {
			const current = model.getValue();
			if (current !== v) {
				suppressUpdate = true;
				model.pushEditOperations([], [{ range: model.getFullModelRange(), text: v }], () => null);
				suppressUpdate = false;
			}
		}
	});

	onMount(async () => {
		const mod = await import('$lib/monaco');
		if (destroyed) return;
		const m = mod.setupMonaco();
		monacoRef = m;

		model = m.editor.createModel(
			value,
			LUNAPAD_MARKDOWN_LANG,
			m.Uri.parse(`inmemory://markdown/${crypto.randomUUID()}.md`)
		);
		modelUri = model.uri.toString();
		setMarkdownModelRefs(modelUri, refEntries);
		setMarkdownValidationCells(modelUri, cellsForValidation);

		isDark = document.documentElement.classList.contains('dark');

		const ed = m.editor.create(container, {
			model,
			theme: isDark ? 'lunapad-dark' : 'lunapad-light',
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			automaticLayout: true,
			wordWrap: 'on',
			folding: false,
			lineNumbers: 'off',
			lineDecorationsWidth: 0,
			lineNumbersMinChars: 0,
			glyphMargin: false,
			renderLineHighlight: 'none',
			scrollbar: {
				vertical: 'hidden',
				horizontal: 'hidden',
				alwaysConsumeMouseWheel: false
			},
			overviewRulerLanes: 0,
			hideCursorInOverviewRuler: true,
			overviewRulerBorder: false,
			fontSize: 13.5,
			fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
			contextmenu: true,
			fixedOverflowWidgets: true,
			quickSuggestions: { other: true, comments: false, strings: true },
			suggestOnTriggerCharacters: true,
			tabSize: 2,
			padding: { top: 4, bottom: 4 },
			bracketPairColorization: { enabled: false },
			renderWhitespace: 'none'
		});

		editor = ed;
		updateMarkdownDiagnostics(m, model);

		ed.onDidChangeModelContent(() => {
			if (!suppressUpdate && model) {
				const v = model.getValue();
				suppressUpdate = true;
				onchange(v);
				suppressUpdate = false;
				scheduleMarkdownDiagnostics(m, model);
			}
		});

		ed.onDidContentSizeChange(() => {
			container.style.height = `${Math.max(80, ed.getContentHeight())}px`;
		});
		container.style.height = `${Math.max(80, ed.getContentHeight())}px`;

		ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyB, () =>
			executeFormat(ed, m, { type: 'wrap', prefix: '**', suffix: '**', placeholder: 'bold' })
		);
		ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyI, () =>
			executeFormat(ed, m, { type: 'wrap', prefix: '*', suffix: '*', placeholder: 'italic' })
		);
		ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyL, () =>
			executeFormat(ed, m, {
				type: 'wrap',
				prefix: '[',
				suffix: '](url)',
				placeholder: 'link text'
			})
		);
		ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Backquote, () =>
			executeFormat(ed, m, { type: 'wrap', prefix: '`', suffix: '`', placeholder: 'code' })
		);

		ed.addCommand(m.KeyCode.Enter, () => {
			const mdl = model;
			const sel = ed.getSelection();
			if (!mdl || !sel) {
				ed.trigger('keyboard', 'type', { text: '\n' });
				return;
			}
			const v = mdl.getValue();
			const ss = mdl.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn });
			const se = mdl.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn });
			const cont = getListContinuation({ value: v, selectionStart: ss, selectionEnd: se });
			if (!cont) {
				ed.trigger('keyboard', 'type', { text: '\n' });
				return;
			}
			if (cont.removeCurrentPrefix) {
				const ln = sel.startLineNumber;
				ed.executeEdits('list-cont', [
					{
						range: {
							startLineNumber: ln,
							startColumn: 1,
							endLineNumber: ln,
							endColumn: mdl.getLineMaxColumn(ln)
						},
						text: ''
					}
				]);
			} else {
				ed.executeEdits('list-cont', [{ range: sel, text: '\n' + cont.prefix }]);
				ed.setPosition({ lineNumber: sel.startLineNumber + 1, column: cont.prefix.length + 1 });
			}
		});

		ed.onKeyDown((e) => {
			const be = e.browserEvent;
			const widgetOpen = !!ed
				.getDomNode()
				?.querySelector(
					'.suggest-widget.visible, .find-widget.visible, .parameter-hints-widget.visible'
				);
			if (!shouldForwardFromMarkdownMonaco(be, widgetOpen)) return;
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

		handle = {
			format: (action) => {
				if (editor && monacoRef) executeFormat(editor, monacoRef, action);
			},
			insertText: (text) => {
				if (!editor) return;
				const sel = editor.getSelection();
				if (sel) {
					editor.executeEdits('insert', [{ range: sel, text }]);
					const mdl = editor.getModel();
					if (mdl) {
						const offset = mdl.getOffsetAt({
							lineNumber: sel.startLineNumber,
							column: sel.startColumn
						});
						const endPos = mdl.getPositionAt(offset + text.length);
						editor.setPosition(endPos);
					}
				}
				editor.focus();
			},
			focus: () => editor?.focus(),
			isFocused: () => editor?.hasTextFocus() ?? false
		};
	});

	onDestroy(() => {
		destroyed = true;
		if (modelUri) {
			clearMarkdownModelRefs(modelUri);
			clearMarkdownValidationCells(modelUri);
			clearMarkdownDiagnosticsTimer(modelUri);
		}
		model?.dispose();
		editor?.dispose();
	});
</script>

<div class="md-monaco-wrap">
	<div bind:this={container} class="md-monaco-editor"></div>
	{#if !value.trim()}
		<p class="md-placeholder">Type / for commands, or start writing…</p>
	{/if}
</div>

<style>
	.md-monaco-wrap {
		position: relative;
		width: 100%;
	}
	.md-monaco-editor {
		width: 100%;
		min-height: 80px;
	}
	.md-monaco-editor :global(.suggest-widget) {
		z-index: 100;
	}
	.md-placeholder {
		position: absolute;
		top: 4px;
		left: 4px;
		pointer-events: none;
		margin: 0;
		color: var(--muted-foreground);
		font-size: 13.5px;
		font-family:
			'Inter',
			system-ui,
			-apple-system,
			sans-serif;
		opacity: 0.5;
		white-space: nowrap;
		overflow: hidden;
	}
</style>
