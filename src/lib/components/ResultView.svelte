<script lang="ts">
	import ResultTable from '$lib/components/ResultTable.svelte';
	import ChartView from '$lib/components/ChartView.svelte';
	import ChartConfigPanel from '$lib/components/ChartConfigPanel.svelte';
	import StatsView from '$lib/components/StatsView.svelte';
	import { Table2, TrendingUp, Sigma, Maximize2, X, Download, LayoutDashboard, Settings2 } from '@lucide/svelte';
	import { inferSmartChartConfig } from '$lib/utils';
	import {
		setTabViewMode, setTabChartConfig, setCellResultChartConfig,
		getDashboards, createDashboard, addPanelToDashboard, openDashboardTab
	} from '$lib/stores/notebook.svelte';
	import type { ChartConfig, ResultViewMode } from '$lib/types/gui-pipeline';
	import { Popover } from 'bits-ui';

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
	}

	let {
		tabId, cellId = '', notebookId = '', rows, columns,
		name = 'result', viewMode, chartConfig,
		onAddSort, onAddFilter
	}: Props = $props();

	let lastShapeSignature = $state('');
	let expanded = $state(false);
	let showConfigPanel = $state(false);
	let chartContainerEl: HTMLElement | null = $state(null);

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
	function onResizeEnd() { resizing = false; }

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
		if (!lastShapeSignature) { lastShapeSignature = signature; return; }
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

	// ── PNG export (ECharts canvas renderer) ─────────────────────────────────
	function downloadChartPng() {
		const src = chartContainerEl?.querySelector('canvas') as HTMLCanvasElement | null;
		if (!src) return;
		const out = document.createElement('canvas');
		out.width = src.width;
		out.height = src.height;
		const ctx = out.getContext('2d')!;
		const bg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim() || '#ffffff';
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, out.width, out.height);
		ctx.drawImage(src, 0, 0);
		const a = document.createElement('a');
		a.download = `${name || 'chart'}.png`;
		a.href = out.toDataURL('image/png');
		a.click();
	}

	// ── Dashboard pin ─────────────────────────────────────────────────────────
	let dashPopoverOpen = $state(false);

	function pinToDashboard(dashId: string) {
		addPanelToDashboard(dashId, { cellId: cellId || name, notebookId: notebookId || '', width: 1, height: 'md' });
		openDashboardTab(dashId);
		dashPopoverOpen = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && expanded) expanded = false;
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex flex-col h-full">
	<!-- Toolbar -->
	<div class="flex items-center justify-between gap-2 pb-2 shrink-0">
		<div class="flex items-center rounded-xl border border-border/80 bg-muted/25 overflow-hidden shadow-sm">
			<button
				class="flex items-center gap-1.5 px-3 h-7 text-xs transition-colors rounded-l-xl
					{viewMode === 'table' ? 'bg-card text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
				onclick={() => switchView('table')}
			><Table2 class="w-3 h-3" />Table</button>
			<div class="w-px h-7 bg-border/80"></div>
			<button
				class="flex items-center gap-1.5 px-3 h-7 text-xs transition-colors
					{viewMode === 'chart' ? 'bg-card text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
				onclick={() => switchView('chart')}
			><TrendingUp class="w-3 h-3" />Chart</button>
			<div class="w-px h-7 bg-border/80"></div>
			<button
				class="flex items-center gap-1.5 px-3 h-7 text-xs transition-colors rounded-r-xl
					{viewMode === 'stats' ? 'bg-card text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
				onclick={() => switchView('stats')}
			><Sigma class="w-3 h-3" />Statistics</button>
		</div>

		{#if viewMode === 'chart' && activeConfig}
			<div class="flex items-center gap-0.5">
				<!-- Settings panel toggle -->
				<button
					class="h-7 w-7 flex items-center justify-center rounded transition-colors
						{showConfigPanel ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
					title="Chart settings"
					onclick={() => (showConfigPanel = !showConfigPanel)}
				><Settings2 class="w-3.5 h-3.5" /></button>

				<!-- Dashboard pin -->
				<Popover.Root bind:open={dashPopoverOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<button
								class="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
								title="Add to dashboard" {...props}
							><LayoutDashboard class="w-3.5 h-3.5" /></button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Portal>
						<Popover.Content class="z-50 w-56 rounded-lg border bg-popover text-popover-foreground shadow-lg p-2 space-y-1" sideOffset={6} align="end">
							{#if getDashboards().length === 0}
								<button class="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted transition-colors"
									onclick={() => { const d = createDashboard('My Dashboard'); pinToDashboard(d.id); }}>
									New dashboard
								</button>
							{:else}
								{#each getDashboards() as dash (dash.id)}
									<button class="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted transition-colors truncate"
										onclick={() => pinToDashboard(dash.id)}>{dash.name}</button>
								{/each}
								<div class="h-px bg-border my-1"></div>
								<button class="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted transition-colors text-muted-foreground"
									onclick={() => { const d = createDashboard('New Dashboard'); pinToDashboard(d.id); }}>
									+ New dashboard
								</button>
							{/if}
						</Popover.Content>
					</Popover.Portal>
				</Popover.Root>

				<!-- PNG download -->
				<button class="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
					title="Download as PNG" onclick={downloadChartPng}><Download class="w-3.5 h-3.5" /></button>

				<!-- Fullscreen -->
				<button class="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
					title="Fullscreen" onclick={() => (expanded = true)}><Maximize2 class="w-3.5 h-3.5" /></button>
			</div>
		{/if}
	</div>

	<!-- Content -->
	{#if viewMode === 'table'}
		<div class="flex-1 min-h-0">
			<ResultTable {rows} {columns} {name} pageSize={25} {onAddSort} {onAddFilter} />
		</div>
	{:else if viewMode === 'chart' && activeConfig}
		<!-- Split layout: optional left config panel + chart -->
		<div class="flex-1 min-h-0 flex gap-0 overflow-hidden">
			{#if showConfigPanel}
				<div class="w-56 shrink-0 border-r border-border bg-muted/10 overflow-y-auto px-3 py-3">
					<ChartConfigPanel config={activeConfig} {columns} {rows} onUpdate={onConfigUpdate} />
				</div>
			{/if}
			<div class="flex-1 min-w-0 flex flex-col">
				<div class="flex-1 min-h-40" bind:this={chartContainerEl}>
					<ChartView {rows} {columns} config={activeConfig} height={chartHeight} />
				</div>
				<!-- Resize handle -->
				<div
					class="h-2 w-full cursor-ns-resize flex items-center justify-center group select-none touch-none shrink-0"
					role="separator" aria-label="Resize chart"
					onpointerdown={onResizeStart}
					onpointermove={onResizeMove}
					onpointerup={onResizeEnd}
					onpointercancel={onResizeEnd}
				>
					<div class="h-0.5 w-10 rounded-full bg-border/40 group-hover:bg-border transition-colors {resizing ? 'bg-primary/50' : ''}"></div>
				</div>
			</div>
		</div>
	{:else if viewMode === 'stats'}
		<div class="flex-1 min-h-0">
			<StatsView {rows} {columns} {name} />
		</div>
	{/if}
</div>

<!-- Fullscreen overlay -->
{#if expanded && activeConfig}
	<div class="fixed inset-0 z-100 bg-background/95 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true">
		<div class="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
			<span class="text-sm font-medium text-foreground">{activeConfig.title || name}</span>
			<button class="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				onclick={() => (expanded = false)} title="Close fullscreen"><X class="w-4 h-4" /></button>
		</div>
		<div class="flex-1 min-h-0 p-6">
			<ChartView {rows} {columns} config={activeConfig} />
		</div>
	</div>
{/if}
