<script lang="ts">
	import type { Tag } from '@markdoc/markdoc';
	import MarkdocNode from './MarkdocNode.svelte';
	import * as Tabs from '$lib/components/ui/tabs';

	interface Props {
		tabs: Tag[];
		notebookId?: string;
	}

	const { tabs, notebookId = '' }: Props = $props();

	let active = $state('tab-0');
</script>

<Tabs.Root bind:value={active} class="md-tabs">
	<Tabs.List class="md-tabs-strip">
		{#each tabs as t, i (i)}
			<Tabs.Trigger value={`tab-${i}`}>
				{t.attributes.label}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
	{#each tabs as t, tabIndex (tabIndex)}
		<Tabs.Content value={`tab-${tabIndex}`} class="md-tabs-panel">
			{#each t.children ?? [] as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
		</Tabs.Content>
	{/each}
</Tabs.Root>
