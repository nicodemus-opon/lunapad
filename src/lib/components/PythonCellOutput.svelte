<script lang="ts">
	import PlotlyView from './PlotlyView.svelte';
	import type { Cell } from '$lib/stores/notebook.svelte';

	interface Props {
		output: NonNullable<Cell['pythonOutput']>;
	}

	const { output }: Props = $props();
</script>

<div class="space-y-2">
	{#if output.error}
		<pre
			class="overflow-x-auto rounded-md border border-destructive/20 bg-destructive/5 p-2 font-mono text-xs leading-snug whitespace-pre-wrap text-destructive/90">{output.error}</pre>
	{/if}

	{#if output.stdout.trim()}
		<pre
			class="overflow-x-auto rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-xs leading-snug whitespace-pre-wrap text-muted-foreground">{output.stdout}</pre>
	{/if}

	{#if output.figures.length > 0}
		<div class="space-y-3">
			{#each output.figures as figureJson, i (i)}
				<PlotlyView {figureJson} />
			{/each}
		</div>
	{/if}
</div>
