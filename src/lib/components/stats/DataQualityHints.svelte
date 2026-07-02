<script lang="ts">
	import { AlertTriangle } from '@lucide/svelte';

	interface Props {
		hints: string[];
	}

	const { hints }: Props = $props();
</script>

{#if hints.length > 0}
	<div class="flex flex-wrap items-center gap-1.5">
		{#each hints as hint (hint)}
			<span
				class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
			>
				<AlertTriangle class="h-3 w-3 shrink-0 text-warning" />
				{hint}
			</span>
		{/each}
	</div>
{/if}
