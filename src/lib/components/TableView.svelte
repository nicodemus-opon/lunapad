<script lang="ts">
	import { onMount } from 'svelte';
	import { executeSQL } from '$lib/services/duckdb';
	import ResultView from '$lib/components/ResultView.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Database, Table2, AlertCircle } from '@lucide/svelte';
	import type { ChartConfig } from '$lib/types/gui-pipeline';
	import type { ResultViewMode } from '$lib/types/gui-pipeline';

	interface Props {
		tableName: string;
		tabId: string;
		viewMode: ResultViewMode;
		chartConfig: ChartConfig | null;
	}

	const { tableName, tabId, viewMode, chartConfig }: Props = $props();

	const LIMIT = 1000;

	type QueryResult = { rows: Record<string, unknown>[]; columns: string[] };

	let result = $state<QueryResult | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let totalRows = $state<number | null>(null);

	onMount(async () => {
		try {
			// Run count and data fetch in parallel
			const [countResult, dataResult] = await Promise.all([
				executeSQL(`SELECT COUNT(*) AS n FROM "${tableName}"`),
				executeSQL(`SELECT * FROM "${tableName}" LIMIT ${LIMIT}`)
			]);
			totalRows = Number(countResult.rows[0]?.n ?? 0);
			result = dataResult;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	});
</script>

<div class="flex flex-col gap-4">
	<!-- Header -->
	<div class="flex items-center gap-2">
		<Table2 class="w-4 h-4 text-primary" />
		<h2 class="text-sm font-semibold font-mono">{tableName}</h2>
		{#if totalRows !== null}
			<span class="text-xs text-muted-foreground">
				{totalRows.toLocaleString()} rows
			</span>
		{/if}
		{#if totalRows !== null && totalRows > LIMIT}
			<span class="text-[10px] bg-(--chart-1)/15 text-chart-1 px-1.5 py-0.5 rounded font-medium">
				Showing first {LIMIT.toLocaleString()}
			</span>
		{/if}
	</div>

	{#if loading}
		<div class="space-y-2">
			<Skeleton class="h-8 w-full" />
			<Skeleton class="h-6 w-full" />
			<Skeleton class="h-6 w-full" />
			<Skeleton class="h-6 w-4/5" />
			<Skeleton class="h-6 w-3/5" />
		</div>
	{:else if error}
		<div class="flex items-start gap-2 text-destructive text-sm border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">
			<AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
			<span class="font-mono text-xs">{error}</span>
		</div>
	{:else if result}
		<ResultView
			{tabId}
			rows={result.rows}
			columns={result.columns}
			name={tableName}
			{viewMode}
			{chartConfig}
		/>
	{:else}
		<div class="flex items-center gap-2 text-muted-foreground text-sm">
			<Database class="w-4 h-4" />
			No data found.
		</div>
	{/if}
</div>
