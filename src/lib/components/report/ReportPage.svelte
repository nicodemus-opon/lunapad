<script lang="ts">
	import { onMount, onDestroy, setContext } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { Printer, Download } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import ReportFilterBar from '$lib/components/markdown/ReportFilterBar.svelte';
	import {
		FILTER_CONTEXT_KEY,
		SUPPRESS_INLINE_FILTERS_KEY,
		type FilterContextValue
	} from '$lib/components/markdown/filter-context';
	import { extractReportFilters } from '$lib/services/report-filters';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp';
	import { filterFrozenRows, shouldHideQueryCell } from '$lib/services/filter-frozen';
	import ReportCell from './ReportCell.svelte';
	import ShareReviewSidebar from './ShareReviewSidebar.svelte';
	import type { PublicShareView, PublicShareCell } from '$lib/server/shared-reports';
	import type { Cell } from '$lib/stores/notebook.svelte';

	interface Props {
		data: PublicShareView;
		initialLiveResults?: Record<
			string,
			{ rows: Record<string, unknown>[]; columns: string[] } | null
		>;
		isAuthenticated?: boolean;
		embed?: boolean;
	}

	const { data, initialLiveResults = {}, isAuthenticated = false, embed = false }: Props = $props();

	const DEFAULT_POLL_MS = 300_000;

	let liveResults = $state<
		Record<string, { rows: Record<string, unknown>[]; columns: string[] } | null>
	>({ ...initialLiveResults });
	let liveErrors = $state<Record<string, string | null>>({});
	let loadingCellIds = $state<Set<string>>(new Set());
	let filters = $state<Record<string, string>>({});
	let lastUpdatedAt = $state<number | null>(
		Object.keys(initialLiveResults).length > 0 ? Date.now() : null
	);
	let reviewSidebar = $state<ShareReviewSidebar | undefined>();

	const reportMarkdowns = $derived(
		data.cells
			.filter((c) => c.cellType === 'markdown' && c.markdown?.trim())
			.map((c) => c.markdown!)
	);
	const filterDefs = $derived(extractReportFilters(reportMarkdowns));

	function postEmbedMessage(type: string, payload: Record<string, unknown> = {}): void {
		if (!embed || typeof window === 'undefined') return;
		window.parent.postMessage({ source: 'lunapad-report', type, ...payload }, '*');
	}
	const liveCells = $derived(data.cells.filter((c) => c.isLive));
	const visibleCells = $derived(
		data.cells.filter((c) => c.cellType !== 'query' || !shouldHideQueryCell(c))
	);

	function frozenResultForCell(cell: PublicShareCell) {
		if (!cell.frozenResult) return null;
		const { rows, columns } = filterFrozenRows(
			cell.frozenResult.rows,
			cell.frozenResult.columns,
			filters
		);
		return { rows, columns };
	}

	const markdocCells = $derived.by((): Cell[] => {
		return data.cells.map((cell) => {
			let result = cell.isLive ? (liveResults[cell.id] ?? null) : frozenResultForCell(cell);
			return {
				cellType: cell.cellType,
				outputName: cell.outputName,
				result,
				resultChartConfig: cell.resultChartConfig
			} as unknown as Cell;
		});
	});

	async function runLiveCell(cell: PublicShareCell): Promise<void> {
		loadingCellIds = new Set(loadingCellIds).add(cell.id);
		try {
			const res = await fetch(`/api/shares/${data.token}/run`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cellId: cell.id, filters })
			});
			const body = await res.json();
			if (!res.ok) {
				liveErrors = { ...liveErrors, [cell.id]: body.error ?? 'Failed to run query.' };
				return;
			}
			liveResults = { ...liveResults, [cell.id]: { rows: body.rows, columns: body.columns } };
			liveErrors = { ...liveErrors, [cell.id]: null };
		} catch {
			liveErrors = { ...liveErrors, [cell.id]: 'Failed to run query.' };
		} finally {
			const next = new Set(loadingCellIds);
			next.delete(cell.id);
			loadingCellIds = next;
		}
	}

	async function runAllLiveCells(): Promise<void> {
		await Promise.all(liveCells.map((c) => runLiveCell(c)));
		lastUpdatedAt = Date.now();
	}

	function syncFiltersToURL(): void {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(filters)) {
			if (value !== '') params.set(key, value);
		}
		const query = params.toString();
		replaceState(query ? `?${query}` : window.location.pathname, {});
	}

	const filterCtx: FilterContextValue = {
		getValue: (param) => filters[param] ?? '',
		setValue: (param, value) => {
			filters = { ...filters, [param]: value };
			syncFiltersToURL();
			postEmbedMessage('filter', { filters });
			const hasLiveFilters = liveCells.some((c) => c.isLive);
			if (hasLiveFilters) void runAllLiveCells();
		},
		setValues: (values) => {
			filters = { ...filters, ...values };
			syncFiltersToURL();
			postEmbedMessage('filter', { filters });
			const hasLiveFilters = liveCells.some((c) => c.isLive);
			if (hasLiveFilters) void runAllLiveCells();
		}
	};
	setContext(FILTER_CONTEXT_KEY, filterCtx);
	setContext(SUPPRESS_INLINE_FILTERS_KEY, filterDefs.length > 0);

	let pollTimer: ReturnType<typeof setInterval> | null = null;

	function startPolling(): void {
		if (pollTimer) return;
		const interval = data.pollIntervalMs ?? DEFAULT_POLL_MS;
		pollTimer = setInterval(() => void runAllLiveCells(), interval);
	}

	function stopPolling(): void {
		if (!pollTimer) return;
		clearInterval(pollTimer);
		pollTimer = null;
	}

	function handleVisibilityChange(): void {
		if (document.hidden) {
			stopPolling();
		} else {
			void runAllLiveCells();
			startPolling();
		}
	}

	function printReport(): void {
		window.print();
	}

	function exportHtml(): void {
		window.open(`/api/shares/${data.token}/export/html`, '_blank');
	}

	onMount(() => {
		const initial = new URLSearchParams(window.location.search);
		if ([...initial.keys()].length > 0) {
			filters = Object.fromEntries(initial.entries());
		}
		if (liveCells.length > 0 && Object.keys(initialLiveResults).length === 0) {
			void runAllLiveCells();
		}
		startPolling();
		document.addEventListener('visibilitychange', handleVisibilityChange);
		if (data.theme === 'dark') document.documentElement.classList.add('dark');
		else if (data.theme === 'light') document.documentElement.classList.remove('dark');
		if (embed) {
			document.documentElement.classList.add('report-embed');
			postEmbedMessage('ready', { token: data.token });
		}
	});

	onDestroy(() => {
		stopPolling();
		if (typeof document !== 'undefined')
			document.removeEventListener('visibilitychange', handleVisibilityChange);
	});

	const secondsAgo = $derived.by(() => {
		if (!lastUpdatedAt) return null;
		return Math.max(0, Math.round((Date.now() - lastUpdatedAt) / 1000));
	});
</script>

<div class="report-page" class:report-page--embed={embed}>
	{#if !embed}
		<header class="report-header">
			<div class="report-header-main">
				<h1>{data.notebookName}</h1>
				{#if data.description}
					<p class="report-description">{data.description}</p>
				{/if}
			</div>
			<div class="report-header-actions no-print">
				{#if liveCells.length > 0}
					<span class="report-live-badge">
						● Live{#if secondsAgo !== null}&nbsp;· updated {secondsAgo}s ago{/if}
					</span>
				{/if}
				<Button variant="outline" size="sm" onclick={printReport} title="Print">
					<Printer class="h-3.5 w-3.5" />
				</Button>
				<Button variant="outline" size="sm" onclick={exportHtml} title="Export HTML">
					<Download class="h-3.5 w-3.5" />
				</Button>
			</div>
		</header>
	{/if}

	{#if filterDefs.length > 0}
		<ReportFilterBar filters={filterDefs} />
	{/if}

	<div class="report-cells">
		{#each visibleCells as cell (cell.id)}
			{#if cell.cellType === 'markdown'}
				{#if cell.display !== 'collapsed' && cell.markdown?.trim()}
					{@const result = renderMarkdocCell(cell.markdown, markdocCells)}
					<div class="report-markdown report-section">
						<MarkdocRenderer content={result.tree} errors={result.errors} notebookId="" />
					</div>
				{/if}
			{:else if cell.cellType === 'query' && !shouldHideQueryCell(cell)}
				<div class="report-section">
					<ReportCell
						{cell}
						rows={cell.isLive
							? (liveResults[cell.id]?.rows ?? null)
							: (frozenResultForCell(cell)?.rows ?? null)}
						columns={cell.isLive
							? (liveResults[cell.id]?.columns ?? null)
							: (frozenResultForCell(cell)?.columns ?? null)}
						loading={loadingCellIds.has(cell.id)}
						error={liveErrors[cell.id] ?? null}
						exportEnabled={true}
						oncomment={() => reviewSidebar?.openForCell(cell.id)}
					/>
				</div>
			{/if}
		{/each}
	</div>
</div>

<ShareReviewSidebar bind:this={reviewSidebar} shareToken={data.token} {isAuthenticated} />

<style>
	.report-page--embed {
		padding: 1rem 1rem 2rem;
		max-width: none;
	}
	.report-page {
		max-width: 56rem;
		margin: 0 auto;
		padding: 3rem 1.5rem 6rem;
		color: var(--foreground);
		background: var(--background);
	}
	.report-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 2rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 1rem;
	}
	.report-header-main h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0;
	}
	.report-description {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
		color: var(--muted-foreground);
	}
	.report-header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.report-live-badge {
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.report-cells {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
	}
	.report-markdown {
		font-size: 0.95rem;
		line-height: 1.7;
	}
	.report-markdown :global(h1) {
		font-size: 1.3rem;
		font-weight: 700;
		margin: 0 0 0.75rem;
		line-height: 1.3;
	}
	.report-markdown :global(h2) {
		font-size: 1.15rem;
		font-weight: 600;
		margin: 1.25rem 0 0.5rem;
		line-height: 1.35;
	}
	.report-markdown :global(h3),
	.report-markdown :global(h4),
	.report-markdown :global(h5),
	.report-markdown :global(h6) {
		font-size: 1rem;
		font-weight: 600;
		margin: 1rem 0 0.4rem;
	}
	.report-markdown :global(p) {
		margin: 0 0 0.75rem;
	}
	.report-markdown :global(p:first-child) {
		margin-top: 0;
	}
	.report-markdown :global(*:last-child) {
		margin-bottom: 0;
	}
	.report-markdown :global(ul),
	.report-markdown :global(ol) {
		padding-left: 1.5rem;
		margin: 0 0 0.75rem;
	}
	.report-markdown :global(li) {
		margin-bottom: 0.25rem;
	}
	.report-markdown :global(pre) {
		background: color-mix(in oklch, currentColor 6%, transparent);
		border-radius: 0.35rem;
		padding: 0.75rem 1rem;
		margin: 0 0 0.75rem;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.report-markdown :global(code) {
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.85em;
		background: color-mix(in oklch, currentColor 8%, transparent);
		border-radius: 0.25rem;
		padding: 0.1em 0.35em;
	}
	.report-markdown :global(pre code) {
		background: none;
		padding: 0;
	}
	.report-markdown :global(blockquote) {
		border-left: 2px solid var(--border);
		margin: 0 0 0.75rem;
		padding-left: 1rem;
		opacity: 0.8;
	}
	.report-markdown :global(hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 1.25rem 0;
	}
	.report-markdown :global(a) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.report-markdown :global(img) {
		max-width: 100%;
		border-radius: 0.35rem;
	}
	.report-markdown :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85em;
		margin: 0 0 0.75rem;
	}
	.report-markdown :global(th),
	.report-markdown :global(td) {
		padding: 0.4rem 0.7rem;
		border: 1px solid var(--border);
		text-align: left;
	}
	.report-markdown :global(th) {
		font-weight: 600;
		background: color-mix(in oklch, currentColor 4%, transparent);
	}

	@media print {
		:global(.no-print) {
			display: none !important;
		}
		.report-page {
			padding: 0;
			max-width: none;
		}
		.report-section {
			break-inside: avoid;
			page-break-inside: avoid;
		}
		.report-header {
			border-bottom-color: #ccc;
		}
	}
</style>
