<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
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

<Collapsible.Root bind:open={isOpen}>
	<div class="md-details" class:is-open={isOpen}>
		<Collapsible.Trigger class="md-details-summary" aria-expanded={isOpen}>
			<ChevronRight
				class="md-details-chevron"
				style={isOpen ? 'transform: rotate(90deg)' : undefined}
				size={14}
			/>
			<span>{summary}</span>
		</Collapsible.Trigger>
		<Collapsible.Content class="md-details-body">
			{@render children?.()}
		</Collapsible.Content>
	</div>
</Collapsible.Root>

<style>
	:global(.md-details-chevron) {
		flex-shrink: 0;
		transition: transform var(--motion-medium) var(--motion-ease-out);
	}
</style>
