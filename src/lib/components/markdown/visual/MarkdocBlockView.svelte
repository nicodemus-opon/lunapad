<script lang="ts">
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Trash2 } from '@lucide/svelte';
	import FenceBlockView from './FenceBlockView.svelte';
	import { isFenceSource } from './fence-source';

	interface Props {
		source: string;
		cells: Cell[];
		notebookId?: string;
		selected?: boolean;
		onSelect?: () => void;
		onDelete?: () => void;
		onSourceChange?: (source: string) => void;
	}

	const {
		source,
		cells,
		notebookId = '',
		selected = false,
		onSelect,
		onDelete,
		onSourceChange
	}: Props = $props();

	const rendered = $derived(renderMarkdocCell(source, cells));
	const isFence = $derived(isFenceSource(source));
</script>

{#if isFence}
	<FenceBlockView
		{source}
		{selected}
		onSourceChange={(next) => onSourceChange?.(next)}
		{onSelect}
		{onDelete}
	/>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="markdoc-block-view group/mdb relative rounded-sm border transition-colors duration-(--motion-fast) {selected
			? 'border-ring bg-muted/10'
			: 'border-transparent hover:border-border hover:bg-muted/15'}"
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
			class="mdb-chrome absolute top-1 right-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-focus-within/mdb:opacity-100 group-hover/mdb:opacity-100 {selected
				? 'opacity-100'
				: ''}"
		>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				class="md-action md-action--danger"
				title="Delete widget"
				onclick={(e) => {
					e.stopPropagation();
					onDelete?.();
				}}
			>
				<Trash2 class="h-3 w-3" />
			</Button>
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
{/if}

<style>
	.markdoc-block-view {
		margin: 0.35rem 0;
	}
</style>
