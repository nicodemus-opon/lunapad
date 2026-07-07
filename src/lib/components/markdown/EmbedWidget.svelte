<script lang="ts">
	import { sanitizeUrl } from '$lib/services/safe-url';
	import { embedUrlToIframeSrc } from '$lib/services/embed-providers';
	import { ExternalLink } from '@lucide/svelte';

	interface Props {
		url?: string;
		aspect?: '16:9' | '4:3' | '1:1';
	}

	const { url, aspect = '16:9' }: Props = $props();

	const safeUrl = $derived(sanitizeUrl(url));
	const iframeSrc = $derived(safeUrl ? embedUrlToIframeSrc(safeUrl) : null);
	const paddingTop = $derived(aspect === '4:3' ? '75%' : aspect === '1:1' ? '100%' : '56.25%');
</script>

{#if iframeSrc}
	<div class="md-embed" style="--md-embed-padding: {paddingTop}">
		<iframe
			src={iframeSrc}
			title="Embedded content"
			loading="lazy"
			allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
			sandbox="allow-scripts allow-same-origin allow-presentation"
			referrerpolicy="no-referrer"
		></iframe>
	</div>
{:else if safeUrl}
	<a class="md-embed-fallback" href={safeUrl} target="_blank" rel="noopener noreferrer nofollow">
		<ExternalLink class="h-3.5 w-3.5 shrink-0" />
		<span class="truncate">{safeUrl}</span>
	</a>
{:else}
	<div class="md-datatable-empty">Embed: missing or unsafe URL</div>
{/if}

<style>
	.md-embed {
		position: relative;
		width: 100%;
		padding-top: var(--md-embed-padding, 56.25%);
		margin: 0.35rem 0;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: color-mix(in oklab, var(--muted) 25%, transparent);
	}
	.md-embed iframe {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: none;
	}
	.md-embed-fallback {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: var(--text-2xs);
		color: var(--primary);
		margin: 0.35rem 0;
	}
	.md-embed-fallback:hover {
		background: color-mix(in oklab, var(--muted) 20%, transparent);
	}
</style>
