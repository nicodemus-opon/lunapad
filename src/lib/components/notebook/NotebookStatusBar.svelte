<script lang="ts">
	import {
		getActiveNotebookRunningCount,
		getActiveNotebookStaleCount,
		getCells,
		runAllStale
	} from '$lib/stores/notebook.svelte';
	import type { Connection } from '$lib/types/connection';
	import { BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';
	import { Loader2 } from '@lucide/svelte';
	import CellStatusChip from '$lib/components/cell/CellStatusChip.svelte';

	let {
		connections,
		defaultConnectionId,
		reportView = false
	}: {
		connections: Connection[];
		defaultConnectionId: string | null;
		reportView?: boolean;
	} = $props();

	const cells = $derived(getCells());
	const runningCount = $derived(getActiveNotebookRunningCount());
	const staleCount = $derived(getActiveNotebookStaleCount());
	const connectionLabel = $derived.by(() => {
		const id = defaultConnectionId ?? BUILTIN_DUCKDB_CONNECTION_ID;
		return connections.find((c) => c.id === id)?.name ?? 'DuckDB (built-in)';
	});
</script>

<div
	class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-muted/20 px-3 text-2xs text-muted-foreground select-none"
	role="status"
	aria-live="polite"
>
	<span class="min-w-0 truncate font-mono" title="Default connection">{connectionLabel}</span>

	<span class="mx-auto shrink-0 font-mono tabular-nums">
		{#if runningCount > 0}
			<span class="inline-flex items-center gap-1 text-foreground">
				<Loader2 class="h-3 w-3 animate-spin" />
				Running {runningCount}
			</span>
		{:else}
			Idle
		{/if}
	</span>

	<span class="flex shrink-0 items-center gap-1.5 font-mono tabular-nums">
		{cells.length} cell{cells.length === 1 ? '' : 's'}
		{#if staleCount > 0 && !reportView}
			<span class="text-muted-foreground/50">·</span>
			<CellStatusChip
				tone="warning"
				ariaLabel="Run all stale cells"
				onclick={() => void runAllStale()}
			>
				{#snippet label()}
					{staleCount} stale
				{/snippet}
			</CellStatusChip>
		{/if}
	</span>
</div>
