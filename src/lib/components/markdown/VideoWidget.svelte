<script lang="ts">
	import { sanitizeUrl } from '$lib/services/safe-url';

	interface Props {
		src?: string;
		poster?: string;
		loop?: boolean;
		muted?: boolean;
	}

	const { src, poster, loop, muted }: Props = $props();

	const safeSrc = $derived(sanitizeUrl(src));
	const safePoster = $derived(poster ? sanitizeUrl(poster) : '');
</script>

{#if safeSrc}
	<video
		class="md-video"
		src={safeSrc}
		poster={safePoster || undefined}
		{loop}
		muted={Boolean(muted)}
		controls
		playsinline
	></video>
{:else}
	<div class="md-datatable-empty">Video: missing or unsafe src</div>
{/if}

<style>
	.md-video {
		width: 100%;
		max-height: 32rem;
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--muted) 25%, transparent);
		margin: 0.35rem 0;
	}
</style>
