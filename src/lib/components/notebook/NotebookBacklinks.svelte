<script lang="ts">
	import { Link2 } from '@lucide/svelte';
	import { findNotebookBacklinks } from '$lib/services/notebook-backlinks';
	import { getNotebooks, openNotebookTabAtCell } from '$lib/stores/notebook.svelte';

	interface Props {
		notebookId: string;
	}

	const { notebookId }: Props = $props();

	const backlinks = $derived(findNotebookBacklinks(notebookId, getNotebooks()));
</script>

{#if backlinks.length > 0}
	<div class="border-t border-border px-2 py-2">
		<p class="flex items-center gap-1.5 px-1 py-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
			<Link2 class="h-3 w-3" />
			Backlinks
		</p>
		<ul class="space-y-0.5">
			{#each backlinks as link (link.sourceNotebookId + link.sourceCellId)}
				<li>
					<button
						type="button"
						class="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-sidebar-accent/60"
						onclick={() => openNotebookTabAtCell(link.sourceNotebookId, link.sourceCellId)}
					>
						<span class="block truncate font-medium text-foreground/85">{link.sourceNotebookName}</span>
						<span class="block truncate text-2xs text-muted-foreground">{link.snippet}</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}
