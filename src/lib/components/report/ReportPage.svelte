<script lang="ts">
	import { onMount, onDestroy, setContext } from 'svelte';
	import { replaceState } from '$app/navigation';
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import {
		FILTER_CONTEXT_KEY,
		type FilterContextValue
	} from '$lib/components/markdown/filter-context';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp';
	import ReportCell from './ReportCell.svelte';
	import type { PublicShareView, PublicShareCell } from '$lib/server/shared-reports';
	import type { Cell } from '$lib/stores/notebook.svelte';

	interface Props {
		data: PublicShareView;
	}

	const { data }: Props = $props();

	const DEFAULT_POLL_MS = 300_000;

	let liveResults = $state<
		Record<string, { rows: Record<string, unknown>[]; columns: string[] } | null>
	>({});
	let liveErrors = $state<Record<string, string | null>>({});
	let loadingCellIds = $state<Set<string>>(new Set());
	let filters = $state<Record<string, string>>({});
	let lastUpdatedAt = $state<number | null>(null);

	const liveCells = $derived(data.cells.filter((c) => c.isLive));

	// Minimal Cell[]-shaped adapter so markdoc-interp's pure functions (which only read
	// cellType/result/outputName/resultChartConfig) can resolve $cellName refs against
	// whatever the report currently knows — frozen snapshot or latest live poll.
	const markdocCells = $derived.by((): Cell[] => {
		return data.cells.map((cell) => {
			const result = cell.isLive ? (liveResults[cell.id] ?? null) : cell.frozenResult;
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

	// Filters round-trip through the URL query string so a filtered view is bookmarkable,
	// shareable, and survives back/forward navigation — without adding a history entry per
	// keystroke (replaceState, not pushState).
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
			// Which live cell's SQL template references this param is only known
			// server-side (the template text is never sent to the client) — re-run
			// every live cell with the updated filter map rather than guessing.
			void runAllLiveCells();
		}
	};
	setContext(FILTER_CONTEXT_KEY, filterCtx);

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

	onMount(() => {
		const initial = new URLSearchParams(window.location.search);
		if ([...initial.keys()].length > 0) {
			filters = Object.fromEntries(initial.entries());
		}
		void runAllLiveCells();
		startPolling();
		document.addEventListener('visibilitychange', handleVisibilityChange);
	});

	// onMount never runs during SSR, but onDestroy does (right after the server
	// finishes rendering) — guard against the missing `document` global there.
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

<div class="report-page">
	<header class="report-header">
		<h1>{data.notebookName}</h1>
		{#if liveCells.length > 0}
			<span class="report-live-badge">
				● Live{#if secondsAgo !== null}&nbsp;· updated {secondsAgo}s ago{/if}
			</span>
		{/if}
	</header>

	<div class="report-cells">
		{#each data.cells as cell (cell.id)}
			{#if cell.cellType === 'markdown'}
				{#if cell.display !== 'collapsed' && cell.markdown?.trim()}
					{@const result = renderMarkdocCell(cell.markdown, markdocCells)}
					<div class="report-markdown">
						<MarkdocRenderer content={result.tree} errors={result.errors} notebookId="" />
					</div>
				{/if}
			{:else if cell.cellType === 'query'}
				<ReportCell
					{cell}
					rows={cell.isLive
						? (liveResults[cell.id]?.rows ?? null)
						: (cell.frozenResult?.rows ?? null)}
					columns={cell.isLive
						? (liveResults[cell.id]?.columns ?? null)
						: (cell.frozenResult?.columns ?? null)}
					loading={loadingCellIds.has(cell.id)}
					error={liveErrors[cell.id] ?? null}
				/>
			{/if}
		{/each}
	</div>
</div>

<style>
	.report-page {
		max-width: 56rem;
		margin: 0 auto;
		padding: 3rem 1.5rem 6rem;

		color: var(--foreground);
		background: var(--background);
	}
	.report-header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 2rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 1rem;
	}
	.report-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0;
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
		border-left: 2px solid color-mix(in oklch, currentColor 30%, transparent);
		margin: 0 0 0.75rem;
		padding-left: 1rem;
		opacity: 0.8;
	}
	.report-markdown :global(hr) {
		border: none;
		border-top: 1px solid color-mix(in oklch, currentColor 15%, transparent);
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
		border: 1px solid color-mix(in oklch, currentColor 15%, transparent);
		text-align: left;
	}
	.report-markdown :global(th) {
		font-weight: 600;
		background: color-mix(in oklch, currentColor 4%, transparent);
	}
</style>
