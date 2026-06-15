<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
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
	import WidthPicker from '$lib/components/dashboard/WidthPicker.svelte';
	import HeightPicker from '$lib/components/dashboard/HeightPicker.svelte';
	import {
		LayoutDashboard, Plus, RefreshCw, X, GripVertical,
		Maximize2, BarChart2, Hash, AlignLeft, Filter, TrendingUp,
		Info, AlertTriangle, AlertCircle, CheckCircle, ChevronDown
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

	// ── Query results map (for value interpolation) ───────────────────────────
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
		{ label: 'Manual', seconds: 0 },
		{ label: 'Every 30s', seconds: 30 },
		{ label: 'Every 1m', seconds: 60 },
		{ label: 'Every 5m', seconds: 300 }
	] as const;
	let refreshSeconds = $state(0);
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let refreshing = $state(false);
	let refreshMenuOpen = $state(false);

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

	// ── Add block menu (command palette) ─────────────────────────────────────
	let addMenuOpen = $state(false);
	let addMenuSearch = $state('');
	let addPanelOpen = $state(false);

	interface BlockOption {
		group: string;
		label: string;
		description: string;
		icon: typeof BarChart2;
		iconColor?: string;
		action: () => void;
	}

	function makeBlockOptions(): BlockOption[] {
		return [
			{
				group: 'Data',
				label: 'Chart',
				description: 'Visualise a query result',
				icon: BarChart2,
				action: () => { addPanelOpen = true; addMenuOpen = false; }
			},
			{
				group: 'Data',
				label: 'KPI / Metric',
				description: 'Big number with optional trend',
				icon: TrendingUp,
				action: addKpi
			},
			{
				group: 'Content',
				label: 'Text',
				description: 'Markdown prose with live values',
				icon: AlignLeft,
				action: addText
			},
			{
				group: 'Content',
				label: 'Section Heading',
				description: 'Organise blocks into sections',
				icon: Hash,
				action: addSection
			},
			{
				group: 'Callouts',
				label: 'Info',
				description: 'Informational callout',
				icon: Info,
				iconColor: 'text-blue-500',
				action: () => addCallout('info')
			},
			{
				group: 'Callouts',
				label: 'Warning',
				description: 'Warning callout',
				icon: AlertTriangle,
				iconColor: 'text-yellow-500',
				action: () => addCallout('warning')
			},
			{
				group: 'Callouts',
				label: 'Error',
				description: 'Error or critical callout',
				icon: AlertCircle,
				iconColor: 'text-red-500',
				action: () => addCallout('error')
			},
			{
				group: 'Callouts',
				label: 'Success',
				description: 'Success or confirmation callout',
				icon: CheckCircle,
				iconColor: 'text-green-500',
				action: () => addCallout('success')
			},
			{
				group: 'Controls',
				label: 'Filter',
				description: 'Interactive filter control',
				icon: Filter,
				action: addFilter
			}
		];
	}

	const blockOptions = $derived.by(() => {
		const all = makeBlockOptions();
		if (!addMenuSearch.trim()) return all;
		const q = addMenuSearch.toLowerCase();
		return all.filter(
			(o) =>
				o.label.toLowerCase().includes(q) ||
				o.description.toLowerCase().includes(q) ||
				o.group.toLowerCase().includes(q)
		);
	});

	const groupedOptions = $derived.by(() => {
		const map = new Map<string, BlockOption[]>();
		for (const opt of blockOptions) {
			if (!map.has(opt.group)) map.set(opt.group, []);
			map.get(opt.group)!.push(opt);
		}
		return map;
	});

	function openAddMenu() {
		addMenuSearch = '';
		addMenuOpen = true;
	}

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

	// ── Direct-set width / height ─────────────────────────────────────────────
	function setBlockWidth(block: DashboardBlock, w: DashboardPanelWidth) {
		updateDashboardBlock(dashboardId, block.id, { width: w });
	}

	function setBlockHeight(block: ChartBlock, h: DashboardPanelHeight) {
		updateDashboardBlock(dashboardId, block.id, { height: h });
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
			refreshMenuOpen = false;
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

	// ── Add menu search input focus ───────────────────────────────────────────
	let searchInputEl = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (addMenuOpen) {
			tick().then(() => searchInputEl?.focus());
		}
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if !dashboard}
	<div class="flex items-center justify-center h-full text-sm text-muted-foreground">
		Dashboard not found.
	</div>
{:else}
	<div class="flex flex-col h-full">
		<div class="flex-1 overflow-y-auto">
			{#if blocksSorted.length === 0}
				<!-- Empty state -->
				<div class="flex flex-col h-full items-center justify-center gap-8 px-10">
					<div class="flex flex-col items-center gap-2 text-center">
						<LayoutDashboard class="w-9 h-9 text-muted-foreground/30 mb-1" />
						<h2 class="text-xl font-bold tracking-tight text-foreground">{dashboard.name}</h2>
						<p class="text-sm text-muted-foreground max-w-xs">Add blocks to build your dashboard — charts, KPIs, text, and more.</p>
					</div>
					<div class="flex gap-3 flex-wrap justify-center">
						<button
							class="flex flex-col items-center gap-3 p-6 rounded-xl border border-border/50 hover:border-primary/50 hover:bg-muted/20 transition-all duration-(--motion-fast) w-32 text-muted-foreground hover:text-foreground"
							onclick={() => { addPanelOpen = true; }}
						>
							<BarChart2 class="w-5 h-5" />
							<span class="text-sm">Chart</span>
						</button>
						<button
							class="flex flex-col items-center gap-3 p-6 rounded-xl border border-border/50 hover:border-primary/50 hover:bg-muted/20 transition-all duration-(--motion-fast) w-32 text-muted-foreground hover:text-foreground"
							onclick={addKpi}
						>
							<TrendingUp class="w-5 h-5" />
							<span class="text-sm">KPI</span>
						</button>
						<button
							class="flex flex-col items-center gap-3 p-6 rounded-xl border border-border/50 hover:border-primary/50 hover:bg-muted/20 transition-all duration-(--motion-fast) w-32 text-muted-foreground hover:text-foreground"
							onclick={addText}
						>
							<AlignLeft class="w-5 h-5" />
							<span class="text-sm">Text</span>
						</button>
						<button
							class="flex flex-col items-center gap-3 p-6 rounded-xl border border-border/50 hover:border-primary/50 hover:bg-muted/20 transition-all duration-(--motion-fast) w-32 text-muted-foreground hover:text-foreground"
							onclick={addFilter}
						>
							<Filter class="w-5 h-5" />
							<span class="text-sm">Filter</span>
						</button>
					</div>
					<button
						class="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-border/50 text-sm text-muted-foreground/50 hover:border-primary/40 hover:text-muted-foreground hover:bg-muted/10 transition-all duration-(--motion-fast)"
						onclick={openAddMenu}
					>
						<Plus class="w-3.5 h-3.5" /> Browse all blocks
					</button>
				</div>
			{:else}
				<!-- Page header -->
				<div class="group/header flex items-start justify-between px-16 pt-12 pb-6 max-w-7xl mx-auto">
					<div class="flex-1 min-w-0 mr-6">
						{#if editingTitle}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								bind:this={titleInputEl}
								class="text-4xl font-bold tracking-tight w-full bg-transparent border-none outline-none focus:ring-0 leading-tight"
								bind:value={titleDraft}
								onblur={commitRename}
								onkeydown={onTitleKey}
								autofocus
							/>
						{:else}
							<button
								class="text-4xl font-bold tracking-tight text-left w-full bg-transparent border-none p-0 leading-tight hover:opacity-70 transition-opacity"
								onclick={startRename}
							>{dashboard.name}</button>
						{/if}
					</div>

					<!-- Header actions — always visible, subtle until hover -->
					<div class="flex items-center gap-1.5 pt-1.5 shrink-0 opacity-30 group-hover/header:opacity-100 transition-opacity duration-(--motion-medium)">
						<!-- Add block button -->
						<div class="relative">
							<button
								class="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
								onclick={openAddMenu}
							>
								<Plus class="w-3.5 h-3.5" />
								Add block
							</button>
							{#if addMenuOpen}
								<!-- Command palette -->
								<div
									class="absolute right-0 top-full mt-1.5 w-72 rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden"
									role="menu"
								>
									<!-- Search -->
									<div class="px-3 pt-3 pb-2 border-b border-border/50">
										<input
											bind:this={searchInputEl}
											bind:value={addMenuSearch}
											class="w-full h-7 bg-muted/50 rounded-md px-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
											placeholder="Search blocks…"
										/>
									</div>
									<!-- Groups -->
									<div class="py-1.5 max-h-80 overflow-y-auto">
										{#if blockOptions.length === 0}
											<p class="px-3 py-4 text-xs text-muted-foreground/50 text-center">No blocks match "{addMenuSearch}"</p>
										{:else}
											{#each [...groupedOptions.entries()] as [group, opts]}
												<p class="px-3 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50">{group}</p>
												{#each opts as opt (opt.label)}
													{@const Icon = opt.icon}
													<button
														class="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
														onclick={opt.action}
														role="menuitem"
													>
														<div class="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
															<Icon class="w-3.5 h-3.5 {opt.iconColor ?? 'text-muted-foreground'}" />
														</div>
														<div class="flex flex-col min-w-0">
															<span class="text-sm font-medium text-foreground leading-tight">{opt.label}</span>
															<span class="text-xs text-muted-foreground leading-tight">{opt.description}</span>
														</div>
													</button>
												{/each}
											{/each}
										{/if}
									</div>
								</div>
								<div class="fixed inset-0 z-40" role="presentation" onclick={() => (addMenuOpen = false)}></div>
							{/if}
						</div>

						<!-- Refresh split button -->
						<div class="flex items-center rounded-lg border border-border/50 overflow-hidden h-7">
							<button
								class="flex items-center gap-1.5 px-2.5 text-xs text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors h-full {refreshing ? 'opacity-50' : ''}"
								onclick={() => void refreshAll()}
								disabled={refreshing}
								title="Refresh all panels"
							>
								<RefreshCw class="w-3 h-3 {refreshing ? 'animate-spin' : ''}" />
								{#if refreshSeconds > 0}
									<span class="text-primary/70 font-medium">{REFRESH_OPTIONS.find(o => o.seconds === refreshSeconds)?.label}</span>
								{:else}
									Refresh
								{/if}
							</button>
							<div class="relative">
								<button
									class="flex items-center px-1.5 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors h-7"
									onclick={() => (refreshMenuOpen = !refreshMenuOpen)}
									title="Auto-refresh interval"
								>
									<ChevronDown class="w-3 h-3" />
								</button>
								{#if refreshMenuOpen}
									<div class="absolute right-0 top-full mt-1 w-40 rounded-xl border border-border bg-popover shadow-lg z-50 py-1.5" role="menu">
										{#each REFRESH_OPTIONS as opt (opt.seconds)}
											<button
												class="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors {refreshSeconds === opt.seconds ? 'text-primary font-medium' : 'text-foreground'}"
												onclick={() => { refreshSeconds = opt.seconds; refreshMenuOpen = false; }}
											>
												{opt.label}
												{#if refreshSeconds === opt.seconds}
													<span class="w-1.5 h-1.5 rounded-full bg-primary shrink-0"></span>
												{/if}
											</button>
										{/each}
									</div>
									<div class="fixed inset-0 z-40" role="presentation" onclick={() => (refreshMenuOpen = false)}></div>
								{/if}
							</div>
						</div>
					</div>
				</div>

				<!-- Grid -->
				<div
					class="grid gap-x-4 gap-y-5 px-16 pb-8 max-w-7xl mx-auto"
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
									onSetWidth={(w) => setBlockWidth(block, w)}
								/>
							{:else if block.type === 'callout'}
								<CalloutBlockComponent
									{block}
									results={queryResultsMap}
									onUpdate={(patch) => updateDashboardBlock(dashboardId, block.id, patch)}
									onRemove={() => removeBlockFromDashboard(dashboardId, block.id)}
									onSetWidth={(w) => setBlockWidth(block, w)}
								/>
							{:else if block.type === 'filter'}
								<FilterBlockComponent
									{block}
									value={filterState[block.paramName] ?? block.defaultValue ?? ''}
									onChange={(v) => { filterState = { ...filterState, [block.paramName]: v }; }}
									onRemove={() => removeBlockFromDashboard(dashboardId, block.id)}
									onSetWidth={(w) => setBlockWidth(block, w)}
								/>
							{:else if block.type === 'kpi'}
								<KpiBlockComponent
									{block}
									results={queryResultsMap}
									onUpdate={(patch) => updateDashboardBlock(dashboardId, block.id, patch)}
									onRemove={() => removeBlockFromDashboard(dashboardId, block.id)}
									onSetWidth={(w) => setBlockWidth(block, w)}
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
									class="group/panel rounded-xl border border-border/35 bg-card overflow-hidden flex flex-col transition-[box-shadow,border-color] duration-(--motion-medium) hover:shadow-sm hover:border-border/55"
									style="height: {HEIGHT_MAP[block.height] + 36}px;"
								>
									<!-- Panel header -->
									<div class="flex items-center gap-1.5 px-3 border-b border-border/20 bg-transparent shrink-0 h-9">
										<button class="drag-handle cursor-grab active:cursor-grabbing text-muted-foreground mr-0.5 opacity-25 group-hover/panel:opacity-100 transition-opacity">
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
													class="text-xs font-medium text-foreground/60 truncate max-w-full text-left hover:text-foreground transition-colors"
													onclick={() => startPanelRename(block)}
													title={panelTitle}
												>{panelTitle}</button>
											{/if}
										</div>
										<div class="flex items-center gap-0.5 opacity-0 group-hover/panel:opacity-100 transition-opacity">
											<WidthPicker width={block.width} onSetWidth={(w) => setBlockWidth(block, w)} />
											<HeightPicker height={block.height} onSetHeight={(h) => setBlockHeight(block, h)} />
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
												<p class="text-[10px] opacity-50">Run the source cell first, then refresh.</p>
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Inline add block affordance -->
				<div class="px-16 pb-12 max-w-7xl mx-auto">
					<button
						class="flex items-center gap-2 w-full py-2.5 px-4 rounded-xl border border-dashed border-border/35 text-xs text-muted-foreground/40 hover:border-primary/40 hover:text-muted-foreground hover:bg-muted/15 transition-all duration-(--motion-fast)"
						onclick={openAddMenu}
					>
						<Plus class="w-3.5 h-3.5" /> Add block
					</button>
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
			class="fixed inset-0 z-100 bg-background/96 backdrop-blur-md flex flex-col"
			role="dialog"
			aria-modal="true"
		>
			<div class="flex items-center justify-between px-8 py-4 border-b border-border/30 shrink-0">
				<span class="text-base font-semibold">
					{fullscreenBlock.title ?? config?.title ?? cell?.outputName ?? fullscreenBlock.cellId}
				</span>
				<button
					class="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
					onclick={() => (fullscreenBlockId = null)}
					title="Close (Esc)"
				>
					<X class="w-4 h-4" />
				</button>
			</div>
			<div class="flex-1 min-h-0 p-8">
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
		<div class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" role="presentation" onclick={() => (addPanelOpen = false)}></div>
		<div class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-120 max-h-[70vh] rounded-2xl border bg-popover shadow-2xl flex flex-col">
			<div class="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
				<p class="text-sm font-semibold">Add Chart Panel</p>
				<button class="text-muted-foreground hover:text-foreground transition-colors h-6 w-6 flex items-center justify-center rounded hover:bg-muted/50" onclick={() => (addPanelOpen = false)}>
					<X class="w-4 h-4" />
				</button>
			</div>
			<div class="flex-1 overflow-y-auto px-5 py-3 space-y-4">
				{#each notebooks as nb (nb.id)}
					{@const queryCells = nb.cells.filter((c) => c.cellType === 'query')}
					{#if queryCells.length > 0}
						<div>
							<p class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2">{nb.name}</p>
							<div class="space-y-0.5">
								{#each queryCells as cell (cell.id)}
									<button
										class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
										onclick={() => addPanel(cell.id, nb.id)}
									>
										<div class="flex-1 min-w-0">
											<p class="text-sm text-foreground truncate font-medium">{cell.outputName}</p>
											{#if cell.result}
												{@const inferredConfig = cell.resultChartConfig ?? inferSmartChartConfig(cell.result.columns, cell.result.rows)}
												<p class="text-xs text-muted-foreground">{inferredConfig.chartType} · {cell.result.rows.length} rows</p>
											{:else}
												<p class="text-xs text-muted-foreground/50">No results — run cell first</p>
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
