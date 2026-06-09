<script lang="ts">
	import { RefreshCw, ExternalLink, MonitorPlay } from '@lucide/svelte';
	import { getEvidenceDevPort } from '$lib/stores/notebook.svelte';

	interface Props {
		pagePath: string;
	}

	const { pagePath }: Props = $props();

	const devPort = $derived(getEvidenceDevPort());

	// Convert pages/my-page.md → /my-page
	const pageRoute = $derived(
		'/' + pagePath.replace(/^pages\//, '').replace(/\.md$/, '')
	);

	const previewUrl = $derived(
		devPort ? `http://localhost:${devPort}${pageRoute}` : null
	);

	let iframe = $state<HTMLIFrameElement | null>(null);

	function refresh() {
		if (iframe) {
			iframe.src = iframe.src;
		}
	}
</script>

<div class="flex flex-col h-full">
	<!-- Toolbar -->
	<div class="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
		<MonitorPlay class="w-4 h-4 text-muted-foreground shrink-0" />
		<span class="text-xs text-muted-foreground truncate flex-1" title={pagePath}>
			{pagePath.replace(/^pages\//, '').replace(/\.md$/, '')}
		</span>

		{#if previewUrl}
			<button
				class="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				onclick={refresh}
				title="Refresh"
			>
				<RefreshCw class="w-3.5 h-3.5" />
			</button>
			<a
				href={previewUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				title="Open in browser"
			>
				<ExternalLink class="w-3.5 h-3.5" />
			</a>
		{/if}
	</div>

	<!-- Preview area -->
	<div class="flex-1 min-h-0 bg-white dark:bg-white">
		{#if previewUrl}
			<iframe
				bind:this={iframe}
				src={previewUrl}
				class="w-full h-full border-0"
				title="Evidence preview: {pagePath}"
				allow="clipboard-read; clipboard-write"
			></iframe>
		{:else}
			<div class="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
				<MonitorPlay class="w-10 h-10 opacity-30" />
				<p class="text-sm">Evidence dev server not running</p>
				<p class="text-xs opacity-70">Start the dev server from the Evidence panel to preview this page</p>
			</div>
		{/if}
	</div>
</div>
