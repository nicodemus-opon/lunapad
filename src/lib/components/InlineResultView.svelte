<script lang="ts">
	import { untrack } from 'svelte';
	import ResultTable from './ResultTable.svelte';
	import ChartView from './ChartView.svelte';
	import ChartConfigPanel from './ChartConfigPanel.svelte';
	import StatsView from './StatsView.svelte';
	import ResultViewModeSwitcher from './ResultViewModeSwitcher.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Settings2, Search, X } from '@lucide/svelte';
	import { inferSmartChartConfig } from '$lib/utils';
	import type { ChartConfig, ResultViewMode } from '$lib/types/gui-pipeline';
	import type { ColumnConditionalRules } from '$lib/services/report-table-conditional-format';

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
		columnFormatRules?: ColumnConditionalRules;
		onColumnFormatRulesChange?: (rules: ColumnConditionalRules) => void;
		columnWidths?: Record<string, number>;
		onColumnWidthsChange?: (widths: Record<string, number>) => void;
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
		/** Fill parent height — used in worksheet view */
		fillHeight?: boolean;
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
		columnFormatRules = {},
		onColumnFormatRulesChange,
		columnWidths,
		onColumnWidthsChange,
		controlsVisible = true,
		toolbarReserveSpace = true,
		toolbarActions,
		executionMs = null,
		fillHeight = false
	}: Props = $props();

	let viewMode = $state<ResultViewMode>(untrack(() => initialViewMode ?? 'table'));
	let chartConfig = $state<ChartConfig | null>(untrack(() => initialChartConfig ?? null));
	let showConfigPanel = $state(false);
	let lastInitialViewMode = $state<ResultViewMode | undefined>(untrack(() => initialViewMode));
	let lastInitialChartConfig = $state<ChartConfig | null | undefined>(
		untrack(() => initialChartConfig)
	);
	let lastShapeSignature = $state<string>(untrack(() => computeShapeSignature(columns, rows)));
	let tableSearch = $state('');

	const showControls = $derived(controlsVisible || fillHeight || showConfigPanel);

	function fmtMs(ms: number): string {
		return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
	}

	function computeShapeSignature(cols: string[], resultRows: Record<string, unknown>[]): string {
		return `${cols.join('|')}::${resultRows.length}::${resultRows[0] ? Object.keys(resultRows[0]).join('|') : ''}`;
	}

	// Sync when the parent changes viewMode or chartConfig externally (e.g., AI setting chart view)
	$effect(() => {
		const incoming = initialViewMode;
		if (incoming === lastInitialViewMode) return;
		lastInitialViewMode = incoming;
		if (incoming != null) {
			viewMode = incoming;
		}
	});
	$effect(() => {
		const incoming = initialChartConfig;
		if (incoming === lastInitialChartConfig) return;
		lastInitialChartConfig = incoming;
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
		}
		viewMode = mode;
		lastInitialViewMode = mode;
		onViewModeChange?.(mode);
	}

	function onConfigUpdate(cfg: ChartConfig) {
		chartConfig = cfg;
		lastInitialChartConfig = cfg;
		onChartConfigChange?.(cfg);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="notebook-result flex flex-col gap-1.5 {fillHeight ? 'min-h-0 flex-1' : ''}"
	onmousedown={(e) => e.stopPropagation()}
>
	<!-- Observable-style caption row -->
	<div
		class="flex shrink-0 items-center justify-between gap-2 overflow-hidden transition-[opacity,height] duration-(--motion-fast) ease-(--motion-ease-out) {showControls
			? 'h-6 opacity-100'
			: toolbarReserveSpace
				? 'pointer-events-none h-6 opacity-0'
				: 'pointer-events-none h-0 opacity-0'}"
		aria-hidden={!showControls}
	>
		<div class="flex min-w-0 items-center gap-2">
			<span class="truncate font-mono text-2xs text-muted-foreground/80">{name}</span>
			<span class="hidden font-mono text-2xs text-muted-foreground/60 tabular-nums sm:inline">
				{rows.length.toLocaleString()} rows
			</span>
		</div>

		<div class="flex h-6 min-w-0 shrink-0 items-center justify-end gap-1">
			<ResultViewModeSwitcher {viewMode} onSwitch={switchView} />
			{#if viewMode === 'table'}
				<label class="group/search relative hidden items-center sm:flex">
					<Search
						class="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground/45 transition-colors group-focus-within/search:text-muted-foreground"
					/>
					<input
						class="h-6 w-28 rounded-md border border-transparent bg-transparent pr-6 pl-6 text-2xs text-foreground transition-[width,background-color,border-color] duration-(--motion-fast) ease-(--motion-ease-out) outline-none placeholder:text-muted-foreground/45 hover:bg-muted/35 focus:w-44 focus:border-border focus:bg-background motion-reduce:transition-none"
						type="text"
						placeholder="Search"
						aria-label="Search table"
						bind:value={tableSearch}
					/>
					{#if tableSearch.trim()}
						<button
							type="button"
							class="absolute right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground"
							onclick={() => (tableSearch = '')}
							aria-label="Clear search"
							title="Clear search"
						>
							<X class="h-2.5 w-2.5" />
						</button>
					{/if}
				</label>
			{/if}
			{#if executionMs != null}
				<span class="font-mono text-2xs text-muted-foreground tabular-nums" title="Query execution time"
					>{fmtMs(executionMs)}</span
				>
			{/if}
			{#if viewMode === 'chart' && activeConfig && !compact}
				<button
					class="flex h-6 w-6 items-center justify-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 {showConfigPanel
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
		{:else if fillHeight}
			<div class="flex min-h-0 flex-1 gap-0 overflow-hidden">
				{#if showConfigPanel}
					<div
						class="chart-config-panel w-52 shrink-0 overflow-y-auto border-r border-border bg-muted/10 px-3 py-3"
					>
						<ChartConfigPanel config={activeConfig} {columns} {rows} onUpdate={onConfigUpdate} />
					</div>
				{/if}
				<div class="min-h-0 min-w-0 flex-1">
					<ChartView {rows} {columns} config={activeConfig} />
				</div>
			</div>
		{:else}
			<!-- Full cell view: left config panel + chart (matches ResultView layout) -->
			<div class="flex overflow-hidden rounded-sm">
				{#if showConfigPanel}
					<div
						class="chart-config-panel w-52 shrink-0 overflow-y-auto border-r border-border bg-muted/10 px-3 py-3"
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
		<div
			class="{fillHeight ? 'flex min-h-0 flex-1 flex-col' : ''} {compact
				? 'max-h-64 overflow-auto'
				: ''}"
		>
			<StatsView {rows} {columns} {name} {compact} {truncated} {fillHeight} />
		</div>
	{:else}
		<div
			class="{fillHeight ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : ''} {compact
				? 'max-h-52 overflow-auto'
				: ''}"
		>
			<ResultTable
				{rows}
				{columns}
				{name}
				{truncated}
				pageSize={compact ? 10 : 25}
				headerInsights={compact ? 'compact' : 'full'}
				{fillHeight}
				{onAddSort}
				{onAddFilter}
				{columnDescriptions}
				{onColumnDescriptionChange}
				{columnFormatRules}
				{onColumnFormatRulesChange}
				{columnWidths}
				{onColumnWidthsChange}
				searchValue={tableSearch}
				onSearchValueChange={(value) => (tableSearch = value)}
				showSearch={false}
			/>
		</div>
	{/if}
</div>
