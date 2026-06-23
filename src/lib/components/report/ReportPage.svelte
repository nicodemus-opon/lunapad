<script lang="ts">
	import { onMount, onDestroy, setContext } from 'svelte';
	import { marked } from 'marked';
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import { FILTER_CONTEXT_KEY, type FilterContextValue } from '$lib/components/markdown/filter-context';
	import { interpolateMarkdownRefs } from '$lib/services/markdown-interp';
	import { hasMarkdocSyntax, renderMarkdocCell } from '$lib/services/markdoc-interp';
	import ReportCell from './ReportCell.svelte';
	import type { PublicShareView, PublicShareCell } from '$lib/server/shared-reports';
	import type { Cell } from '$lib/stores/notebook.svelte';

	interface Props {
		data: PublicShareView;
	}

	const { data }: Props = $props();

	const DEFAULT_POLL_MS = 30_000;

	let liveResults = $state<Record<string, { rows: Record<string, unknown>[]; columns: string[] } | null>>({});
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
			const result = cell.isLive ? liveResults[cell.id] ?? null : cell.frozenResult;
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

	const filterCtx: FilterContextValue = {
		getValue: (param) => filters[param] ?? '',
		setValue: (param, value) => {
			filters = { ...filters, [param]: value };
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
		void runAllLiveCells();
		startPolling();
		document.addEventListener('visibilitychange', handleVisibilityChange);
	});

	// onMount never runs during SSR, but onDestroy does (right after the server
	// finishes rendering) — guard against the missing `document` global there.
	onDestroy(() => {
		stopPolling();
		if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityChange);
	});

	function renderLegacyMarkdown(markdown: string): string {
		const interpolated = interpolateMarkdownRefs(markdown.trim(), markdocCells);
		const html = marked.parse(interpolated, { async: false, breaks: true, gfm: true }) as string;
		return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on[a-z]+="[^"]*"/gi, '');
	}

	const secondsAgo = $derived.by(() => {
		if (!lastUpdatedAt) return null;
		return Math.max(0, Math.round((Date.now() - lastUpdatedAt) / 1000));
	});
</script>

<div class="report-page font-serif">
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
					{#if hasMarkdocSyntax(cell.markdown)}
						{@const result = renderMarkdocCell(cell.markdown, markdocCells)}
						<div class="report-markdown">
							<MarkdocRenderer content={result.tree} errors={result.errors} notebookId="" />
						</div>
					{:else}
						<div class="report-markdown">{@html renderLegacyMarkdown(cell.markdown)}</div>
					{/if}
				{/if}
			{:else if cell.cellType === 'query'}
				<ReportCell
					{cell}
					rows={cell.isLive ? liveResults[cell.id]?.rows ?? null : cell.frozenResult?.rows ?? null}
					columns={cell.isLive ? liveResults[cell.id]?.columns ?? null : cell.frozenResult?.columns ?? null}
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
	.report-markdown :global(p:first-child) {
		margin-top: 0;
	}
</style>
