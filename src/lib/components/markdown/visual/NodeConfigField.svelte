<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		hint?: string;
		control?: Snippet;
	}

	const { label, hint, control }: Props = $props();
</script>

<div class="nc-row">
	<div class="nc-row-label">
		<span class="nc-label">{label}</span>
		{#if hint}
			<span class="nc-hint">{hint}</span>
		{/if}
	</div>
	<div class="nc-row-value">
		{#if control}
			{@render control()}
		{/if}
	</div>
</div>

<style>
	.nc-row {
		display: grid;
		grid-template-columns: minmax(5.5rem, 38%) minmax(0, 1fr);
		gap: 0.35rem 0.65rem;
		align-items: start;
		padding: 0.2rem 0.15rem;
		border-radius: var(--radius-sm);
		transition: background var(--motion-fast) var(--motion-ease-out);
	}
	.nc-row:hover {
		background: color-mix(in oklab, var(--muted) 16%, transparent);
	}
	.nc-row-label {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding-top: 0.2rem;
	}
	.nc-label {
		font-size: var(--text-2xs);
		font-weight: 500;
		color: var(--muted-foreground);
		line-height: 1.25;
	}
	.nc-hint {
		font-size: var(--text-3xs);
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
		line-height: 1.2;
	}
	.nc-row-value {
		min-width: 0;
	}
</style>
