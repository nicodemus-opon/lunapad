<script lang="ts">
	import InlineResultView from '$lib/components/InlineResultView.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Download, MessageSquare } from '@lucide/svelte';
	import type { PublicShareCell } from '$lib/server/shared-reports';

	interface Props {
		cell: PublicShareCell;
		rows: Record<string, unknown>[] | null;
		columns: string[] | null;
		loading?: boolean;
		error?: string | null;
		exportEnabled?: boolean;
		oncomment?: () => void;
	}

	const {
		cell,
		rows,
		columns,
		loading = false,
		error = null,
		exportEnabled = false,
		oncomment
	}: Props = $props();

	function downloadCsv(): void {
		if (!rows || !columns) return;
		const lines = [
			columns.join(','),
			...rows.map((row) => columns.map((col) => JSON.stringify(row[col] ?? '')).join(','))
		];
		const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${cell.outputName || 'result'}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

{#if error}
	<p class="report-cell-error">{error}</p>
{:else if rows && columns}
	{#if rows.length === 0}
		<p class="report-cell-empty">Query returned 0 rows.</p>
	{:else}
		<div class="report-cell-toolbar no-print">
			{#if exportEnabled}
				<Button variant="outline" size="sm" class="h-7 text-[11px]" onclick={downloadCsv}>
					<Download class="h-3 w-3" /> CSV
				</Button>
			{/if}
			{#if oncomment}
				<Button variant="outline" size="sm" class="h-7 text-[11px]" onclick={oncomment}>
					<MessageSquare class="h-3 w-3" /> Comment
				</Button>
			{/if}
		</div>
		<div class="report-cell-result" class:is-loading={loading}>
			<InlineResultView
				{rows}
				{columns}
				name={cell.outputName || 'result'}
				initialViewMode={cell.resultViewMode}
				initialChartConfig={cell.resultChartConfig}
				columnFormatRules={cell.columnFormatRules}
				controlsVisible={exportEnabled}
				toolbarReserveSpace={false}
			/>
		</div>
	{/if}
{:else if loading}
	<p class="report-cell-empty report-cell-skeleton">Loading…</p>
{:else}
	<p class="report-cell-empty report-cell-skeleton">Loading…</p>
{/if}

<style>
	.report-cell-toolbar {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.35rem;
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
	.report-cell-skeleton {
		animation: pulse 1.5s ease-in-out infinite;
	}
	.report-cell-result {
		transition: opacity 0.2s ease;
	}
	.report-cell-result.is-loading {
		opacity: 0.6;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}
</style>
