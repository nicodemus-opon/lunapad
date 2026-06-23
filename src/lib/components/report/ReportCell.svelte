<script lang="ts">
	import InlineResultView from '$lib/components/InlineResultView.svelte';
	import type { PublicShareCell } from '$lib/server/shared-reports';

	interface Props {
		cell: PublicShareCell;
		rows: Record<string, unknown>[] | null;
		columns: string[] | null;
		loading?: boolean;
		error?: string | null;
	}

	const { cell, rows, columns, loading = false, error = null }: Props = $props();
</script>

{#if cell.display === 'collapsed'}
	<div class="report-cell-collapsed">{cell.outputName}</div>
{:else if error}
	<p class="report-cell-error">{error}</p>
{:else if rows && columns}
	{#if rows.length === 0}
		<p class="report-cell-empty">Query returned 0 rows.</p>
	{:else}
		<div class="report-cell-result" class:is-loading={loading}>
			<InlineResultView
				{rows}
				{columns}
				name={cell.outputName || 'result'}
				initialViewMode={cell.resultViewMode}
				initialChartConfig={cell.resultChartConfig}
				controlsVisible={false}
				toolbarReserveSpace={false}
			/>
		</div>
	{/if}
{:else}
	<p class="report-cell-empty">Loading…</p>
{/if}

<style>
	.report-cell-collapsed {
		font-size: 0.8rem;
		color: var(--muted-foreground);
		padding: 0.25rem 0;
	}
	.report-cell-error {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--destructive);
	}
	.report-cell-empty {
		font-size: 0.8rem;
		font-style: italic;
		color: var(--muted-foreground);
	}
	.report-cell-result {
		transition: opacity 0.2s ease;
	}
	.report-cell-result.is-loading {
		opacity: 0.6;
	}
</style>
