<script lang="ts">
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { Trash2 } from '@lucide/svelte';

	interface Props {
		source: string;
		cells: Cell[];
		notebookId?: string;
		selected?: boolean;
		onSelect?: () => void;
		onDelete?: () => void;
	}

	const {
		source,
		cells,
		notebookId = '',
		selected = false,
		onSelect,
		onDelete
	}: Props = $props();

	const rendered = $derived(renderMarkdocCell(source, cells));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="markdoc-block-view group/mdb relative rounded-md border transition-colors duration-(--motion-fast) {selected
		? 'border-ring/70 bg-muted/10'
		: 'border-transparent hover:border-border/60 hover:bg-muted/15'}"
	role="button"
	tabindex="0"
	onclick={(e) => {
		if ((e.target as HTMLElement).closest('.mdb-chrome')) return;
		onSelect?.();
	}}
	onkeydown={(e) => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		onSelect?.();
	}}
>
	<div
		class="mdb-chrome absolute top-1 right-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover/mdb:opacity-100 group-focus-within/mdb:opacity-100 {selected
			? 'opacity-100'
			: ''}"
	>
		<button
			type="button"
			class="rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
			title="Delete widget"
			onclick={(e) => {
				e.stopPropagation();
				onDelete?.();
			}}
		>
			<Trash2 class="h-3 w-3" />
		</button>
	</div>
	<div class="markdoc-block-preview px-1 py-0.5">
		<MarkdocRenderer
			content={rendered.tree}
			errors={rendered.errors}
			{notebookId}
			headingSlugPrefix=""
		/>
	</div>
</div>

<style>
	.markdoc-block-view {
		margin: 0.35rem 0;
	}
</style>
