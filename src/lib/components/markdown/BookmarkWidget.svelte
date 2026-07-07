<script lang="ts">
	import { sanitizeUrl } from '$lib/services/safe-url';
	import { Link } from '@lucide/svelte';

	interface Props {
		url?: string;
		title?: string;
		description?: string;
	}

	const { url, title, description }: Props = $props();

	const safeUrl = $derived(sanitizeUrl(url));
</script>

{#if safeUrl}
	<a class="md-bookmark" href={safeUrl} target="_blank" rel="noopener noreferrer nofollow">
		<span class="md-bookmark-icon"><Link class="h-3.5 w-3.5" /></span>
		<span class="md-bookmark-body">
			<span class="md-bookmark-title">{title || safeUrl}</span>
			{#if description}<span class="md-bookmark-desc">{description}</span>{/if}
			<span class="md-bookmark-url">{safeUrl}</span>
		</span>
	</a>
{:else}
	<div class="md-datatable-empty">Bookmark: missing or unsafe URL</div>
{/if}

<style>
	.md-bookmark {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		margin: 0.35rem 0;
		transition: background var(--motion-fast) var(--motion-ease-out);
	}
	.md-bookmark:hover {
		background: color-mix(in oklab, var(--muted) 20%, transparent);
	}
	.md-bookmark-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		flex-shrink: 0;
		color: var(--muted-foreground);
	}
	.md-bookmark-body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.md-bookmark-title {
		font-size: 0.85em;
		font-weight: 600;
		color: var(--foreground);
	}
	.md-bookmark-desc {
		font-size: var(--text-2xs);
		color: var(--muted-foreground);
	}
	.md-bookmark-url {
		font-size: var(--text-3xs);
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
