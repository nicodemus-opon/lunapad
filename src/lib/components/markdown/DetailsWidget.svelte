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

<div class="md-details" class:is-open={isOpen}>
	<button
		type="button"
		class="md-details-summary"
		onclick={() => (isOpen = !isOpen)}
		aria-expanded={isOpen}
	>
		<ChevronRight
			class="md-details-chevron"
			style={isOpen ? 'transform: rotate(90deg)' : undefined}
			size={14}
		/>
		<span>{summary}</span>
	</button>
	{#if isOpen}
		<div class="md-details-body" transition:slide={{ duration: 220 }}>
			{@render children?.()}
		</div>
	{/if}
</div>

<style>
	:global(.md-details-chevron) {
		flex-shrink: 0;
		transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}
</style>
