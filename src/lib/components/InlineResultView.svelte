<script lang="ts">
	import { untrack } from 'svelte';
	import ResultTable from './ResultTable.svelte';
	import ChartView from './ChartView.svelte';
	import ChartConfigPanel from './ChartConfigPanel.svelte';
	import StatsView from './StatsView.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Table2, TrendingUp, Sigma, Settings2 } from '@lucide/svelte';
	import { inferSmartChartConfig } from '$lib/utils';
	import type { ChartConfig, ResultViewMode } from '$lib/types/gui-pipeline';

	interface Props {
		rows: Record<string, unknown>[];
		columns: string[];
		name?: string;
		/** When true, constrains content height to ~200px — used in pipeline stage previews */
		compact?: boolean;
		/** Externally persisted view mode – restored when component remounts after a run */
		initialViewMode?: ResultViewMode;
		/** Externally persisted chart config – restored when component remounts after a run */
		initialChartConfig?: ChartConfig | null;
		onViewModeChange?: (mode: ResultViewMode) => void;
		onChartConfigChange?: (config: ChartConfig) => void;
		onAddSort?: (column: string, dir: 'asc' | 'desc') => void;
		onAddFilter?: (column: string) => void;
		columnDescriptions?: Record<string, string>;
		onColumnDescriptionChange?: (column: string, description: string) => void;
		/** Hide non-essential controls until the surrounding cell is focused */
		controlsVisible?: boolean;
		/** When false, the hidden toolbar collapses to 0 height instead of reserving a row (used when the cell shows output only) */
		toolbarReserveSpace?: boolean;
		/** Optional actions rendered on the right side of the toolbar row */
		toolbarActions?: import('svelte').Snippet;
		/** Query execution time in milliseconds */
		executionMs?: number | null;
		/** True when rows were capped at the auto-limit */
		truncated?: boolean;
	}

	let {
		rows,
		columns,
		name = 'result',
		compact = false,
		truncated = false,
		initialViewMode,
		initialChartConfig,
		onViewModeChange,
		onChartConfigChange,
		onAddSort,
		onAddFilter,
		columnDescriptions,
		onColumnDescriptionChange,
		controlsVisible = true,
		toolbarReserveSpace = true,
		toolbarActions,
		executionMs = null
	}: Props = $props();

	function fmtMs(ms: number): string {
		return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
	}

	function computeShapeSignature(cols: string[], resultRows: Record<string, unknown>[]): string {
		return `${cols.join('|')}::${resultRows.length}::${resultRows[0] ? Object.keys(resultRows[0]).join('|') : ''}`;
	}

	// Initialize directly from props so chart view is correct on first render (no flash)
	let viewMode = $state<ResultViewMode>(untrack(() => initialViewMode ?? 'table'));
	let chartConfig = $state<ChartConfig | null>(untrack(() => initialChartConfig ?? null));
	let showConfigPanel = $state(false);
	let lastShapeSignature = $state<string>(untrack(() => computeShapeSignature(columns, rows)));

	// Sync when the parent changes viewMode or chartConfig externally (e.g., AI setting chart view)
	$effect(() => {
		const incoming = initialViewMode;
		if (incoming != null) viewMode = incoming;
	});
	$effect(() => {
		const incoming = initialChartConfig;
		if (incoming != null) chartConfig = incoming;
	});

	$effect(() => {
		const signature = computeShapeSignature(columns, rows);
		if (signature === lastShapeSignature) return;
		lastShapeSignature = signature;
		// Don't override an explicit chart config set by the AI or user
		if (chartConfig != null) return;
		const nextConfig = inferSmartChartConfig(columns, rows);
		chartConfig = nextConfig;
		onChartConfigChange?.(nextConfig);
	});

	const activeConfig = $derived.by((): ChartConfig | null => {
		if (viewMode !== 'chart') return null;
		return chartConfig ?? inferSmartChartConfig(columns, rows);
	});

	function switchView(mode: ResultViewMode) {
		if (mode === 'chart') {
			if (chartConfig === null) chartConfig = inferSmartChartConfig(columns, rows);
			if (!compact) showConfigPanel = true;
		}
		viewMode = mode;
		onViewModeChange?.(mode);
	}

	function onConfigUpdate(cfg: ChartConfig) {
		chartConfig = cfg;
		onChartConfigChange?.(cfg);
	}
</script>

<div class="flex flex-col gap-2">
	<!-- Toolbar -->
	<div
		class="flex items-center justify-between gap-2 overflow-hidden transition-[opacity,height] duration-150 ease-(--motion-ease-out) {controlsVisible
			? 'h-7 opacity-100'
			: toolbarReserveSpace
				? 'pointer-events-none h-7 opacity-0'
				: 'pointer-events-none h-0 opacity-0'}"
		aria-hidden={!controlsVisible}
	>
		<div
			class="inline-flex flex-nowrap items-center gap-0.5 rounded-lg border border-border/60 bg-muted/20 p-0.5"
		>
			<Button
				variant={viewMode === 'table' ? 'secondary' : 'ghost'}
				size="sm"
				class="h-6 gap-1 px-2 text-2xs"
				onclick={() => switchView('table')}
			>
				<Table2 class="h-3 w-3" />
				Table
			</Button>
			<Button
				variant={viewMode === 'chart' ? 'secondary' : 'ghost'}
				size="sm"
				class="h-6 gap-1 px-2 text-2xs"
				onclick={() => switchView('chart')}
			>
				<TrendingUp class="h-3 w-3" />
				Chart
			</Button>
			<Button
				variant={viewMode === 'stats' ? 'secondary' : 'ghost'}
				size="sm"
				class="h-6 gap-1 px-2 text-2xs"
				onclick={() => switchView('stats')}
			>
				<Sigma class="h-3 w-3" />
				Stats
			</Button>
		</div>

		<div class="flex h-7 shrink-0 items-center justify-end gap-1">
			{#if executionMs != null}
				<span class="text-2xs text-muted-foreground tabular-nums" title="Query execution time"
					>{fmtMs(executionMs)}</span
				>
			{/if}
			{#if viewMode === 'chart' && activeConfig && !compact}
				<button
					class="flex h-7 w-7 items-center justify-center rounded transition-colors {showConfigPanel
						? 'bg-primary/15 text-primary'
						: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
					title={showConfigPanel ? 'Hide chart settings' : 'Show chart settings'}
					onclick={() => (showConfigPanel = !showConfigPanel)}
				>
					<Settings2 class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if toolbarActions}
				{@render toolbarActions()}
			{/if}
		</div>
	</div>

	<!-- Content -->
	<!-- Chart/stats are special-cased; everything else (incl. chart view with an
	     unusable config) falls back to the table so the result area is never blank. -->
	{#if viewMode === 'chart' && activeConfig}
		{#if compact}
			<!-- Compact stage preview: just the chart, no config panel -->
			<div class="max-h-52 min-h-40 overflow-hidden">
				<ChartView {rows} {columns} config={activeConfig} />
			</div>
		{:else}
			<!-- Full cell view: left config panel + chart (matches ResultView layout) -->
			<div class="flex overflow-hidden rounded-md">
				{#if showConfigPanel}
					<div
						class="w-52 shrink-0 overflow-y-auto border-r border-border/60 bg-muted/10 px-3 py-3"
					>
						<ChartConfigPanel config={activeConfig} {columns} {rows} onUpdate={onConfigUpdate} />
					</div>
				{/if}
				<div class="min-h-80 min-w-0 flex-1">
					<ChartView {rows} {columns} config={activeConfig} />
				</div>
			</div>
		{/if}
	{:else if viewMode === 'stats'}
		<div class={compact ? 'max-h-52 overflow-auto' : ''}>
			<StatsView {rows} {columns} {name} />
		</div>
	{:else}
		<div class={compact ? 'max-h-52 overflow-auto' : ''}>
			<ResultTable
				{rows}
				{columns}
				{name}
				{truncated}
				pageSize={compact ? 10 : 25}
				headerInsights={compact ? 'compact' : 'full'}
				{onAddSort}
				{onAddFilter}
				{columnDescriptions}
				{onColumnDescriptionChange}
			/>
		</div>
	{/if}
</div>
