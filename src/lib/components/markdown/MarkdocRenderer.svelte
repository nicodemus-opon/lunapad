<script lang="ts">
	import type { RenderableTreeNode } from '@markdoc/markdoc';
	import MarkdocNode from './MarkdocNode.svelte';

	interface Props {
		content: RenderableTreeNode[];
		errors?: string[];
		notebookId?: string;
	}

	const { content, errors = [], notebookId = '' }: Props = $props();
</script>

{#if errors.length}
	<div class="md-error-banner">
		{#each errors as err, i (i)}<div>⚠ {err}</div>{/each}
	</div>
{/if}
{#each content as node, i (i)}<MarkdocNode {node} {notebookId} />{/each}

<style>
	.md-error-banner {
		font-size: 0.75rem;
		color: var(--destructive, #dc2626);
		background: color-mix(in oklch, var(--destructive, #dc2626) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--destructive, #dc2626) 25%, transparent);
		border-radius: 0.4rem;
		padding: 0.4rem 0.6rem;
		margin-bottom: 0.5rem;
	}
</style>
