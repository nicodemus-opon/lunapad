<script lang="ts">
	import { tick } from 'svelte';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import EmptyState from '$lib/components/sidebar/EmptyState.svelte';
	import { buildNotebookOutline, type OutlineEntry } from '$lib/services/notebook-outline';
	import { navigateToOutlineEntry, type Cell } from '$lib/stores/notebook.svelte';
	import { Code2, Hash, ListTree, Type } from '@lucide/svelte';
	import { cn } from '$lib/utils.js';

	let {
		notebookId,
		notebookName,
		cells,
		scrollContainer = null,
		showHeader = true
	}: {
		notebookId: string;
		notebookName: string;
		cells: Cell[];
		scrollContainer?: HTMLElement | null;
		/** Hide the internal title header when embedded under a panel that already labels it. */
		showHeader?: boolean;
	} = $props();

	const outline = $derived(buildNotebookOutline(cells));
	let activeOutlineId = $state<string | null>(null);

	function cellForEntry(entry: OutlineEntry): Cell | undefined {
		return cells.find((c) => c.id === entry.cellId);
	}

	function isDimmed(entry: OutlineEntry): boolean {
		const cell = cellForEntry(entry);
		return cell?.display === 'collapsed';
	}

	function iconForEntry(entry: OutlineEntry) {
		if (entry.kind === 'heading') return Hash;
		const cell = cellForEntry(entry);
		if (cell?.cellType === 'query' || cell?.cellType === 'python') return Code2;
		return Type;
	}

	$effect(() => {
		const root = scrollContainer;
		const entries = outline;
		if (!root || entries.length === 0) {
			activeOutlineId = null;
			return;
		}

		let observer: IntersectionObserver | null = null;
		let cancelled = false;

		void (async () => {
			await tick();
			if (cancelled) return;

			const mapped: { entry: OutlineEntry; el: Element }[] = [];
			for (const entry of entries) {
				const el = entry.anchorId
					? root.querySelector(`#${CSS.escape(entry.anchorId)}`)
					: root.querySelector(`[data-cell-id="${entry.cellId}"]`);
				if (el) mapped.push({ entry, el });
			}
			if (mapped.length === 0) return;

			observer = new IntersectionObserver(
				(observed) => {
					const visible = observed
						.filter((e) => e.isIntersecting)
						.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
					if (visible.length === 0) return;
					const match = mapped.find((m) => m.el === visible[0].target);
					if (match) activeOutlineId = match.entry.id;
				},
				{ root, rootMargin: '-8% 0px -75% 0px', threshold: [0, 0.1, 0.5, 1] }
			);
			for (const { el } of mapped) observer.observe(el);
		})();

		return () => {
			cancelled = true;
			observer?.disconnect();
		};
	});
</script>

{#if showHeader}
	<div class="flex h-9 shrink-0 items-center border-b border-border px-2">
		<span
			class="min-w-0 flex-1 truncate text-2xs font-medium text-muted-foreground"
			title={notebookName}
		>
			{notebookName}
		</span>
		{#if outline.length > 0}
			<span class="shrink-0 text-2xs text-muted-foreground/70">{outline.length}</span>
		{/if}
	</div>
{/if}

<div class="flex-1 overflow-y-auto py-1" role="tree" aria-label="Notebook outline">
	{#if outline.length === 0}
		<EmptyState
			description="Add markdown headings (# Title) or name your query cells to build an outline."
		>
			{#snippet icon()}
				<ListTree class="h-4 w-4" />
			{/snippet}
		</EmptyState>
	{:else}
		{#each outline as entry (entry.id)}
			{@const Icon = iconForEntry(entry)}
			<TreeRow
				depth={entry.level - 1}
				selected={activeOutlineId === entry.id}
				class={cn(isDimmed(entry) && 'opacity-50')}
				onActivate={() => navigateToOutlineEntry(notebookId, entry)}
			>
				{#snippet icon()}
					<Icon class="h-3 w-3 shrink-0 text-muted-foreground" />
				{/snippet}
				{#snippet label()}
					<span class="min-w-0 truncate text-xs">{entry.label}</span>
				{/snippet}
			</TreeRow>
		{/each}
	{/if}
</div>
