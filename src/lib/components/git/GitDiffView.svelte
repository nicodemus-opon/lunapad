<script lang="ts">
	import { cn } from '$lib/utils.js';

	let { diff, loading = false }: { diff: string; loading?: boolean } = $props();

	function lineClass(line: string): string {
		if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted-foreground/60';
		if (line.startsWith('@@')) return 'text-chart-2';
		if (line.startsWith('+')) return 'bg-success/10 text-success';
		if (line.startsWith('-')) return 'bg-destructive/10 text-destructive';
		return 'text-muted-foreground';
	}
</script>

<div
	class="max-h-64 overflow-auto rounded border border-border bg-muted/20 font-mono text-3xs leading-5"
>
	{#if loading}
		<p class="px-2 py-3 text-center text-muted-foreground/60">Loading diff…</p>
	{:else if !diff.trim()}
		<p class="px-2 py-3 text-center text-muted-foreground/60">No changes</p>
	{:else}
		{#each diff.split('\n') as line}
			<div class={cn('px-2 whitespace-pre', lineClass(line))}>{line || ' '}</div>
		{/each}
	{/if}
</div>
