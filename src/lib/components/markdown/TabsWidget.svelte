<script lang="ts">
	import type { Tag } from '@markdoc/markdoc';
	import MarkdocNode from './MarkdocNode.svelte';

	interface Props {
		tabs: Tag[];
		notebookId?: string;
	}

	const { tabs, notebookId = '' }: Props = $props();

	let active = $state(0);

	const activeChildren = $derived(tabs[active]?.children ?? []);
</script>

<div class="md-tabs">
	<div class="md-tabs-strip" role="tablist">
		{#each tabs as t, i (i)}
			<button type="button" class="md-tab" class:active={active === i} role="tab" aria-selected={active === i} onclick={() => (active = i)}>
				{t.attributes.label}
			</button>
		{/each}
	</div>
	<div class="md-tabs-panel" role="tabpanel">
		{#each activeChildren as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</div>
</div>

<style>
	.md-tabs {
		margin: 0.5rem 0;
	}
	.md-tabs-strip {
		display: flex;
		gap: 0.2rem;
		border-bottom: 1px solid color-mix(in oklch, currentColor 12%, transparent);
	}
	.md-tab {
		padding: 0.4rem 0.75rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		font-size: 0.82em;
		font-weight: 600;
		opacity: 0.6;
		cursor: pointer;
		transition: opacity 130ms cubic-bezier(0.16, 1, 0.3, 1), border-color 130ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.md-tab:hover {
		opacity: 0.85;
	}
	.md-tab.active {
		opacity: 1;
		border-bottom-color: var(--chart-1, #3b82f6);
	}
	.md-tabs-panel {
		padding: 0.6rem 0;
	}
</style>
