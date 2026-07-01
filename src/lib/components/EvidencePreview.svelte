<script lang="ts">
	import { RefreshCw, ExternalLink, MonitorPlay } from '@lucide/svelte';
	import { getEvidenceDevPort } from '$lib/stores/notebook.svelte';

	interface Props {
		pagePath: string;
	}

	const { pagePath }: Props = $props();

	const devPort = $derived(getEvidenceDevPort());

	// Convert pages/my-page.md → /my-page
	const pageRoute = $derived('/' + pagePath.replace(/^pages\//, '').replace(/\.md$/, ''));

	const previewUrl = $derived(devPort ? `http://localhost:${devPort}${pageRoute}` : null);

	let iframe = $state<HTMLIFrameElement | null>(null);

	function refresh() {
		if (iframe) {
			iframe.src = iframe.src;
		}
	}
</script>

<div class="flex h-full flex-col">
	<!-- Toolbar -->
	<div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
		<MonitorPlay class="h-4 w-4 shrink-0 text-muted-foreground" />
		<span class="flex-1 truncate text-xs text-muted-foreground" title={pagePath}>
			{pagePath.replace(/^pages\//, '').replace(/\.md$/, '')}
		</span>

		{#if previewUrl}
			<button
				class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
				onclick={refresh}
				title="Refresh"
			>
				<RefreshCw class="h-3.5 w-3.5" />
			</button>
			<a
				href={previewUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
				title="Open in browser"
			>
				<ExternalLink class="h-3.5 w-3.5" />
			</a>
		{/if}
	</div>

	<!-- Preview area -->
	<div class="min-h-0 flex-1 bg-white dark:bg-white">
		{#if previewUrl}
			<iframe
				bind:this={iframe}
				src={previewUrl}
				class="h-full w-full border-0"
				title="Evidence preview: {pagePath}"
				allow="clipboard-read; clipboard-write"
			></iframe>
		{:else}
			<div class="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
				<MonitorPlay class="h-10 w-10 opacity-30" />
				<p class="text-sm">Evidence dev server not running</p>
				<p class="text-xs opacity-70">
					Start the dev server from the Evidence panel to preview this page
				</p>
			</div>
		{/if}
	</div>
</div>
