<script lang="ts">
	import ResultTable from '$lib/components/ResultTable.svelte';
	import ChartView from '$lib/components/ChartView.svelte';
	import ChartConfigPanel from '$lib/components/ChartConfigPanel.svelte';
	import StatsView from '$lib/components/StatsView.svelte';
	import ResultViewModeSwitcher from '$lib/components/ResultViewModeSwitcher.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Maximize2, X, Download, Settings2 } from '@lucide/svelte';
	import { inferSmartChartConfig } from '$lib/utils';
	import {
		setTabViewMode,
		setTabChartConfig,
		setCellResultChartConfig
	} from '$lib/stores/notebook.svelte';
	import type { ChartConfig, ResultViewMode } from '$lib/types/gui-pipeline';
	import type { ColumnConditionalRules } from '$lib/services/report-table-conditional-format';

	interface Props {
		tabId: string;
		cellId?: string;
		notebookId?: string;
		rows: Record<string, unknown>[];
		columns: string[];
		name?: string;
		viewMode: ResultViewMode;
		chartConfig: ChartConfig | null;
		onAddSort?: (column: string, dir: 'asc' | 'desc') => void;
		onAddFilter?: (column: string) => void;
		columnFormatRules?: ColumnConditionalRules;
		/** True when rows were capped at the auto-limit */
		truncated?: boolean;
	}

	let {
		tabId,
		cellId = '',
		notebookId = '',
		rows,
		columns,
		name = 'result',
		viewMode,
		chartConfig,
		onAddSort,
		onAddFilter,
		columnFormatRules = {},
		truncated = false
	}: Props = $props();

	let lastShapeSignature = $state('');
	let expanded = $state(false);
	let showConfigPanel = $state(false);
	let chartViewRef: { exportPng: (filename: string) => Promise<void> } | undefined = $state();

	// ── Chart height resize ───────────────────────────────────────────────────
	const MIN_CHART_HEIGHT = 160;
	const DEFAULT_CHART_HEIGHT = 384;
	let chartHeight = $state(DEFAULT_CHART_HEIGHT);
	let resizing = $state(false);
	let resizeStartY = 0;
	let resizeStartHeight = 0;

	function onResizeStart(e: PointerEvent) {
		resizing = true;
		resizeStartY = e.clientY;
		resizeStartHeight = chartHeight;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onResizeMove(e: PointerEvent) {
		if (!resizing) return;
		chartHeight = Math.max(MIN_CHART_HEIGHT, resizeStartHeight + (e.clientY - resizeStartY));
	}
	function onResizeEnd() {
		resizing = false;
	}

	const activeConfig = $derived.by((): ChartConfig | null => {
		if (viewMode !== 'chart') return null;
		return chartConfig ?? inferSmartChartConfig(columns, rows);
	});

	// Only the column set matters for chart inference — row count changes don't.
	function computeShapeSignature(cols: string[]): string {
		return cols.join('|');
	}

	$effect(() => {
		const signature = computeShapeSignature(columns);
		if (!signature) return;
		if (!lastShapeSignature) {
			lastShapeSignature = signature;
			return;
		}
		if (signature === lastShapeSignature) return;
		lastShapeSignature = signature;
		// Columns changed — re-infer chart only if no user config exists yet.
		if (chartConfig === null) {
			setTabChartConfig(tabId, inferSmartChartConfig(columns, rows));
		}
	});

	function switchView(mode: ResultViewMode) {
		if (mode === 'chart' && chartConfig === null) {
			setTabChartConfig(tabId, inferSmartChartConfig(columns, rows));
		}
		setTabViewMode(tabId, mode);
	}

	function onConfigUpdate(cfg: ChartConfig) {
		setTabChartConfig(tabId, cfg);
		if (cellId) setCellResultChartConfig(cellId, cfg);
	}

	// ── PNG export ────────────────────────────────────────────────────────────
	// Delegates to ChartView's exported exportPng (which forwards to the
	// mounted PlotlyMount) — Plotly.toImage() handles background fill (via the
	// theme's paper_bgcolor) and DPI scaling internally, so there's no SVG
	// cloning/style-inlining to do here.
	async function downloadChartPng() {
		try {
			await chartViewRef?.exportPng(`${name || 'chart'}.png`);
		} catch {
			// table/big-value/value/delta have no chart to export — silently no-op,
			// the Download button is only shown for chart view anyway.
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && expanded) expanded = false;
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex h-full flex-col">
	<!-- Toolbar -->
	<div class="flex shrink-0 items-center justify-between gap-2 pb-2">
		<ResultViewModeSwitcher {viewMode} onSwitch={switchView} size="md" />

		{#if viewMode === 'chart' && activeConfig}
			<div class="flex items-center gap-0.5">
				<Button
					variant="ghost"
					size="icon-sm"
					class={showConfigPanel ? 'bg-primary/10 text-primary' : ''}
					title="Chart settings"
					onclick={() => (showConfigPanel = !showConfigPanel)}
				>
					<Settings2 class="h-3.5 w-3.5" />
				</Button>

				<Button variant="ghost" size="icon-sm" title="Download as PNG" onclick={downloadChartPng}>
					<Download class="h-3.5 w-3.5" />
				</Button>

				<Button variant="ghost" size="icon-sm" title="Fullscreen" onclick={() => (expanded = true)}>
					<Maximize2 class="h-3.5 w-3.5" />
				</Button>
			</div>
		{/if}
	</div>

	<!-- Content -->
	{#if viewMode === 'table'}
		<div class="min-h-0 flex-1">
			<ResultTable
				{rows}
				{columns}
				{name}
				{truncated}
				pageSize={25}
				fillHeight
				{onAddSort}
				{onAddFilter}
				{columnFormatRules}
			/>
		</div>
	{:else if viewMode === 'chart' && activeConfig}
		<!-- Split layout: optional left config panel + chart -->
		<div class="flex min-h-0 flex-1 gap-0 overflow-hidden">
			{#if showConfigPanel}
				<div class="w-56 shrink-0 overflow-y-auto border-r border-border bg-muted/10 px-3 py-3">
					<ChartConfigPanel config={activeConfig} {columns} {rows} onUpdate={onConfigUpdate} />
				</div>
			{/if}
			<div class="flex min-w-0 flex-1 flex-col">
				<div class="min-h-40 flex-1">
					<ChartView
						bind:this={chartViewRef}
						{rows}
						{columns}
						config={activeConfig}
						height={chartHeight}
					/>
				</div>
				<!-- Resize handle -->
				<div
					class="group flex h-2 w-full shrink-0 cursor-ns-resize touch-none items-center justify-center select-none"
					role="separator"
					aria-label="Resize chart"
					onpointerdown={onResizeStart}
					onpointermove={onResizeMove}
					onpointerup={onResizeEnd}
					onpointercancel={onResizeEnd}
				>
					<div
						class="h-0.5 w-10 rounded-full bg-border/40 transition-colors group-hover:bg-border {resizing
							? 'bg-primary/50'
							: ''}"
					></div>
				</div>
			</div>
		</div>
	{:else if viewMode === 'stats'}
		<div class="min-h-0 flex-1 overflow-auto">
			<StatsView {rows} {columns} {name} {truncated} fillHeight />
		</div>
	{/if}
</div>

<!-- Fullscreen overlay -->
{#if expanded && activeConfig}
	<div
		class="fixed inset-0 z-(--z-modal) flex flex-col bg-background/95 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div class="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
			<span class="text-sm font-medium text-foreground">{activeConfig.title || name}</span>
			<button
				class="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
				onclick={() => (expanded = false)}
				title="Close fullscreen"><X class="h-4 w-4" /></button
			>
		</div>
		<div class="min-h-0 flex-1 p-6">
			<ChartView {rows} {columns} config={activeConfig} />
		</div>
	</div>
{/if}
