<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { EditorView, basicSetup } from 'codemirror';
	import { keymap } from '@codemirror/view';
	import { sql } from '@codemirror/lang-sql';

	import { EditorState, StateEffect, StateField, Compartment } from '@codemirror/state';
	import { Decoration, type DecorationSet } from '@codemirror/view';
	import { type Range } from '@codemirror/state';
	import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
	import { tags } from '@lezer/highlight';
	import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
	import { format as formatSQL, type SqlLanguage } from 'sql-formatter';
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

	let { code, onchange, errors = [], dark = false, readonly = false, completions = [], language = 'prql', sqlDialect = 'sql' }: Props = $props();

	let container: HTMLDivElement;
	let view: EditorView | null = null;
	let suppressUpdate = false;

	// ── Compartments — allow hot-swapping extensions without destroying the editor ──
	const themeCompartment = new Compartment();
	const highlightCompartment = new Compartment();
	const schemaCompartment = new Compartment();
	const readonlyCompartment = new Compartment();

	// ── Error decorations via StateEffect + StateField ────────────────────────────
	const setErrorsEffect = StateEffect.define<PRQLError[]>();

	function makeErrorDecorations(errs: PRQLError[]): DecorationSet {
		const decorations: Range<Decoration>[] = [];
		for (const e of errs) {
			if (e.span) {
				const [from, to] = e.span;
				decorations.push(
					Decoration.mark({ class: 'cm-prql-error' }).range(
						Math.min(from, to),
						Math.max(from, to)
					)
				);
			}
		}
		return Decoration.set(decorations, true);
	}

	const errorDecorationField = StateField.define<DecorationSet>({
		create() { return Decoration.none; },
		update(deco, tr) {
			for (const effect of tr.effects) {
				if (effect.is(setErrorsEffect)) return makeErrorDecorations(effect.value);
			}
			return deco.map(tr.changes);
		},
		provide: f => EditorView.decorations.from(f),
	});

	// ── Theme that reads app CSS variables ────────────────────────────────────────
	function buildTheme(isDark: boolean) {
		return EditorView.theme(
			{
				'&': {
					backgroundColor: 'transparent',
					color: 'var(--card-foreground)',
					borderRadius: '0.375rem',
				},
				'.cm-content': {
					caretColor: 'var(--card-foreground)',
					fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
				},
				'.cm-cursor': {
					borderLeftColor: 'var(--card-foreground)',
				},
				'&.cm-focused .cm-cursor': {
					borderLeftColor: 'var(--card-foreground)',
				},
				'.cm-gutters': {
					backgroundColor: 'transparent',
					color: 'var(--muted-foreground)',
					border: 'none',
				},
				'.cm-activeLineGutter': {
					backgroundColor: 'var(--accent)',
					color: 'var(--accent-foreground)',
				},
				'.cm-activeLine': {
					backgroundColor: 'var(--accent)',
				},
				'&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
					backgroundColor: isDark ? 'oklch(1 0 0 / 15%)' : 'oklch(0 0 0 / 10%)',
				},
				'.cm-matchingBracket, .cm-nonmatchingBracket': {
					backgroundColor: isDark ? 'oklch(1 0 0 / 15%)' : 'oklch(0 0 0 / 10%)',
					outline: '1px solid var(--ring)',
				},
				'.cm-searchMatch': {
					backgroundColor: isDark ? 'oklch(0.8 0.15 85 / 30%)' : 'oklch(0.8 0.15 85 / 40%)',
					outline: '1px solid oklch(0.7 0.15 85)',
				},
				'.cm-searchMatch.cm-searchMatch-selected': {
					backgroundColor: isDark ? 'oklch(0.7 0.18 85 / 50%)' : 'oklch(0.7 0.18 85 / 60%)',
				},
				'.cm-tooltip': {
					backgroundColor: 'var(--popover)',
					color: 'var(--popover-foreground)',
					border: '1px solid var(--border)',
					borderRadius: '0.375rem',
				},
				'.cm-tooltip-autocomplete > ul > li[aria-selected]': {
					backgroundColor: 'var(--accent)',
					color: 'var(--accent-foreground)',
				},
			},
			{ dark: isDark }
		);
	}

	function buildHighlightStyle(isDark: boolean) {
		return HighlightStyle.define([
			{ tag: tags.keyword, color: isDark ? 'var(--color-chart-1)' : 'var(--color-chart-1)', fontWeight: 'bold' },
			{ tag: tags.string, color: isDark ? '#86efac' : '#16a34a' },
			{ tag: tags.number, color: isDark ? '#fb923c' : '#c2410c' },
			{ tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
			{ tag: tags.operator, color: isDark ? '#f9a8d4' : '#db2777' },
			{ tag: tags.typeName, color: isDark ? '#67e8f9' : '#0e7490' },
			{ tag: tags.variableName, color: 'var(--foreground)' },
			{ tag: tags.punctuation, color: 'var(--muted-foreground)' },
		]);
	}

	function buildSqlExt() {
		const sqlSchema: Record<string, string[]> = {};
		for (const item of completions) {
			if (!item || !item.includes('.')) continue;
			const [table, column] = item.split('.', 2);
			if (!table || !column) continue;
			if (!sqlSchema[table]) sqlSchema[table] = [];
			if (!sqlSchema[table].includes(column)) sqlSchema[table].push(column);
		}
		return sql({ schema: sqlSchema });
	}

	// SQL built-in function completions (dialect-agnostic core set)
	const SQL_FUNCTIONS = [
		'abs','avg','ceil','coalesce','concat','count','current_date','current_timestamp',
		'date_diff','date_trunc','extract','floor','greatest','ifnull','iif','ilike','least',
		'length','like','lower','ltrim','max','min','now','nullif','nvl','replace','round',
		'rtrim','split_part','strftime','strpos','substr','sum','to_char','to_date','to_timestamp',
		'trim','upper','variance','stddev','median','mode','percentile_cont','percentile_disc',
		'row_number','rank','dense_rank','lead','lag','first_value','last_value','ntile',
		'over','partition','within','filter','distinct','case','when','then','else','end',
		'cast','try_cast','typeof','is null','is not null','between','in','not in',
		'exists','any','all','union','intersect','except',
	];

	function sqlFunctionCompletions(context: CompletionContext): CompletionResult | null {
		if (language !== 'sql') return null;
		const word = context.matchBefore(/\w*/);
		if (!word || (word.from === word.to && !context.explicit)) return null;
		const options = SQL_FUNCTIONS
			.filter(fn => fn.startsWith(word.text.toLowerCase()))
			.map(fn => ({ label: fn, type: 'function', boost: -1 }));
		if (options.length === 0) return null;
		return { from: word.from, options };
	}

	function formatCurrentSQL(): boolean {
		if (!view || language !== 'sql' || readonly) return false;
		const current = view.state.doc.toString();
		if (!current.trim()) return false;
		try {
			const dialectMap: Record<string, SqlLanguage> = {
				'sql.duckdb': 'sql',
				'sql.trino': 'trino',
				'postgresql': 'postgresql',
				'duckdb': 'sql',
			};
			const formatted = formatSQL(current, {
				language: dialectMap[sqlDialect] ?? 'sql',
				tabWidth: 2,
				keywordCase: 'upper',
				linesBetweenQueries: 1,
			});
			suppressUpdate = true;
			view.dispatch({
				changes: { from: 0, to: current.length, insert: formatted }
			});
			suppressUpdate = false;
			onchange(formatted);
		} catch {
			// leave as-is if formatter fails
		}
		return true;
	}

	function buildExtensions(isDark: boolean, isReadonly: boolean) {
		return [
			basicSetup,
			schemaCompartment.of(buildSqlExt()),
			autocompletion({ override: [sqlFunctionCompletions] }),
			themeCompartment.of(buildTheme(isDark)),
			highlightCompartment.of(syntaxHighlighting(buildHighlightStyle(isDark))),
			EditorView.updateListener.of((update) => {
				if (update.docChanged && !suppressUpdate) {
					onchange(update.state.doc.toString());
				}
			}),
			EditorView.domEventHandlers({
				blur: () => { formatCurrentSQL(); return false; },
			}),
			readonlyCompartment.of(isReadonly ? EditorState.readOnly.of(true) : []),
			errorDecorationField,
		];
	}

	onMount(() => {
		view = new EditorView({
			doc: code,
			extensions: buildExtensions(dark, readonly),
			parent: container
		});
	});

	onDestroy(() => {
		view?.destroy();
	});

	// Sync code prop → editor (if external change)
	$effect(() => {
		if (!view) return;
		const current = view.state.doc.toString();
		if (current !== code) {
			suppressUpdate = true;
			view.dispatch({
				changes: { from: 0, to: current.length, insert: code }
			});
			suppressUpdate = false;
		}
	});

	// Sync dark/readonly → theme compartments (no editor rebuild)
	$effect(() => {
		if (!view) return;
		view.dispatch({
			effects: [
				themeCompartment.reconfigure(buildTheme(dark)),
				highlightCompartment.reconfigure(syntaxHighlighting(buildHighlightStyle(dark))),
				readonlyCompartment.reconfigure(readonly ? EditorState.readOnly.of(true) : []),
			]
		});
	});

	// Sync completions → SQL schema compartment (no editor rebuild)
	$effect(() => {
		if (!view) return;
		view.dispatch({ effects: schemaCompartment.reconfigure(buildSqlExt()) });
	});

	// Sync errors → error decoration field
	$effect(() => {
		if (!view) return;
		view.dispatch({ effects: setErrorsEffect.of(errors) });
	});

	export function focus(): void {
		view?.focus();
	}

	export function format(): void {
		formatCurrentSQL();
	}

	export function insertAtCursor(text: string): void {
		if (!view) return;
		const { from } = view.state.selection.main;
		view.dispatch({
			changes: { from, to: from, insert: text },
			selection: { anchor: from + text.length }
		});
		view.focus();
	}
</script>

<div bind:this={container} class="editor-container relative text-sm" class:dark-editor={dark}></div>

{#if errors.length > 0 && !errors[0].span}
	<p class="mt-1 text-xs text-destructive">{errors[0].display ?? errors[0].reason}</p>
{/if}

<style>
	.editor-container :global(.cm-editor) {
		height: 100%;
		min-height: 80px;
		border-radius: 0.375rem;
		font-size: 0.85rem;
	}
	.editor-container :global(.cm-focused) {
		outline: none;
	}
	.editor-container :global(.cm-prql-error) {
		text-decoration: underline wavy #ef4444;
		text-underline-offset: 3px;
	}
	.editor-container :global(.cm-scroller) {
		font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
	}
</style>
