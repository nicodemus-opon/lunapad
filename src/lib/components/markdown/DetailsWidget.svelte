<script lang="ts">
	import { slide } from 'svelte/transition';
	import { ChevronRight } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		summary: string;
		open?: boolean;
		children?: Snippet;
	}

	const { summary, open = false, children }: Props = $props();

	// svelte-ignore state_referenced_locally -- intentional uncontrolled initial value, like native <details open>
	let isOpen = $state(open);
</script>

<div class="md-details">
	<button type="button" class="md-details-summary" onclick={() => (isOpen = !isOpen)} aria-expanded={isOpen}>
		<ChevronRight class="md-details-chevron" style={isOpen ? 'transform: rotate(90deg)' : undefined} size={14} />
		<span>{summary}</span>
	</button>
	{#if isOpen}
		<div class="md-details-body" transition:slide={{ duration: 220 }}>
			{@render children?.()}
		</div>
	{/if}
</div>

<style>
	.md-details {
		border: 1px solid color-mix(in oklch, currentColor 15%, transparent);
		border-radius: 0.395rem;
		margin: 0.5rem 0;
		overflow: hidden;
	}
	.md-details-summary {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.5rem 0.7rem;
		background: none;
		border: none;
		font-size: 0.85em;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
		transition: background-color 130ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.md-details-summary:hover {
		background: color-mix(in oklch, currentColor 4%, transparent);
	}
	:global(.md-details-chevron) {
		flex-shrink: 0;
		transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.md-details-body {
		padding: 0 0.7rem 0.7rem;
	}
</style>
