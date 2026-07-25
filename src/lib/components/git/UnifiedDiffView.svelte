<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { parseUnifiedDiff, type DiffRow } from '$lib/utils/unified-diff';

	let { diff, loading = false }: { diff: string; loading?: boolean } = $props();

	const parsed = $derived(parseUnifiedDiff(diff));

	function rowClass(kind: DiffRow['kind']): string {
		if (kind === 'added') return 'bg-diff-added/10';
		if (kind === 'removed') return 'bg-diff-removed/10';
		return '';
	}

	function markerClass(kind: DiffRow['kind']): string {
		if (kind === 'added') return 'text-diff-added';
		if (kind === 'removed') return 'text-diff-removed';
		return 'text-transparent';
	}
</script>

<div class="max-h-96 overflow-auto rounded border border-border bg-muted/20 font-mono text-xs">
	{#if loading}
		<p class="px-2 py-3 text-center text-muted-foreground/60">Loading diff…</p>
	{:else if parsed.isBinary}
		<p class="px-2 py-3 text-center text-muted-foreground/60">Binary file not shown</p>
	{:else if parsed.hunks.length === 0}
		<p class="px-2 py-3 text-center text-muted-foreground/60">No changes</p>
	{:else}
		{#each parsed.hunks as hunk, hunkIndex (hunkIndex)}
			{#if hunk.linesSkippedBefore > 0}
				<div
					class="border-y border-border/60 bg-muted/40 px-2 py-0.5 text-3xs text-muted-foreground/70"
				>
					⋯ {hunk.linesSkippedBefore} unchanged line{hunk.linesSkippedBefore === 1 ? '' : 's'}
				</div>
			{/if}
			<div class="bg-chart-2/10 px-2 py-0.5 text-3xs text-chart-2">
				@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
			</div>
			{#each hunk.rows as row, rowIndex (rowIndex)}
				<div class={cn('flex whitespace-pre', rowClass(row.kind))}>
					<span class="w-9 shrink-0 select-none pr-1.5 text-right text-muted-foreground/40"
						>{row.oldLine ?? ''}</span
					>
					<span class="w-9 shrink-0 select-none pr-1.5 text-right text-muted-foreground/40"
						>{row.newLine ?? ''}</span
					>
					<span class={cn('w-3 shrink-0 select-none text-center', markerClass(row.kind))}
						>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ''}</span
					>
					<span class="min-w-0 flex-1 pr-2 text-foreground/90">{row.text || ' '}</span>
				</div>
			{/each}
		{/each}
	{/if}
</div>
