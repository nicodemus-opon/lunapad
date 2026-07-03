<script lang="ts">
	import { tick } from 'svelte';
	import { getDbtModels, setActiveTab, getNotebooks, type Cell } from '$lib/stores/notebook.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import {
		CheckCircle2,
		XCircle,
		Minus,
		BookOpen,
		Plus,
		ZoomIn,
		ZoomOut,
		Maximize2,
		FlaskConical,
		Database,
		Terminal,
		ChartLine,
		Loader2
	} from '@lucide/svelte';
	import type { DbtModel } from '$lib/server/dbt';

	interface Props {
		focusedModelName?: string;
	}

	// Reused as the focused *node* name across both kinds (model or cell) — the
	// prop name stays as-is since it's a pre-existing bindable contract with
	// +page.svelte, just repurposed slightly broader internally.
	let { focusedModelName = $bindable() }: Props = $props();

	const dbtModels = $derived(getDbtModels());
	const notebooks = $derived(getNotebooks());

	function escapeRe(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	// ── Unified lineage entries: real dbt models (from the manifest) + live,
	// un-promoted notebook cells (query/python/plot) — so an analytics engineer
	// can see "where does this Python cell's data come from" without promoting
	// everything to a model first. Cells reference each other by outputName the
	// same whole-word way every dependency resolver in cell-deps.ts works.
	interface ModelEntry {
		kind: 'model';
		key: string;
		name: string;
		upstreamRefs: string[];
		model: DbtModel;
	}
	interface CellEntry {
		kind: 'cell';
		key: string;
		name: string;
		upstreamRefs: string[];
		cell: Cell;
		notebookId: string;
		notebookName: string;
	}
	type LineageEntry = ModelEntry | CellEntry;

	const CELL_KINDS = new Set<Cell['cellType']>(['query', 'python', 'plot']);

	const lineageEntries = $derived.by((): LineageEntry[] => {
		const modelEntries: ModelEntry[] = dbtModels.map((model) => ({
			kind: 'model',
			key: model.path,
			name: model.name,
			upstreamRefs: model.upstreamRefs,
			model
		}));

		const cellEntries: CellEntry[] = [];
		for (const nb of notebooks) {
			const eligible = nb.cells.filter(
				(c) => !c.promotedModelPath && c.outputName && CELL_KINDS.has(c.cellType)
			);
			const byName = new Map(eligible.map((c) => [c.outputName, c]));
			for (const cell of eligible) {
				const refs: string[] = [];
				for (const name of byName.keys()) {
					if (name === cell.outputName) continue;
					if (new RegExp(`\\b${escapeRe(name)}\\b`).test(cell.code)) refs.push(name);
				}
				cellEntries.push({
					kind: 'cell',
					key: cell.id,
					name: cell.outputName,
					upstreamRefs: refs,
					cell,
					notebookId: nb.id,
					notebookName: nb.name
				});
			}
		}
		return [...modelEntries, ...cellEntries];
	});

	// ── Layout constants ──────────────────────────────────────────────────────
	const NODE_W = 192;
	const NODE_H = 64; // estimated; actual height is auto
	const H_GAP = 72;
	const V_GAP = 16;

	// ── Topological layout ────────────────────────────────────────────────────
	interface NodeLayout {
		entry: LineageEntry;
		col: number;
		row: number;
		x: number;
		y: number;
	}

	const layout = $derived.by((): NodeLayout[] => {
		if (lineageEntries.length === 0) return [];
		const nameToEntry = new Map(lineageEntries.map((e) => [e.name, e]));

		// Longest-path depth from sources
		const depthCache = new Map<string, number>();
		function getDepth(name: string, visiting = new Set<string>()): number {
			if (depthCache.has(name)) return depthCache.get(name)!;
			if (visiting.has(name)) return 0;
			visiting.add(name);
			const entry = nameToEntry.get(name);
			const d =
				entry && entry.upstreamRefs.length > 0
					? Math.max(...entry.upstreamRefs.map((r) => getDepth(r, new Set(visiting)))) + 1
					: 0;
			depthCache.set(name, d);
			return d;
		}
		lineageEntries.forEach((e) => getDepth(e.name));

		// Group into columns
		const cols = new Map<number, LineageEntry[]>();
		for (const e of lineageEntries) {
			const d = depthCache.get(e.name) ?? 0;
			if (!cols.has(d)) cols.set(d, []);
			cols.get(d)!.push(e);
		}

		const nodes: NodeLayout[] = [];
		for (const [col, entries] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
			entries.forEach((entry, row) => {
				nodes.push({
					entry,
					col,
					row,
					x: col * (NODE_W + H_GAP) + 24,
					y: row * (NODE_H + V_GAP) + 24
				});
			});
		}
		return nodes;
	});

	const nameToNode = $derived(new Map(layout.map((n) => [n.entry.name, n])));

	// Canvas size (for SVG edge layer)
	const canvasW = $derived(layout.length ? Math.max(...layout.map((n) => n.x + NODE_W)) + 48 : 600);
	const canvasH = $derived(
		layout.length ? Math.max(...layout.map((n) => n.y + NODE_H + 40)) + 48 : 300
	);

	// ── Pan / zoom ────────────────────────────────────────────────────────────
	let scale = $state(1);
	let tx = $state(24);
	let ty = $state(24);
	let dragging = $state(false);
	let dragStart = $state({ x: 0, y: 0, tx: 0, ty: 0 });
	let containerEl: HTMLElement | undefined = $state();

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 0.92 : 1.08;
		const next = Math.max(0.25, Math.min(2.5, scale * factor));
		// zoom toward mouse position
		if (containerEl) {
			const rect = containerEl.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;
			tx = mx - (mx - tx) * (next / scale);
			ty = my - (my - ty) * (next / scale);
		}
		scale = next;
	}

	function onMouseDown(e: MouseEvent) {
		if ((e.target as Element).closest('.lineage-node')) return;
		dragging = true;
		dragStart = { x: e.clientX, y: e.clientY, tx, ty };
		e.preventDefault();
	}

	function onMouseMove(e: MouseEvent) {
		if (!dragging) return;
		tx = dragStart.tx + (e.clientX - dragStart.x);
		ty = dragStart.ty + (e.clientY - dragStart.y);
	}

	function onMouseUp() {
		dragging = false;
	}

	function zoomIn() {
		scale = Math.min(2.5, scale * 1.2);
	}
	function zoomOut() {
		scale = Math.max(0.25, scale / 1.2);
	}
	function resetView() {
		scale = 1;
		tx = 24;
		ty = 24;
	}
	function fitView() {
		if (!containerEl || layout.length === 0) return;
		const rect = containerEl.getBoundingClientRect();
		const padding = 48;
		const sx = (rect.width - padding * 2) / canvasW;
		const sy = (rect.height - padding * 2) / canvasH;
		scale = Math.min(sx, sy, 1);
		tx = padding;
		ty = padding;
	}

	// ── Node interaction ──────────────────────────────────────────────────────
	function openModel(modelName: string) {
		const nb = notebooks.find((n) => n.id === modelName || n.id.endsWith(`/${modelName}`));
		if (nb) {
			setActiveTab(nb.id);
			focusedModelName = modelName;
		}
	}

	async function openCell(entry: CellEntry): Promise<void> {
		setActiveTab(entry.notebookId);
		focusedModelName = entry.name;
		await tick();
		document
			.querySelector(`[data-cell-id="${entry.cell.id}"]`)
			?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function openEntry(entry: LineageEntry): void {
		if (entry.kind === 'model') openModel(entry.name);
		else void openCell(entry);
	}

	// ── Edges ─────────────────────────────────────────────────────────────────
	interface Edge {
		from: NodeLayout;
		to: NodeLayout;
	}

	const edges = $derived.by((): Edge[] => {
		const result: Edge[] = [];
		for (const node of layout) {
			for (const ref of node.entry.upstreamRefs) {
				const from = nameToNode.get(ref);
				if (from) result.push({ from, to: node });
			}
		}
		return result;
	});

	// Exit port = right-center of from node; entry port = left-center of to node
	// NODE_H is approximate; edges connect mid-height
	const MID_Y = NODE_H / 2 + 8; // extra for padding
	function edgePath(from: NodeLayout, to: NodeLayout): string {
		const x1 = from.x + NODE_W;
		const y1 = from.y + MID_Y;
		const x2 = to.x;
		const y2 = to.y + MID_Y;
		const cx = (x1 + x2) / 2;
		return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
	}

	function isFocusedEdge(edge: Edge): boolean {
		return edge.from.entry.name === focusedModelName || edge.to.entry.name === focusedModelName;
	}

	// ── Status helpers ────────────────────────────────────────────────────────
	const statusMeta = {
		pass: { icon: CheckCircle2, class: 'text-success', dot: 'bg-success' },
		error: { icon: XCircle, class: 'text-destructive', dot: 'bg-destructive' },
		unknown: { icon: Minus, class: 'text-muted-foreground/40', dot: 'bg-muted-foreground/30' }
	} as const;

	function getStatus(model: DbtModel): (typeof statusMeta)[keyof typeof statusMeta] {
		return statusMeta[model.lastRunStatus] ?? statusMeta.unknown;
	}

	const materializeColors: Record<string, string> = {
		table: 'bg-chart-3/10 text-chart-3 border-chart-3/20',
		view: 'bg-primary/10 text-primary border-primary',
		incremental: 'bg-chart-2/10 text-chart-2 border-chart-2/20',
		ephemeral: 'bg-muted text-muted-foreground border-border'
	};

	// Cell-node-only status mapping — cell.status is a different union
	// ('idle'|'running'|'success'|'error') from dbt's run-status one.
	const cellStatusMeta = {
		success: { icon: CheckCircle2, class: 'text-success' },
		error: { icon: XCircle, class: 'text-destructive' },
		running: { icon: Loader2, class: 'text-muted-foreground animate-spin' },
		idle: { icon: Minus, class: 'text-muted-foreground/40' }
	} as const;

	function getCellStatus(cell: Cell): (typeof cellStatusMeta)[keyof typeof cellStatusMeta] {
		return cellStatusMeta[cell.status] ?? cellStatusMeta.idle;
	}

	const cellKindIcon = { query: Database, python: Terminal, plot: ChartLine } as const;
</script>

<!-- Outer container: dot-grid background, pan/zoom handlers -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
<div
	bind:this={containerEl}
	class="relative h-full w-full overflow-hidden bg-background {dragging
		? 'cursor-grabbing'
		: 'cursor-grab'}"
	style="background-image: radial-gradient(circle, hsl(var(--border) / 0.6) 1px, transparent 1px); background-size: 22px 22px;"
	onwheel={onWheel}
	onmousedown={onMouseDown}
	onmousemove={onMouseMove}
	onmouseup={onMouseUp}
	onmouseleave={onMouseUp}
	role="region"
	aria-label="dbt lineage graph — scroll to zoom, drag to pan"
>
	{#if lineageEntries.length === 0}
		<!-- Empty state -->
		<div class="flex h-full flex-col items-center justify-center gap-3 text-center">
			<div class="rounded-full bg-muted/50 p-4">
				<svg
					class="h-8 w-8 text-muted-foreground/40"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z"
					/>
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium text-foreground/80">No models or cells yet</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					Run <span class="font-mono">dbt compile</span>, or add a query/Python/plot cell, to build
					the lineage graph
				</p>
			</div>
		</div>
	{:else}
		<!-- Transformed canvas: edges + nodes move together -->
		<div
			style="position: absolute; top: 0; left: 0; width: {canvasW}px; height: {canvasH}px; transform: translate({tx}px, {ty}px) scale({scale}); transform-origin: 0 0;"
		>
			<!-- SVG layer: edges only, pointer-events none so nodes are clickable -->
			<svg
				class="pointer-events-none absolute inset-0 overflow-visible"
				width={canvasW}
				height={canvasH}
			>
				{#each edges as edge (`${edge.from.entry.key}->${edge.to.entry.key}`)}
					{@const focused = isFocusedEdge(edge)}
					{@const x2 = edge.to.x}
					{@const y2 = edge.to.y + MID_Y}
					<!-- Edge line -->
					<path
						d={edgePath(edge.from, edge.to)}
						fill="none"
						class={focused ? 'stroke-primary/60' : 'stroke-border'}
						stroke-width={focused ? 2 : 1.5}
					/>
					<!-- Arrowhead: small filled triangle at destination -->
					<polygon
						points="{x2},{y2} {x2 - 7},{y2 - 4} {x2 - 7},{y2 + 4}"
						class={focused ? 'fill-primary/50' : 'fill-border'}
					/>
				{/each}
			</svg>

			<!-- HTML node cards -->
			{#each layout as node (node.entry.key)}
				{@const isFocused = node.entry.name === focusedModelName}
				<div
					class="lineage-node absolute"
					style="left: {node.x}px; top: {node.y}px; width: {NODE_W}px;"
				>
					{#if node.entry.kind === 'model'}
						{@const model = node.entry.model}
						{@const st = getStatus(model)}
						{@const StatusIcon = st.icon}
						{@const matColor = materializeColors[model.materialized] ?? materializeColors.view}
						<Tooltip.Root>
							<Tooltip.Trigger class="w-full text-left">
								<button
									class="w-full rounded-lg border bg-accent/30 px-3 py-2.5 text-left backdrop-blur-sm transition-all duration-(--motion-fast)
										{isFocused
										? 'border-primary bg-background shadow-sm'
										: 'border-border hover:border-primary hover:shadow-sm'}"
									onclick={() => openEntry(node.entry)}
								>
									<!-- Top row: status icon + name -->
									<div class="flex items-start gap-2">
										<StatusIcon class="mt-0.5 h-3 w-3 shrink-0 {st.class}" />
										<div class="min-w-0 flex-1">
											<p
												class="truncate font-mono text-xs leading-tight font-semibold text-foreground"
												title={model.name}
											>
												{model.name}
											</p>
											<!-- Schema + materialized -->
											<p class="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
												{model.schema || 'default'}
											</p>
										</div>
										{#if model.description}
											<BookOpen class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" />
										{/if}
									</div>

									<!-- Bottom row: materialized badge + test badge -->
									<div class="mt-2 flex flex-wrap items-center gap-1">
										<span
											class="inline-flex items-center rounded border px-1.5 py-px font-mono text-3xs font-medium {matColor}"
										>
											{model.materialized}
										</span>
										{#if model.lastRunStatus !== 'unknown'}
											<span
												class="inline-flex items-center rounded border px-1.5 py-px text-3xs font-medium
												{model.lastRunStatus === 'pass'
													? 'border-success bg-success/10 text-success'
													: 'border-destructive bg-destructive/10 text-destructive'}"
											>
												{model.lastRunStatus}
											</span>
										{/if}
										{#if model.columns.some((c) => c.tests.length > 0)}
											<span
												class="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-px text-3xs font-medium text-muted-foreground"
											>
												<FlaskConical class="h-2.5 w-2.5" />
												tested
											</span>
										{/if}
									</div>
								</button>
							</Tooltip.Trigger>
							{#if model.description || model.upstreamRefs.length > 0}
								<Tooltip.Content side="right" class="max-w-56">
									{#if model.description}
										<p class="text-xs">{model.description}</p>
									{/if}
									{#if model.upstreamRefs.length > 0}
										<p class="mt-1 text-2xs text-muted-foreground">
											Depends on: {model.upstreamRefs.join(', ')}
										</p>
									{/if}
								</Tooltip.Content>
							{/if}
						</Tooltip.Root>
					{:else}
						{@const cell = node.entry.cell}
						{@const cst = getCellStatus(cell)}
						{@const CellStatusIcon = cst.icon}
						{@const CellKindIcon =
							cellKindIcon[cell.cellType as keyof typeof cellKindIcon] ?? Database}
						<Tooltip.Root>
							<Tooltip.Trigger class="w-full text-left">
								<button
									class="w-full rounded-lg border border-dashed bg-accent/10 px-3 py-2.5 text-left backdrop-blur-sm transition-all duration-(--motion-fast)
										{isFocused
										? 'border-primary bg-background shadow-sm'
										: 'border-border hover:border-primary hover:shadow-sm'}"
									onclick={() => openEntry(node.entry)}
								>
									<div class="flex items-start gap-2">
										<CellStatusIcon class="mt-0.5 h-3 w-3 shrink-0 {cst.class}" />
										<div class="min-w-0 flex-1">
											<p
												class="truncate font-mono text-xs leading-tight font-semibold text-foreground"
												title={node.entry.name}
											>
												{node.entry.name}
											</p>
											<p class="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
												{node.entry.notebookName}
											</p>
										</div>
										<CellKindIcon class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" />
									</div>
									<div class="mt-2 flex flex-wrap items-center gap-1">
										<span
											class="inline-flex items-center rounded border border-border px-1.5 py-px font-mono text-3xs font-medium text-muted-foreground"
										>
											{cell.cellType} cell
										</span>
										<span
											class="inline-flex items-center rounded border border-border px-1.5 py-px text-3xs font-medium text-muted-foreground"
										>
											not promoted
										</span>
									</div>
								</button>
							</Tooltip.Trigger>
							<Tooltip.Content side="right" class="max-w-56">
								<p class="text-xs">Live notebook cell — not yet a dbt model.</p>
								{#if node.entry.upstreamRefs.length > 0}
									<p class="mt-1 text-2xs text-muted-foreground">
										Depends on: {node.entry.upstreamRefs.join(', ')}
									</p>
								{/if}
							</Tooltip.Content>
						</Tooltip.Root>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Controls overlay -->
	<div class="pointer-events-none absolute right-3 bottom-3 flex flex-col items-end gap-2">
		<!-- Zoom controls -->
		<div
			class="pointer-events-auto flex flex-col gap-0.5 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur-sm"
		>
			<Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={zoomIn} title="Zoom in">
				<ZoomIn class="h-3.5 w-3.5" />
			</Button>
			<div class="px-1 text-center font-mono text-2xs text-muted-foreground">
				{Math.round(scale * 100)}%
			</div>
			<Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={zoomOut} title="Zoom out">
				<ZoomOut class="h-3.5 w-3.5" />
			</Button>
			<div class="my-0.5 h-px bg-border"></div>
			<Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={fitView} title="Fit to view">
				<Maximize2 class="h-3.5 w-3.5" />
			</Button>
		</div>

		<!-- Legend -->
		<div
			class="pointer-events-auto rounded-lg border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur-sm"
		>
			<p class="mb-1.5 text-2xs font-semibold tracking-wide text-muted-foreground/60 uppercase">
				Legend
			</p>
			<div class="flex flex-col gap-1">
				<div class="flex items-center gap-1.5 text-2xs text-muted-foreground">
					<CheckCircle2 class="h-3 w-3 text-success" /> Passing
				</div>
				<div class="flex items-center gap-1.5 text-2xs text-muted-foreground">
					<XCircle class="h-3 w-3 text-destructive" /> Error
				</div>
				<div class="flex items-center gap-1.5 text-2xs text-muted-foreground">
					<Minus class="h-3 w-3 text-muted-foreground/40" /> Unknown
				</div>
				<div class="flex items-center gap-1.5 text-2xs text-muted-foreground">
					<BookOpen class="h-3 w-3 text-muted-foreground/50" /> Has docs
				</div>
				<div class="flex items-center gap-1.5 text-2xs text-muted-foreground">
					<span class="h-3 w-3 rounded border border-dashed border-muted-foreground"></span> Live cell
					(not promoted)
				</div>
			</div>
			<p class="mt-2 text-3xs text-muted-foreground/50">Scroll to zoom · Drag to pan</p>
		</div>
	</div>

	<!-- Model/cell count badge top-left -->
	{#if lineageEntries.length > 0}
		{@const cellCount = lineageEntries.length - dbtModels.length}
		<div class="pointer-events-none absolute top-3 left-3">
			<span
				class="rounded-full border border-border bg-background/90 px-2.5 py-1 text-2xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm"
			>
				{dbtModels.length} model{dbtModels.length === 1 ? '' : 's'}{#if cellCount > 0}
					· {cellCount} cell{cellCount === 1 ? '' : 's'}{/if}
			</span>
		</div>
	{/if}
</div>
