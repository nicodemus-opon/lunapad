<script lang="ts">
	import ResultTable from '$lib/components/ResultTable.svelte';
	import ChartView from '$lib/components/ChartView.svelte';
	import ChartConfigPanel from '$lib/components/ChartConfigPanel.svelte';
	import StatsView from '$lib/components/StatsView.svelte';
	import { Table2, TrendingUp, Sigma, Maximize2, X, Download, Settings2 } from '@lucide/svelte';
	import { inferSmartChartConfig } from '$lib/utils';
	import { setTabViewMode, setTabChartConfig, setCellResultChartConfig } from '$lib/stores/notebook.svelte';
	import type { ChartConfig, ResultViewMode } from '$lib/types/gui-pipeline';

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
		/** True when rows were capped at the auto-limit */
		truncated?: boolean;
	}

	let {
		tabId, cellId = '', notebookId = '', rows, columns,
		name = 'result', viewMode, chartConfig,
		onAddSort, onAddFilter, truncated = false
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

	// ── PNG export ────────────────────────────────────────────────────────────
	// Charts render as Plot/hand-built SVG; export by serializing the SVG with
	// inlined computed styles (CSS vars don't resolve on a detached/serialized node).
	function inlineComputedStyles(srcRoot: Element, dstRoot: Element) {
		const srcEls = [srcRoot, ...srcRoot.querySelectorAll('*')];
		const dstEls = [dstRoot, ...dstRoot.querySelectorAll('*')];
		const PROPS = ['fill', 'stroke', 'color', 'font-family', 'font-size', 'opacity', 'stroke-width', 'stroke-dasharray'];
		for (let i = 0; i < srcEls.length; i++) {
			const computed = getComputedStyle(srcEls[i]);
			const decls = PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(';');
			const existing = (dstEls[i] as HTMLElement).getAttribute('style') ?? '';
			(dstEls[i] as HTMLElement).setAttribute('style', `${decls};${existing}`);
		}
	}

	function downloadSvgPng(svg: SVGSVGElement) {
		const clone = svg.cloneNode(true) as SVGSVGElement;
		// Resolve var(--chart-1)-style colors to concrete values while still
		// attached to the document, then inline them onto the (soon detached)
		// clone — a serialized SVG can't resolve CSS vars on its own.
		inlineComputedStyles(svg, clone);
		const xml = new XMLSerializer().serializeToString(clone);
		const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
		const img = new Image();
		img.onload = () => {
			const rect = svg.getBoundingClientRect();
			const scale = window.devicePixelRatio || 1;
			const out = document.createElement('canvas');
			out.width = rect.width * scale;
			out.height = rect.height * scale;
			const ctx = out.getContext('2d')!;
			const bg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim() || '#ffffff';
			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, out.width, out.height);
			ctx.drawImage(img, 0, 0, out.width, out.height);
			const a = document.createElement('a');
			a.download = `${name || 'chart'}.png`;
			a.href = out.toDataURL('image/png');
			a.click();
			URL.revokeObjectURL(url);
		};
		img.src = url;
	}

	function downloadChartPng() {
		const svg = chartContainerEl?.querySelector('svg');
		if (svg) downloadSvgPng(svg);
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
			<ResultTable {rows} {columns} {name} {truncated} pageSize={25} fillHeight {onAddSort} {onAddFilter} />
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
