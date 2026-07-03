<script lang="ts">
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { getAllCellsAcrossNotebooks } from '$lib/stores/notebook.svelte';
	import { renderMarkdocCell, buildMarkdocVariables } from '$lib/services/markdoc-interp';
	import Markdoc from '@markdoc/markdoc';

	interface Props {
		source: string;
		selected?: boolean;
		onPatch?: (source: string) => void;
		onSelect?: () => void;
	}

	const { source, selected = false, onPatch, onSelect }: Props = $props();

	let editing = $state(false);
	let draft = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	// Resolve against live store cells so inline values track upstream cell
	// results and filter changes exactly like the report renderer. The node view
	// mounts us once, so relying on a static `cells` snapshot would go stale.
	const liveCells = $derived(getAllCellsAcrossNotebooks());

	function resolveBareVariable(inner: string, cells: Cell[]): string | null {
		if (!/^\$[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(inner)) return null;
		const path = inner.slice(1).split('.');
		let cur: unknown = buildMarkdocVariables(cells);
		for (const key of path) {
			if (cur == null || typeof cur !== 'object') return null;
			cur = (cur as Record<string, unknown>)[key];
		}
		if (cur == null || typeof cur === 'object') return null;
		return String(cur);
	}

	const resolved = $derived.by(() => {
		const trimmed = source.trim();
		if (!trimmed.startsWith('{%')) {
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
</script>

{#if editing}
	<input
		bind:this={inputEl}
		class="md-expr md-expr-input"
		class:is-error={resolved.error}
		type="text"
		bind:value={draft}
		size={Math.max(8, draft.length + 1)}
		onclick={(e) => e.stopPropagation()}
		onmousedown={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Enter') {
				e.preventDefault();
				commit();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				cancel();
			}
		}}
		onblur={commit}
	/>
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
