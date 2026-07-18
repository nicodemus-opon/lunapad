<script lang="ts">
	import { untrack } from 'svelte';
	import ResultTable from './ResultTable.svelte';
	import ChartView from './ChartView.svelte';
	import ChartConfigurator from './ChartConfigurator.svelte';
	import StatsView from './StatsView.svelte';
	import ResultViewModeSwitcher from './ResultViewModeSwitcher.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Search, X } from '@lucide/svelte';
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
		/** When false, the caption row doesn't reserve height when its static metadata is empty (used when the cell shows output only) */
		toolbarReserveSpace?: boolean;
		/** Show the result name in the caption row — omit when a sibling (e.g. the cell header) already shows it */
		showName?: boolean;
		/** Show the row count in the caption row — omit when a sibling (e.g. the cell status line) already shows it */
		showRowCount?: boolean;
		/** Optional actions rendered on the right side of the toolbar row */
		toolbarActions?: import('svelte').Snippet;
		/** Query execution time in milliseconds */
		executionMs?: number | null;
		/** True when rows were capped at the auto-limit */
		truncated?: boolean;
		/** Fill parent height — used in worksheet view */
		fillHeight?: boolean;
		/** Resolved workspace brand-theme token values for server-rendered
		 *  contexts (the shared report page) — forwarded to ChartView. */
		ssrThemeOverrides?: Record<string, string>;
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
		showName = true,
		showRowCount = true,
		toolbarActions,
		executionMs = null,
		fillHeight = false,
		ssrThemeOverrides
	}: Props = $props();

	let viewMode = $state<ResultViewMode>(untrack(() => initialViewMode ?? 'table'));
	let chartConfig = $state<ChartConfig | null>(untrack(() => initialChartConfig ?? null));
	let lastInitialViewMode = $state<ResultViewMode | undefined>(untrack(() => initialViewMode));
	let lastInitialChartConfig = $state<ChartConfig | null | undefined>(
		untrack(() => initialChartConfig)
	);
	let lastShapeSignature = $state<string>(untrack(() => computeShapeSignature(columns, rows)));
	let tableSearch = $state('');

	const showControls = $derived(controlsVisible || fillHeight);

	// Stats scan every row × column on the main thread; sample huge results.
	const STATS_SAMPLE_MAX = 10_000;
	const statsRows = $derived(
		rows.length > STATS_SAMPLE_MAX ? rows.slice(0, STATS_SAMPLE_MAX) : rows
	);
	const statsSampled = $derived(rows.length > STATS_SAMPLE_MAX);

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

	const hasMeta = $derived(showName || showRowCount || executionMs != null);
</script>

{#snippet controlsCluster()}
	<ResultViewModeSwitcher {viewMode} onSwitch={switchView} />
	{#if viewMode === 'table'}
		<label class="group/search relative hidden items-center sm:flex">
			<Search
				class="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground/45 transition-colors group-focus-within/search:text-muted-foreground"
			/>
			<Input
				class="h-6 w-28 rounded-md border border-transparent bg-transparent pr-6 pl-6 text-2xs text-foreground transition-[width,background-color,border-color] duration-(--motion-fast) ease-(--motion-ease-out) outline-none placeholder:text-muted-foreground/45 hover:bg-muted/35 focus:w-44 focus:border-border focus:bg-background motion-reduce:transition-none"
				type="text"
				placeholder="Search"
				aria-label="Search table"
				bind:value={tableSearch}
			/>
			{#if tableSearch.trim()}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="absolute right-1.5 h-3.5 w-3.5 rounded-full text-muted-foreground/70 hover:text-foreground"
					onclick={() => (tableSearch = '')}
					aria-label="Clear search"
					title="Clear search"
				>
					<X class="h-2.5 w-2.5" />
				</Button>
			{/if}
		</label>
	{/if}
	{#if viewMode === 'chart' && activeConfig && !compact}
		<ChartConfigurator config={activeConfig} {columns} {rows} onUpdate={onConfigUpdate} />
	{/if}
	{#if toolbarActions}
		{@render toolbarActions()}
	{/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="notebook-result flex flex-col gap-1.5 {fillHeight ? 'min-h-0 flex-1' : ''}"
	onmousedown={(e) => e.stopPropagation()}
>
	<!-- Observable-style caption row: static metadata always visible, controls float over the top-right corner -->
	<div
		class="relative flex shrink-0 items-center gap-2 {toolbarReserveSpace || hasMeta ? 'h-6' : ''}"
	>
		<div class="flex min-w-0 items-center gap-2 pr-1">
			{#if showName}
				<span class="truncate font-mono text-2xs text-muted-foreground/80">{name}</span>
			{/if}
			{#if showRowCount}
				<span class="hidden font-mono text-2xs text-muted-foreground/60 tabular-nums sm:inline">
					{rows.length.toLocaleString()} rows
				</span>
			{/if}
			{#if executionMs != null}
				<span
					class="font-mono text-2xs text-muted-foreground tabular-nums"
					title="Query execution time">{fmtMs(executionMs)}</span
				>
			{/if}
		</div>

		<div
			class="absolute top-0 right-0 z-10 flex h-6 min-w-0 items-center gap-1 rounded-md border border-border bg-background/90 px-1.5 shadow-sm backdrop-blur-[2px] transition-opacity duration-(--motion-fast) ease-(--motion-ease-out) {showControls
				? 'opacity-100'
				: 'pointer-events-none opacity-0'}"
			aria-hidden={!showControls}
		>
			{@render controlsCluster()}
		</div>
	</div>

	<!-- Content -->
	<!-- Chart/stats are special-cased; everything else (incl. chart view with an
	     unusable config) falls back to the table so the result area is never blank. -->
	{#if viewMode === 'chart' && activeConfig}
		{#if compact}
			<!-- Compact stage preview: just the chart, no config panel -->
			<div class="max-h-52 min-h-40 overflow-hidden">
				<ChartView {rows} {columns} config={activeConfig} {ssrThemeOverrides} />
			</div>
		{:else if fillHeight}
			<div class="min-h-0 min-w-0 flex-1">
				<ChartView {rows} {columns} config={activeConfig} {ssrThemeOverrides} />
			</div>
		{:else}
			<div class="min-h-80 min-w-0 overflow-hidden rounded-sm">
				<ChartView {rows} {columns} config={activeConfig} {ssrThemeOverrides} />
			</div>
		{/if}
	{:else if viewMode === 'stats'}
		<div
			class="{fillHeight ? 'flex min-h-0 flex-1 flex-col' : ''} {compact
				? 'max-h-64 overflow-auto'
				: ''}"
		>
			<StatsView
				rows={statsRows}
				{columns}
				{name}
				{compact}
				truncated={truncated || statsSampled}
				{fillHeight}
			/>
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
