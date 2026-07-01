<script lang="ts">
	import ReportPage from '$lib/components/report/ReportPage.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();
	const title = $derived(`${data.sitePage.navLabel} · ${data.siteName}`);
</script>

<svelte:head>
	<title>{title}</title>
	{#if data.share.description}
		<meta name="description" content={data.share.description} />
	{/if}
</svelte:head>

<ReportPage
	data={data.share}
	initialLiveResults={data.initialLiveResults}
	isAuthenticated={data.isAuthenticated}
/>
