<script lang="ts">
	import type { RenderableTreeNode } from '@markdoc/markdoc';
	import MarkdocNode from './MarkdocNode.svelte';

	interface Props {
		content: RenderableTreeNode[];
		errors?: string[];
		notebookId?: string;
		/** Cell id prefix for heading anchor ids (outline navigation). */
		headingSlugPrefix?: string;
	}

	const { content, errors = [], notebookId = '', headingSlugPrefix = '' }: Props = $props();

	let headingSlugTracker = $state(new Set<string>());
	$effect(() => {
		content;
		headingSlugTracker = new Set<string>();
	});
</script>

{#if errors.length}
	<div class="md-error-banner">
		{#each errors as err, i (i)}<div>⚠ {err}</div>{/each}
	</div>
{/if}
{#each content as node, i (i)}
	<MarkdocNode {node} {notebookId} {headingSlugPrefix} {headingSlugTracker} />
{/each}

<style>
	.md-error-banner {
		font-size: var(--text-xs);
		color: var(--destructive);
		background: color-mix(in oklab, var(--destructive) 8%, transparent);
		border: 1px solid color-mix(in oklab, var(--destructive) 25%, transparent);
		border-radius: var(--radius);
		padding: 0.4rem 0.6rem;
		margin-bottom: 0.5rem;
	}
</style>
