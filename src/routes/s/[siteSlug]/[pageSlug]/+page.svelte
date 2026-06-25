<script lang="ts">
	import ReportPage from '$lib/components/report/ReportPage.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.share.notebookName}</title>
</svelte:head>

<ReportPage data={data.share} />
