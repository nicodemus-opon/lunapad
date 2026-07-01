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
	class="flex h-7 shrink-0 items-center gap-3 border-t border-border/40 bg-muted/20 px-3 text-2xs text-muted-foreground select-none"
	role="status"
	aria-live="polite"
>
	<span class="min-w-0 truncate font-mono" title="Default connection">{connectionLabel}</span>

	<span class="mx-auto shrink-0 tabular-nums">
		{#if runningCount > 0}
			<span class="inline-flex items-center gap-1 text-foreground">
				<Loader2 class="h-3 w-3 animate-spin" />
				Running {runningCount}
			</span>
		{:else}
			Idle
		{/if}
	</span>

	<span class="flex shrink-0 items-center gap-1.5 tabular-nums">
		{cells.length} cell{cells.length === 1 ? '' : 's'}
		{#if staleCount > 0 && !reportView}
			<span class="text-muted-foreground/50">·</span>
			<button
				type="button"
				class="rounded-full bg-warning/15 px-1.5 py-0.5 font-medium text-warning transition-colors hover:bg-warning/25 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
				onclick={() => void runAllStale()}
			>
				{staleCount} stale
			</button>
		{/if}
	</span>
</div>
