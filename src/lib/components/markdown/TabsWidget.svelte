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
	<div class="md-tabs-strip notebook-tabs" role="tablist">
		{#each tabs as t, i (i)}
			<button
				type="button"
				class="notebook-tab"
				class:is-active={active === i}
				role="tab"
				aria-selected={active === i}
				onclick={() => (active = i)}
			>
				{t.attributes.label}
			</button>
		{/each}
	</div>
	<div class="md-tabs-panel" role="tabpanel">
		{#each activeChildren as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</div>
</div>
