<script lang="ts">
	import ReportPage from '$lib/components/report/ReportPage.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.share.notebookName}</title>
	{#if data.share.description}
		<meta name="description" content={data.share.description} />
	{/if}
</svelte:head>

<ReportPage
	data={data.share}
	initialLiveResults={data.initialLiveResults}
	isAuthenticated={data.isAuthenticated}
	embed={data.embed}
/>
