<script lang="ts">
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { getNotebooks } from '$lib/stores/notebook.svelte';
	import { renderMarkdocCell, resolveBareVariablePath } from '$lib/services/markdoc-interp';
	import {
		activeExpressionToken,
		expressionSuggestions
	} from '$lib/services/markdoc-expression-suggestions';
	import Markdoc from '@markdoc/markdoc';

	interface Props {
		source: string;
		notebookId?: string;
		cells?: Cell[];
		selected?: boolean;
		onPatch?: (source: string) => void;
		onSelect?: () => void;
	}

	const { source, notebookId = '', cells = [], selected = false, onPatch, onSelect }: Props = $props();

	let editing = $state(false);
	let draft = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	// Resolve against the live cells for this notebook so inline values track
	// upstream query runs and filter changes without leaking across notebooks.
	const liveCells = $derived.by(() => {
		if (!notebookId) return cells;
		return getNotebooks().find((notebook) => notebook.id === notebookId)?.cells ?? cells;
	});

	function resolveBareVariable(inner: string, cells: Cell[]): string | null {
		const value = resolveBareVariablePath(inner, cells);
		if (value == null || typeof value === 'object') return null;
		return String(value);
	}

	const resolved = $derived.by(() => {
		const trimmed = source.trim();
		if (!trimmed.startsWith('{%')) {
			// Bare `$cell.field` chip (no annotation braces) — resolve it the same way
			// as an annotated `{% $cell.field %}` ref instead of showing it literally.
			const bare = resolveBareVariable(trimmed, liveCells);
			if (bare !== null) return { text: bare, error: false, raw: false };
			return { text: trimmed, error: false, raw: true };
		}
		const inner = trimmed
			.replace(/^\{%\s*/, '')
			.replace(/\s*%\}$/, '')
			.trim();
		const bare = resolveBareVariable(inner, liveCells);
		if (bare !== null) {
			return { text: bare, error: false, raw: false };
		}
		const result = renderMarkdocCell(trimmed, liveCells);
		if (result.errors.length) {
			return { text: result.errors[0] ?? trimmed, error: true, raw: false };
		}
		const node = result.tree[0];
		if (node == null || node === false) return { text: '—', error: false, raw: false };
		if (typeof node === 'string' || typeof node === 'number') {
			return { text: String(node), error: false, raw: false };
		}
		if (Markdoc.Tag.isTag(node)) {
			const text = (node.children ?? [])
				.map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
				.join('')
				.trim();
			return { text: text || '—', error: false, raw: false };
		}
		return { text: String(node), error: false, raw: false };
	});

	function startEdit() {
		if (!onPatch) return;
		onSelect?.();
		draft = source;
		editing = true;
		queueMicrotask(() => {
			inputEl?.focus();
			inputEl?.select();
		});
	}

	function commit() {
		if (!editing) return;
		const next = draft.trim();
		editing = false;
		if (next && next !== source) onPatch?.(next);
	}

	function cancel() {
		editing = false;
		draft = source;
	}

	// ── inline autocomplete (functions + cell/column refs) ───────────────
	let acOpen = $state(false);
	let acIndex = $state(0);
	let cursor = $state(0);

	const suggestions = $derived(acOpen ? expressionSuggestions(draft, cursor, liveCells) : []);

	function refreshAc() {
		cursor = inputEl?.selectionStart ?? draft.length;
		acOpen = expressionSuggestions(draft, cursor, liveCells).length > 0;
		acIndex = 0;
	}

	function applySuggestion(insert: string) {
		const { start } = activeExpressionToken(draft, cursor);
		draft = draft.slice(0, start) + insert + draft.slice(cursor);
		const nextCursor = start + insert.length;
		acOpen = false;
		queueMicrotask(() => {
			inputEl?.focus();
			inputEl?.setSelectionRange(nextCursor, nextCursor);
			cursor = nextCursor;
		});
	}
</script>

{#if editing}
	<span class="md-expr-editwrap">
		<input
			bind:this={inputEl}
			class="md-expr md-expr-input"
			class:is-error={resolved.error}
			type="text"
			bind:value={draft}
			size={Math.max(8, draft.length + 1)}
			onclick={(e) => e.stopPropagation()}
			onmousedown={(e) => e.stopPropagation()}
			oninput={refreshAc}
			onkeyup={(e) => {
				if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refreshAc();
			}}
			onkeydown={(e) => {
				e.stopPropagation();
				if (acOpen && suggestions.length) {
					if (e.key === 'ArrowDown') {
						e.preventDefault();
						acIndex = (acIndex + 1) % suggestions.length;
						return;
					}
					if (e.key === 'ArrowUp') {
						e.preventDefault();
						acIndex = (acIndex - 1 + suggestions.length) % suggestions.length;
						return;
					}
					if (e.key === 'Enter' || e.key === 'Tab') {
						e.preventDefault();
						applySuggestion(suggestions[acIndex].insert);
						return;
					}
					if (e.key === 'Escape') {
						e.preventDefault();
						acOpen = false;
						return;
					}
				}
				if (e.key === 'Enter') {
					e.preventDefault();
					commit();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					cancel();
				}
			}}
			onblur={() => {
				// Let a suggestion click land before committing.
				setTimeout(() => {
					if (editing) commit();
				}, 120);
			}}
		/>
		{#if acOpen && suggestions.length}
			<div class="md-expr-ac" role="listbox">
				{#each suggestions as s, i (s.insert + s.label)}
					<button
						type="button"
						role="option"
						aria-selected={i === acIndex}
						class="md-expr-ac-item"
						class:is-active={i === acIndex}
						onmousedown={(e) => {
							e.preventDefault();
							applySuggestion(s.insert);
						}}
						onmouseenter={() => (acIndex = i)}
					>
						<span class="md-expr-ac-label">{s.label}</span>
						<span class="md-expr-ac-detail">{s.detail}</span>
					</button>
				{/each}
			</div>
		{/if}
	</span>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<span
		class="md-expr"
		class:is-error={resolved.error}
		class:is-raw={resolved.raw}
		class:is-selected={selected}
		title={onPatch ? `${source} — click to edit` : source}
		data-source={source}
		onclick={(e) => {
			e.stopPropagation();
			startEdit();
		}}
	>
		{resolved.text}
	</span>
{/if}
