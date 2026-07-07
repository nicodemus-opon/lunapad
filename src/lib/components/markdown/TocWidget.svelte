<script lang="ts">
	import { getNotebooks } from '$lib/stores/notebook.svelte';
	import { buildNotebookOutline } from '$lib/services/notebook-outline';

	interface Props {
		notebookId?: string;
	}

	const { notebookId = '' }: Props = $props();

	const headings = $derived.by(() => {
		const cells = getNotebooks().find((n) => n.id === notebookId)?.cells ?? [];
		return buildNotebookOutline(cells).filter((e) => e.kind === 'heading');
	});
</script>

{#if headings.length}
	<nav class="md-toc">
		<p class="md-toc-title">Contents</p>
		<ul>
			{#each headings as h (h.id)}
				<li class="md-toc-item" style="--md-toc-indent: {h.level - 1}">
					<a href="#{h.anchorId}">{h.label}</a>
				</li>
			{/each}
		</ul>
	</nav>
{:else}
	<div class="md-datatable-empty">No headings yet</div>
{/if}

<style>
	.md-toc {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.55rem 0.7rem;
		margin: 0.35rem 0;
		font-size: var(--text-2xs);
	}
	.md-toc-title {
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--muted-foreground);
		margin-bottom: 0.3rem;
	}
	.md-toc ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.md-toc-item {
		padding-left: calc(var(--md-toc-indent, 0) * 0.85rem);
		margin: 0.15rem 0;
	}
	.md-toc-item a {
		color: var(--primary);
	}
	.md-toc-item a:hover {
		text-decoration: underline;
	}
</style>
