<script lang="ts">
	import { buildMetricCatalog, filterCatalog } from '$lib/services/metric-catalog';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { Search } from '@lucide/svelte';

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
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if filtered.length === 0}
			<p class="px-1 text-2xs text-muted-foreground">Run query cells to populate the catalog.</p>
		{:else}
			<ul class="space-y-0.5">
				{#each filtered as entry (entry.ref)}
					<li>
						<button
							type="button"
							class="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60"
							onclick={() => onInsertRef?.(entry.ref)}
						>
							<span class="font-mono">{entry.ref}</span>
							<span class="ml-1 text-2xs text-muted-foreground">{entry.kind}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
