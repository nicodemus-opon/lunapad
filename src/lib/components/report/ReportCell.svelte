<script lang="ts">
	import InlineResultView from '$lib/components/InlineResultView.svelte';
	import PythonCellOutput from '$lib/components/PythonCellOutput.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Download, MessageSquare } from '@lucide/svelte';
	import type { PublicShareCell } from '$lib/server/shared-reports';
	import hljs from 'highlight.js/lib/core';
	import sql from 'highlight.js/lib/languages/sql';
	import python from 'highlight.js/lib/languages/python';

	hljs.registerLanguage('sql', sql);
	hljs.registerLanguage('python', python);

	interface Props {
		cell: PublicShareCell;
		rows: Record<string, unknown>[] | null;
		columns: string[] | null;
		pythonOutput?: PublicShareCell['pythonOutput'];
		loading?: boolean;
		error?: string | null;
		exportEnabled?: boolean;
		oncomment?: () => void;
		/** Resolved workspace brand-theme token values, for chart color
		 *  resolution during SSR of this page (see theme-colors.ts). */
		ssrThemeOverrides?: Record<string, string>;
	}

	const {
		cell,
		rows,
		columns,
		pythonOutput = null,
		loading = false,
		error = null,
		exportEnabled = false,
		oncomment,
		ssrThemeOverrides
	}: Props = $props();

	const highlightLang = $derived(cell.cellType === 'python' ? 'python' : cell.language);

	// hljs.highlight only adds <span class="hljs-*"> tags — no XSS risk.
	const highlightedCode = $derived.by(() => {
		if (!cell.code) return '';
		if (hljs.getLanguage(highlightLang)) {
			return hljs.highlight(cell.code, { language: highlightLang }).value;
		}
		return cell.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	});

	const hasTabularData = $derived(Boolean(rows && columns));
	const hasPythonOutput = $derived(
		Boolean(
			pythonOutput &&
			(pythonOutput.error || pythonOutput.stdout.trim() || pythonOutput.figures.length > 0)
		)
	);

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

{#if cell.code}
	<pre class="report-cell-code"><code class="language-{highlightLang}">{@html highlightedCode}</code
		></pre>
{/if}
{#if error}
	<p class="report-cell-error">{error}</p>
{:else if hasTabularData || hasPythonOutput}
	{#if hasTabularData}
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
	{/if}
	{#if hasPythonOutput}
		<div class="report-python-output">
			<PythonCellOutput output={pythonOutput!} />
		</div>
	{/if}
	{#if hasTabularData}
		{#if rows!.length === 0}
			<p class="report-cell-empty">Query returned 0 rows.</p>
		{:else}
			<div class="report-cell-result" class:is-loading={loading}>
				<InlineResultView
					rows={rows!}
					columns={columns!}
					name={cell.outputName || 'result'}
					initialViewMode={cell.resultViewMode}
					initialChartConfig={cell.resultChartConfig}
					columnFormatRules={cell.columnFormatRules}
					columnWidths={cell.columnWidths}
					controlsVisible={exportEnabled}
					toolbarReserveSpace={false}
					{ssrThemeOverrides}
				/>
			</div>
		{/if}
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
	.report-cell-code {
		margin: 0 0 0.5rem;
		padding: 0.5rem 0.65rem;
		border-radius: 0.375rem;
		background: var(--muted);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		white-space: pre-wrap;
		word-break: break-word;
	}
	/* Syntax token colors — bound to app CSS tokens for automatic dark/light support */
	.report-cell-code :global(.hljs-keyword),
	.report-cell-code :global(.hljs-selector-tag),
	.report-cell-code :global(.hljs-built_in) {
		color: var(--primary);
		font-weight: 600;
	}
	.report-cell-code :global(.hljs-string),
	.report-cell-code :global(.hljs-attr) {
		color: var(--chart-2);
	}
	.report-cell-code :global(.hljs-number),
	.report-cell-code :global(.hljs-literal) {
		color: var(--chart-1);
	}
	.report-cell-code :global(.hljs-comment),
	.report-cell-code :global(.hljs-quote) {
		color: var(--muted-foreground);
		font-style: italic;
	}
	.report-cell-code :global(.hljs-title),
	.report-cell-code :global(.hljs-section),
	.report-cell-code :global(.hljs-name) {
		color: var(--chart-4);
	}
	.report-cell-code :global(.hljs-variable),
	.report-cell-code :global(.hljs-template-variable) {
		color: var(--chart-3);
	}
	.report-cell-code :global(.hljs-type),
	.report-cell-code :global(.hljs-class) {
		color: var(--chart-4);
	}
	.report-cell-code :global(.hljs-meta) {
		color: var(--muted-foreground);
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
	.report-python-output {
		margin-bottom: 0.75rem;
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
