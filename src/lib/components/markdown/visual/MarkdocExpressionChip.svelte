<script lang="ts">
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { getAllCellsAcrossNotebooks } from '$lib/stores/notebook.svelte';
	import { renderMarkdocCell, buildMarkdocVariables } from '$lib/services/markdoc-interp';
	import Markdoc from '@markdoc/markdoc';

	interface Props {
		source: string;
		cells?: Cell[];
	}

	const { source }: Props = $props();

	// Resolve against live store cells so inline values track upstream cell
	// results and filter changes exactly like the report renderer. The node view
	// mounts us once, so relying on a static `cells` snapshot would go stale.
	const liveCells = $derived(getAllCellsAcrossNotebooks());

	function resolveBareVariable(inner: string, cells: Cell[]): string | null {
		// A bare `$foo.bar.baz` variable. Markdoc only interpolates these when they
		// sit inline within surrounding content; parsed in isolation they annotate
		// nothing and render empty. Resolve the path directly so the visual chip
		// matches the report renderer (which renders the whole paragraph inline).
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
</script>

<span
	class="md-expr"
	class:is-error={resolved.error}
	class:is-raw={resolved.raw}
	title={source}
	data-source={source}
>
	{resolved.text}
</span>
