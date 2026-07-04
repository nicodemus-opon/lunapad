<script lang="ts">
	import { Link2 } from '@lucide/svelte';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import { findNotebookBacklinks } from '$lib/services/notebook-backlinks';
	import { getNotebooks, openNotebookTabAtCell } from '$lib/stores/notebook.svelte';

	interface Props {
		notebookId: string;
	}

	const { notebookId }: Props = $props();

	const backlinks = $derived(findNotebookBacklinks(notebookId, getNotebooks()));
</script>

{#if backlinks.length > 0}
	<div class="sidebar-panel-footer">
		<p class="sidebar-section-label flex items-center gap-1.5">
			<Link2 class="h-3 w-3" />
			Backlinks
		</p>
		<ul class="space-y-0.5">
			{#each backlinks as link (link.sourceNotebookId + link.sourceCellId)}
				<li>
					<TreeRow
						depth={0}
						onActivate={() => openNotebookTabAtCell(link.sourceNotebookId, link.sourceCellId)}
					>
						{#snippet label()}
							<span class="min-w-0 truncate">
								<span class="block truncate font-medium text-foreground/85"
									>{link.sourceNotebookName}</span
								>
								<span class="block truncate text-2xs text-muted-foreground">{link.snippet}</span>
							</span>
						{/snippet}
					</TreeRow>
				</li>
			{/each}
		</ul>
	</div>
{/if}
