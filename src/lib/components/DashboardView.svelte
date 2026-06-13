<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	// @ts-ignore — sortablejs types don't export default properly
	import Sortable from 'sortablejs';
	import ChartView from '$lib/components/ChartView.svelte';
	import TextBlockComponent from '$lib/components/dashboard/TextBlock.svelte';
	import CalloutBlockComponent from '$lib/components/dashboard/CalloutBlock.svelte';
	import FilterBlockComponent from '$lib/components/dashboard/FilterBlock.svelte';
	import KpiBlockComponent from '$lib/components/dashboard/KpiBlock.svelte';
	import SectionBlockComponent from '$lib/components/dashboard/SectionBlock.svelte';
	import {
		LayoutDashboard, Plus, RefreshCw, X, GripVertical,
		Maximize2, ChevronDown, BarChart2, Hash, AlignLeft, Filter, TrendingUp
	} from '@lucide/svelte';
	import {
		getDashboards, getNotebooks,
		renameDashboard,
		addPanelToDashboard, removeBlockFromDashboard,
		updateDashboardBlock, reorderDashboardPanels,
		addBlockToDashboard,
		runCell
	} from '$lib/stores/notebook.svelte';
	import { inferSmartChartConfig } from '$lib/utils';
	import type { DashboardBlock, ChartBlock, CalloutBlock, FilterBlock, KpiBlock, SectionBlock, DashboardPanelWidth, DashboardPanelHeight } from '$lib/types/gui-pipeline';
	import type { Cell } from '$lib/stores/notebook.svelte';

	interface Props {
		dashboardId: string;
	}

	const { dashboardId }: Props = $props();

	// ── Reactive dashboard state ──────────────────────────────────────────────
	const dashboard = $derived(getDashboards().find((d) => d.id === dashboardId) ?? null);
	const blocksSorted = $derived(
		dashboard ? [...dashboard.blocks].sort((a, b) => a.order - b.order) : []
	);

	// ── Filter state ──────────────────────────────────────────────────────────
	let filterState = $state<Record<string, string>>({});

	$effect(() => {
		for (const block of blocksSorted) {
			if (block.type !== 'filter') continue;
			if (filterState[block.paramName] === undefined && block.defaultValue) {
				filterState[block.paramName] = block.defaultValue;
			}
		}
	});

	// ── Dashboard-local results (for filtered cells) ──────────────────────────
	let localResults = $state<Record<string, { columns: string[]; rows: Record<string, unknown>[] }>>({});

	// ── Cell lookup (searches ALL notebooks) ─────────────────────────────────
	function findCell(cellId: string): Cell | null {
		const allCells = getNotebooks().flatMap((nb) => nb.cells);
		const byId = allCells.find((c) => c.id === cellId);
		if (byId) return byId;
		const byOutput = allCells.find((c) => c.outputName === cellId);
		if (byOutput) return byOutput;
		const lastName = cellId.split('/').pop() ?? cellId;
		return allCells.find((c) => c.outputName === lastName) ?? null;
	}

	// ── Query results map (for value interpolation in text/kpi/callout blocks) ─
	const queryResultsMap = $derived.by(() => {
		const map = new Map<string, { columns: string[]; rows: Record<string, unknown>[] }>();
		for (const block of blocksSorted) {
			if (block.type !== 'chart') continue;
			const cell = findCell(block.cellId);
			const result = localResults[block.id] ?? cell?.result ?? null;
			if (result) {
				const name = block.cellId.split('/').pop() ?? block.cellId;
				map.set(name, result);
				if (cell?.outputName) map.set(cell.outputName, result);
			}
		}
		return map;
	});

	// ── Chart config resolution ───────────────────────────────────────────────
	function resolveChartConfig(cell: Cell) {
		if (cell.resultChartConfig) return cell.resultChartConfig;
		if (!cell.result) return null;
		return inferSmartChartConfig(cell.result.columns, cell.result.rows);
	}

	// ── Height map ────────────────────────────────────────────────────────────
	const HEIGHT_MAP: Record<DashboardPanelHeight, number> = { sm: 200, md: 320, lg: 480 };

	// ── Dashboard title — click-to-edit ───────────────────────────────────────
	let editingTitle = $state(false);
	let titleDraft = $state('');
	let titleInputEl = $state<HTMLInputElement | null>(null);

	function startRename() {
		titleDraft = dashboard?.name ?? '';
		editingTitle = true;
	}
	function commitRename() {
		if (dashboard && titleDraft.trim()) renameDashboard(dashboardId, titleDraft.trim());
		editingTitle = false;
	}
	function onTitleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') commitRename();
		if (e.key === 'Escape') editingTitle = false;
	}

	$effect(() => {
		if (editingTitle && titleInputEl) titleInputEl.focus();
	});

	// ── Auto-refresh ──────────────────────────────────────────────────────────
	const REFRESH_OPTIONS = [
		{ label: 'Off', seconds: 0 },
		{ label: '30s', seconds: 30 },
		{ label: '1m', seconds: 60 },
		{ label: '5m', seconds: 300 }
	] as const;
	let refreshSeconds = $state(0);
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let refreshing = $state(false);

	$effect(() => {
		if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
		if (refreshSeconds > 0) {
			refreshTimer = setInterval(() => void refreshAll(), refreshSeconds * 1000);
		}
	});

	onMount(() => { void refreshAll(); });
	onDestroy(() => { if (refreshTimer) clearInterval(refreshTimer); });

	async function refreshAll() {
		if (!dashboard || refreshing) return;
		refreshing = true;
		const ids = blocksSorted
			.filter((b): b is ChartBlock => b.type === 'chart')
			.map((b) => findCell(b.cellId)?.id)
			.filter(Boolean) as string[];
		await Promise.all(ids.map((id) => runCell(id)));
		refreshing = false;
	}

	// ── Add block menu ────────────────────────────────────────────────────────
	let addMenuOpen = $state(false);
	let addPanelOpen = $state(false);

	function addKpi() {
		addBlockToDashboard(dashboardId, { type: 'kpi', label: 'Metric', valueExpr: '', width: 1 });
		addMenuOpen = false;
	}

	function addText() {
		addBlockToDashboard(dashboardId, { type: 'text', markdown: '', width: 3 });
		addMenuOpen = false;
	}

	function addSection() {
		addBlockToDashboard(dashboardId, { type: 'section', heading: 'Section', level: 1, width: 3 });
		addMenuOpen = false;
	}

	function addCallout(variant: CalloutBlock['variant']) {
		addBlockToDashboard(dashboardId, { type: 'callout', variant, markdown: '', width: 3 });
		addMenuOpen = false;
	}

	function addFilter() {
		addBlockToDashboard(dashboardId, {
			type: 'filter',
			filterKind: 'dropdown',
			label: 'Filter',
			paramName: `filter_${Date.now()}`,
			width: 1
		});
		addMenuOpen = false;
	}

	function addPanel(cellUuid: string, notebookId: string) {
		if (!dashboard) return;
		addPanelToDashboard(dashboardId, { cellId: cellUuid, notebookId, width: 2, height: 'md' });
		addPanelOpen = false;
		addMenuOpen = false;
	}

	// ── Panel inline title editing ─────────────────────────────────────────────
	let editingBlockId = $state<string | null>(null);
	let panelTitleDraft = $state('');

	function startPanelRename(block: ChartBlock) {
		editingBlockId = block.id;
		panelTitleDraft = block.title ?? '';
	}
	function commitPanelRename() {
		if (editingBlockId && dashboard) {
			updateDashboardBlock(dashboardId, editingBlockId, { title: panelTitleDraft || undefined });
		}
		editingBlockId = null;
	}
	function onPanelTitleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') commitPanelRename();
		if (e.key === 'Escape') editingBlockId = null;
	}

	// ── Width cycling ─────────────────────────────────────────────────────────
	const WIDTH_LABELS: Record<DashboardPanelWidth, string> = { 1: 'S', 2: 'M', 3: 'L' };
	const WIDTH_CYCLE: DashboardPanelWidth[] = [1, 2, 3];

	function cycleWidth(block: DashboardBlock) {
		const i = WIDTH_CYCLE.indexOf(block.width);
		updateDashboardBlock(dashboardId, block.id, { width: WIDTH_CYCLE[(i + 1) % WIDTH_CYCLE.length] });
	}

	// ── Height cycling (chart blocks only) ────────────────────────────────────
	const HEIGHT_CYCLE: DashboardPanelHeight[] = ['sm', 'md', 'lg'];

	function cycleHeight(block: ChartBlock) {
		const i = HEIGHT_CYCLE.indexOf(block.height);
		updateDashboardBlock(dashboardId, block.id, { height: HEIGHT_CYCLE[(i + 1) % HEIGHT_CYCLE.length] });
	}

	// ── Fullscreen ────────────────────────────────────────────────────────────
	let fullscreenBlockId = $state<string | null>(null);
	const fullscreenBlock = $derived(
		blocksSorted.find((b): b is ChartBlock => b.id === fullscreenBlockId && b.type === 'chart') ?? null
	);

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (fullscreenBlockId) { fullscreenBlockId = null; return; }
			addMenuOpen = false;
		}
	}

	// ── SortableJS drag-to-reorder ────────────────────────────────────────────
	let gridEl: HTMLElement | null = $state(null);
	let sortable: Sortable | null = null;

	$effect(() => {
		if (!gridEl) return;
		sortable?.destroy();
		sortable = Sortable.create(gridEl, {
			animation: 150,
			handle: '.drag-handle',
			ghostClass: 'opacity-30',
			onEnd() {
				const items = [...gridEl!.querySelectorAll('[data-block-id]')];
				const newOrder = items.map((el) => (el as HTMLElement).dataset.blockId!);
				reorderDashboardPanels(dashboardId, newOrder);
			}
		});
		return () => { sortable?.destroy(); sortable = null; };
	});

	const notebooks = $derived(getNotebooks());
</script>

<svelte:window onkeydown={onKeydown} />

{#if !dashboard}
	<div class="flex items-center justify-center h-full text-sm text-muted-foreground">
		Dashboard not found.
	</div>
{:else}
	<div class="flex flex-col h-full">
		<!-- Minimal toolbar: Add Block + Refresh only -->
		<div class="flex items-center gap-2 px-4 py-2 border-b border-border/70 bg-sidebar/40 shrink-0">
			<div class="flex-1"></div>

			<!-- Add block menu -->
			<div class="relative">
				<button
					class="flex items-center gap-1.5 h-7 px-3 rounded-md text-xs border border-border/70 bg-background shadow-2xs hover:bg-muted/40 hover:border-border transition-[background-color,border-color] duration-(--motion-fast) text-foreground"
					onclick={() => (addMenuOpen = !addMenuOpen)}
				>
					<Plus class="w-3 h-3" />
					Add Block
					<ChevronDown class="w-3 h-3 opacity-60" />
				</button>
				{#if addMenuOpen}
					<div
						class="absolute right-0 top-full mt-1 w-48 rounded-xl border border-border bg-popover shadow-lg z-50 py-1.5"
						role="menu"
					>
						<button
							class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors"
							onclick={() => { addPanelOpen = true; addMenuOpen = false; }}
						>
							<BarChart2 class="w-3.5 h-3.5 text-muted-foreground" />
							Chart
						</button>
						<button
							class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors"
							onclick={addKpi}
						>
							<TrendingUp class="w-3.5 h-3.5 text-muted-foreground" />
							KPI / Metric
						</button>
						<div class="border-t border-border/50 my-1"></div>
						<button
							class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors"
							onclick={addText}
						>
							<AlignLeft class="w-3.5 h-3.5 text-muted-foreground" />
							Text
						</button>
						<button
							class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors"
							onclick={addSection}
						>
							<Hash class="w-3.5 h-3.5 text-muted-foreground" />
							Section Heading
						</button>
						<div class="border-t border-border/50 my-1"></div>
						<button class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors" onclick={() => addCallout('info')}>
							<span class="w-3.5 h-3.5 rounded-full bg-blue-400/40 shrink-0"></span>
							Callout — Info
						</button>
						<button class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors" onclick={() => addCallout('warning')}>
							<span class="w-3.5 h-3.5 rounded-full bg-yellow-400/40 shrink-0"></span>
							Callout — Warning
						</button>
						<button class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors" onclick={() => addCallout('error')}>
							<span class="w-3.5 h-3.5 rounded-full bg-red-400/40 shrink-0"></span>
							Callout — Error
						</button>
						<button class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors" onclick={() => addCallout('success')}>
							<span class="w-3.5 h-3.5 rounded-full bg-green-400/40 shrink-0"></span>
							Callout — Success
						</button>
						<div class="border-t border-border/50 my-1"></div>
						<button class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors" onclick={addFilter}>
							<Filter class="w-3.5 h-3.5 text-muted-foreground" />
							Filter Control
						</button>
					</div>
					<div class="fixed inset-0 z-40" role="presentation" onclick={() => (addMenuOpen = false)}></div>
				{/if}
			</div>

			<!-- Refresh + auto-refresh -->
			<button
				class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs border border-border/70 bg-background shadow-2xs hover:bg-muted/40 hover:border-border transition-[background-color,border-color] duration-(--motion-fast) text-foreground {refreshing ? 'opacity-60' : ''}"
				onclick={() => void refreshAll()}
				disabled={refreshing}
				title="Refresh all panels"
			>
				<RefreshCw class="w-3 h-3 {refreshing ? 'animate-spin' : ''}" />
				Refresh
			</button>

			<select
				class="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none"
				bind:value={refreshSeconds}
			>
				{#each REFRESH_OPTIONS as opt (opt.seconds)}
					<option value={opt.seconds}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<!-- Canvas -->
		<div class="flex-1 overflow-y-auto">
			{#if blocksSorted.length === 0}
				<!-- Empty state -->
				<div class="flex flex-col h-full items-center justify-center gap-6 px-10">
					<div class="flex flex-col items-center gap-2 text-center">
						<LayoutDashboard class="w-8 h-8 text-muted-foreground/40" />
						<h2 class="text-base font-semibold text-foreground">{dashboard.name}</h2>
						<p class="text-sm text-muted-foreground">Add your first block to get started.</p>
					</div>
					<div class="flex gap-3 flex-wrap justify-center">
						<button
							class="flex flex-col items-center gap-2.5 p-5 rounded-xl border border-border hover:border-primary/60 hover:bg-muted/30 transition-colors w-28 text-muted-foreground hover:text-foreground"
							onclick={() => { addPanelOpen = true; }}
						>
							<BarChart2 class="w-5 h-5" />
							<span class="text-xs">Chart</span>
						</button>
						<button
							class="flex flex-col items-center gap-2.5 p-5 rounded-xl border border-border hover:border-primary/60 hover:bg-muted/30 transition-colors w-28 text-muted-foreground hover:text-foreground"
							onclick={addKpi}
						>
							<TrendingUp class="w-5 h-5" />
							<span class="text-xs">KPI</span>
						</button>
						<button
							class="flex flex-col items-center gap-2.5 p-5 rounded-xl border border-border hover:border-primary/60 hover:bg-muted/30 transition-colors w-28 text-muted-foreground hover:text-foreground"
							onclick={addText}
						>
							<AlignLeft class="w-5 h-5" />
							<span class="text-xs">Text</span>
						</button>
						<button
							class="flex flex-col items-center gap-2.5 p-5 rounded-xl border border-border hover:border-primary/60 hover:bg-muted/30 transition-colors w-28 text-muted-foreground hover:text-foreground"
							onclick={addFilter}
						>
							<Filter class="w-5 h-5" />
							<span class="text-xs">Filter</span>
						</button>
					</div>
				</div>
			{:else}
				<!-- Page title (click to edit) -->
				<div class="px-10 pt-8 pb-4">
					{#if editingTitle}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							bind:this={titleInputEl}
							class="text-2xl font-semibold tracking-tight w-full bg-transparent border-none outline-none focus:ring-0"
							bind:value={titleDraft}
							onblur={commitRename}
							onkeydown={onTitleKey}
							autofocus
						/>
					{:else}
						<button
							class="text-2xl font-semibold tracking-tight text-left w-full hover:opacity-60 transition-opacity bg-transparent border-none p-0"
							onclick={startRename}
						>{dashboard.name}</button>
					{/if}
				</div>

				<!-- Grid -->
				<div
					class="grid gap-5 px-10 pb-10"
					style="grid-template-columns: repeat(3, 1fr);"
					bind:this={gridEl}
				>
					{#each blocksSorted as block (block.id)}
						<div
							data-block-id={block.id}
							style="grid-column: span {block.type === 'section' ? 3 : block.width};"
							in:fly={{ y: 8, duration: 220 }}
							animate:flip={{ duration: 220 }}
						>
							{#if block.type === 'text'}
								<TextBlockComponent
									{block}
									results={queryResultsMap}
									onUpdate={(md) => updateDashboardBlock(dashboardId, block.id, { markdown: md })}
									onRemove={() => removeBlockFromDashboard(dashboardId, block.id)}
									onCycleWidth={() => cycleWidth(block)}
								/>
							{:else if block.type === 'callout'}
								<CalloutBlockComponent
									{block}
									results={queryResultsMap}
									onUpdate={(patch) => updateDashboardBlock(dashboardId, block.id, patch)}
									onRemove={() => removeBlockFromDashboard(dashboardId, block.id)}
									onCycleWidth={() => cycleWidth(block)}
								/>
							{:else if block.type === 'filter'}
								<FilterBlockComponent
									{block}
									value={filterState[block.paramName] ?? block.defaultValue ?? ''}
									onChange={(v) => { filterState = { ...filterState, [block.paramName]: v }; }}
									onRemove={() => removeBlockFromDashboard(dashboardId, block.id)}
									onCycleWidth={() => cycleWidth(block)}
								/>
							{:else if block.type === 'kpi'}
								<KpiBlockComponent
									{block}
									results={queryResultsMap}
									onUpdate={(patch) => updateDashboardBlock(dashboardId, block.id, patch)}
									onRemove={() => removeBlockFromDashboard(dashboardId, block.id)}
									onCycleWidth={() => cycleWidth(block)}
								/>
							{:else if block.type === 'section'}
								<SectionBlockComponent
									{block}
									onUpdate={(patch) => updateDashboardBlock(dashboardId, block.id, patch)}
									onRemove={() => removeBlockFromDashboard(dashboardId, block.id)}
								/>
							{:else if block.type === 'chart'}
								{@const cell = findCell(block.cellId)}
								{@const result = localResults[block.id] ?? cell?.result ?? null}
								{@const config = result && cell ? resolveChartConfig({ ...cell, result }) : (cell ? resolveChartConfig(cell) : null)}
								{@const panelTitle = block.title ?? config?.title ?? cell?.outputName ?? block.cellId}
								<div
									class="group/panel rounded-xl border border-border/60 bg-card surface-raised overflow-hidden flex flex-col transition-[box-shadow,border-color] duration-(--motion-medium) hover:shadow-md hover:border-border/80"
									style="height: {HEIGHT_MAP[block.height] + 48}px;"
								>
									<!-- Panel header -->
									<div class="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-muted/20 shrink-0 h-10">
										<button class="drag-handle cursor-grab active:cursor-grabbing text-muted-foreground mr-0.5 opacity-20 group-hover/panel:opacity-100 transition-opacity">
											<GripVertical class="w-3 h-3" />
										</button>
										<div class="flex-1 min-w-0">
											{#if editingBlockId === block.id}
												<!-- svelte-ignore a11y_autofocus -->
												<input
													class="w-full text-xs bg-transparent border-b border-primary focus:outline-none"
													bind:value={panelTitleDraft}
													onblur={commitPanelRename}
													onkeydown={onPanelTitleKey}
													autofocus
												/>
											{:else}
												<button
													class="text-xs font-medium text-foreground/70 truncate max-w-full text-left hover:text-foreground transition-colors"
													onclick={() => startPanelRename(block)}
													title={panelTitle}
												>{panelTitle}</button>
											{/if}
										</div>
										<div class="flex items-center gap-0.5 opacity-0 group-hover/panel:opacity-100 transition-opacity">
											<button
												class="text-[10px] font-mono px-1 h-5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
												onclick={() => cycleWidth(block)} title="Cycle width"
											>{WIDTH_LABELS[block.width]}</button>
											<button
												class="text-[10px] px-1 h-5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
												onclick={() => cycleHeight(block)} title="Cycle height"
											>{block.height.toUpperCase()}</button>
											<button
												class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
												onclick={() => (fullscreenBlockId = block.id)} title="Fullscreen"
											><Maximize2 class="w-3 h-3" /></button>
											<button
												class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
												onclick={() => removeBlockFromDashboard(dashboardId, block.id)} title="Remove"
											><X class="w-3 h-3" /></button>
										</div>
									</div>

									<!-- Chart body -->
									<div class="flex-1 min-h-0 p-2 overflow-hidden">
										{#if cell && result && config}
											<div style="height:{HEIGHT_MAP[block.height]}px; overflow:hidden;">
												<ChartView
													rows={result.rows}
													columns={result.columns}
													{config}
													height={HEIGHT_MAP[block.height]}
												/>
											</div>
										{:else if cell && !cell.result && !localResults[block.id]}
											<div class="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
												<p class="text-xs">No results yet — run the cell first.</p>
												<button
													class="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted/50 transition-colors"
													onclick={() => cell && runCell(cell.id)}
												>Run query</button>
											</div>
										{:else if cell && result && !config}
											<div class="flex items-center justify-center h-full text-xs text-muted-foreground">
												Could not infer chart config.
											</div>
										{:else}
											<div class="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
												<p class="text-xs">Cell not found.</p>
												<p class="text-[10px] opacity-60">Run the source cell first, then refresh.</p>
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Fullscreen overlay -->
	{#if fullscreenBlock}
		{@const cell = findCell(fullscreenBlock.cellId)}
		{@const result = localResults[fullscreenBlock.id] ?? cell?.result ?? null}
		{@const config = result && cell ? resolveChartConfig({ ...cell, result }) : (cell ? resolveChartConfig(cell) : null)}
		<div
			class="fixed inset-0 z-100 bg-background/95 backdrop-blur-sm flex flex-col"
			role="dialog"
			aria-modal="true"
		>
			<div class="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
				<span class="text-sm font-medium">
					{fullscreenBlock.title ?? config?.title ?? cell?.outputName ?? fullscreenBlock.cellId}
				</span>
				<button
					class="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
					onclick={() => (fullscreenBlockId = null)}
					title="Close"
				>
					<X class="w-4 h-4" />
				</button>
			</div>
			<div class="flex-1 min-h-0 p-6">
				{#if result && config}
					<ChartView
						rows={result.rows}
						columns={result.columns}
						{config}
					/>
				{:else}
					<div class="flex items-center justify-center h-full text-sm text-muted-foreground">
						No chart data available.
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Add Panel dialog -->
	{#if addPanelOpen}
		<div class="fixed inset-0 z-50 bg-black/50" role="presentation" onclick={() => (addPanelOpen = false)}></div>
		<div class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-120 max-h-[70vh] rounded-xl border bg-popover shadow-xl flex flex-col">
			<div class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
				<p class="text-sm font-semibold">Add Chart Panel</p>
				<button class="text-muted-foreground hover:text-foreground transition-colors" onclick={() => (addPanelOpen = false)}>
					<X class="w-4 h-4" />
				</button>
			</div>
			<div class="flex-1 overflow-y-auto px-5 py-3 space-y-4">
				{#each notebooks as nb (nb.id)}
					{@const queryCells = nb.cells.filter((c) => c.cellType === 'query')}
					{#if queryCells.length > 0}
						<div>
							<p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">{nb.name}</p>
							<div class="space-y-1">
								{#each queryCells as cell (cell.id)}
									<button
										class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
										onclick={() => addPanel(cell.id, nb.id)}
									>
										<div class="flex-1 min-w-0">
											<p class="text-sm text-foreground truncate">{cell.outputName}</p>
											{#if cell.result}
												{@const inferredConfig = cell.resultChartConfig ?? inferSmartChartConfig(cell.result.columns, cell.result.rows)}
												<p class="text-xs text-muted-foreground">{inferredConfig.chartType} · {cell.result.rows.length} rows</p>
											{:else}
												<p class="text-xs text-muted-foreground opacity-60">No results — run cell first</p>
											{/if}
										</div>
										<Plus class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}
{/if}
