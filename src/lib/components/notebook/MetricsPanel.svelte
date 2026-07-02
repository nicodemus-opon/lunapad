<script lang="ts">
	import { buildMetricCatalog, filterCatalog } from '$lib/services/metric-catalog';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { BarChart3, Search } from '@lucide/svelte';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import EmptyState from '$lib/components/sidebar/EmptyState.svelte';

	interface Props {
		cells: Cell[];
		onInsertRef?: (ref: string) => void;
	}

	const { cells, onInsertRef }: Props = $props();

	let query = $state('');
	const catalog = $derived(buildMetricCatalog(cells));
	const filtered = $derived(filterCatalog(catalog, query));
</script>

<div class="flex h-full flex-col gap-2 p-2">
	<div class="relative">
		<Search class="absolute top-1.5 left-2 h-3.5 w-3.5 text-muted-foreground" />
		<input
			type="search"
			class="h-7 w-full rounded-md border bg-background pr-2 pl-7 text-xs"
			placeholder="Search metrics…"
			bind:value={query}
		/>
	</div>
	<div class="-mx-2 min-h-0 flex-1 overflow-y-auto" role="tree" aria-label="Metric catalog">
		{#if filtered.length === 0}
			<EmptyState
				description={query
					? 'No metrics match your search.'
					: 'Run query cells to populate the catalog.'}
			>
				{#snippet icon()}
					<BarChart3 class="h-4 w-4" />
				{/snippet}
			</EmptyState>
		{:else}
			{#each filtered as entry (entry.ref)}
				<TreeRow leafSpacer={false} onActivate={() => onInsertRef?.(entry.ref)}>
					{#snippet label()}
						<span class="min-w-0 flex-1 truncate font-mono text-xs">{entry.ref}</span>
					{/snippet}
					{#snippet trailing()}
						<span class="shrink-0 text-2xs text-muted-foreground">{entry.kind}</span>
					{/snippet}
				</TreeRow>
			{/each}
		{/if}
	</div>
</div>
