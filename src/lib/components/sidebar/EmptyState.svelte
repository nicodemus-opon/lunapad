<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		description,
		icon,
		actions
	}: {
		description: string;
		icon?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center gap-2 px-4 py-8 text-center">
	{#if icon}
		<div
			class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"
		>
			{@render icon()}
		</div>
	{/if}
	<p class="max-w-52 text-xs leading-relaxed text-muted-foreground">{description}</p>
	{#if actions}
		<div class="mt-1 flex items-center gap-1.5">
			{@render actions()}
		</div>
	{/if}
</div>
