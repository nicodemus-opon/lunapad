<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Pencil, History, Undo2, CheckCircle2, XCircle, ArrowRight } from '@lucide/svelte';
	import { relativeTime, type NotebookRevision } from '$lib/services/notebook-history';
	import { resolveDependencies } from '$lib/services/cell-deps';
	import {
		getConnections,
		getCrossNotebookUsageCount,
		getNotebookEvents,
		type Cell
	} from '$lib/stores/notebook.svelte';

	type InfoTab = 'overview' | 'history' | 'relationships' | 'insights';

	let {
		open = $bindable(false),
		notebookId,
		notebookName,
		format,
		storageLabel,
		cells,
		revisions,
		revertingId = null,
		onRevert
	}: {
		open?: boolean;
		notebookId: string;
		notebookName: string;
		format?: string;
		storageLabel: string;
		cells: Cell[];
		revisions: NotebookRevision[];
		revertingId?: string | null;
		onRevert: (revision: NotebookRevision) => void;
	} = $props();

	let tab = $state<InfoTab>('history');
	// Always land on History when opened from the bottom bar.
	$effect(() => {
		if (open) tab = 'history';
	});

	// Tick every 30s so "x minutes ago" stays fresh while open.
	let now = $state(Date.now());
	$effect(() => {
		if (!open) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	function fmtMs(ms: number | null): string {
		if (ms == null) return '—';
		return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
	}

	function escapeRegExp(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	// ── Overview ──────────────────────────────────────────────────────────
	const countsByType = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const cell of cells) counts.set(cell.cellType, (counts.get(cell.cellType) ?? 0) + 1);
		return [...counts.entries()].sort((a, b) => b[1] - a[1]);
	});
	const connectionNames = $derived.by(() => {
		const ids = new Set(cells.map((c) => c.connectionId).filter((id): id is string => id != null));
		if (ids.size === 0) return ['Built-in DuckDB'];
		const byId = new Map(getConnections().map((c) => [c.id, c.name]));
		return [...ids].map((id) => byId.get(id) ?? id);
	});
	const staleCount = $derived(cells.filter((c) => c.needsRun).length);
	const errorCount = $derived(
		cells.filter((c) => c.errors.length > 0 || c.materializeError).length
	);
	const events = $derived(
		getNotebookEvents()
			.filter((e) => e.notebookId === notebookId)
			.sort((a, b) => b.ts - a.ts)
	);
	const lastActivityTs = $derived.by(() => {
		const revTs = revisions.length > 0 ? revisions[0].ts : 0;
		const eventTs = events.length > 0 ? events[0].ts : 0;
		return Math.max(revTs, eventTs);
	});

	// ── Relationships ─────────────────────────────────────────────────────
	interface CellRelations {
		id: string;
		name: string;
		upstream: string[];
		downstream: string[];
		crossNotebook: number;
	}
	const relations = $derived.by((): CellRelations[] => {
		const out: CellRelations[] = [];
		cells.forEach((cell, idx) => {
			if (cell.cellType !== 'query' || !cell.outputName) return;
			let upstream: string[] = [];
			try {
				upstream = resolveDependencies(cells, idx).map((d) => d.outputName || 'untitled cell');
			} catch {
				upstream = [];
			}
			const re = new RegExp(`\\b${escapeRegExp(cell.outputName)}\\b`);
			const downstream = cells
				.slice(idx + 1)
				.filter((c) => c.cellType === 'query' && re.test(c.code))
				.map((c) => c.outputName || 'untitled cell');
			const crossNotebook = getCrossNotebookUsageCount(cell.outputName, notebookId);
			if (upstream.length > 0 || downstream.length > 0 || crossNotebook > 0) {
				out.push({ id: cell.id, name: cell.outputName, upstream, downstream, crossNotebook });
			}
		});
		return out;
	});

	// ── Insights ──────────────────────────────────────────────────────────
	const runStats = $derived.by(() => {
		const runs = events.filter((e) => e.eventType === 'run-success' || e.eventType === 'run-error');
		const successes = runs.filter((e) => e.eventType === 'run-success');
		const runtimes = runs.map((e) => e.runtimeMs).filter((ms): ms is number => ms != null);
		return {
			total: runs.length,
			successRate: runs.length > 0 ? Math.round((successes.length / runs.length) * 100) : null,
			avgMs: runtimes.length > 0 ? runtimes.reduce((a, b) => a + b, 0) / runtimes.length : null,
			totalRows: runs.reduce((a, e) => a + e.rowCount, 0)
		};
	});
	const recentRuns = $derived(events.slice(0, 8));
	function eventCellName(cellId: string): string {
		return cells.find((c) => c.id === cellId)?.outputName || 'untitled cell';
	}

	const tabs: Array<{ id: InfoTab; label: string }> = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'history', label: 'History' },
		{ id: 'relationships', label: 'Relationships' },
		{ id: 'insights', label: 'Insights' }
	];
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="flex max-h-[85vh] w-full max-w-md flex-col gap-0 overflow-hidden p-0"
		aria-label={`Info for ${notebookName || 'notebook'}`}
	>
		<Dialog.Header class="shrink-0 px-5 pt-5 pb-0">
			<Dialog.Title class="text-base">Info</Dialog.Title>
			<div
				class="mt-2 flex gap-4 border-b border-border text-sm"
				role="tablist"
				aria-label="Info sections"
			>
				{#each tabs as t (t.id)}
					<button
						type="button"
						role="tab"
						aria-selected={tab === t.id}
						class="-mb-px border-b-2 px-0.5 pb-2 transition-colors outline-none {tab === t.id
							? 'border-primary font-medium text-primary'
							: 'border-transparent text-muted-foreground hover:text-foreground'}"
						onclick={() => (tab = t.id)}
					>
						{t.label}
					</button>
				{/each}
			</div>
			<p class="truncate px-0.5 pt-2 text-xs text-muted-foreground">{notebookName}</p>
		</Dialog.Header>

		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			{#if tab === 'overview'}
				<dl class="space-y-3 text-sm">
					<div class="flex items-start justify-between gap-4">
						<dt class="shrink-0 text-muted-foreground">Location</dt>
						<dd class="min-w-0 truncate text-right font-mono text-xs">{storageLabel}</dd>
					</div>
					{#if format}
						<div class="flex items-start justify-between gap-4">
							<dt class="shrink-0 text-muted-foreground">Format</dt>
							<dd class="font-mono text-xs">.{format}</dd>
						</div>
					{/if}
					<div class="flex items-start justify-between gap-4">
						<dt class="shrink-0 text-muted-foreground">Cells</dt>
						<dd class="text-right text-xs">
							{cells.length} total{#if countsByType.length > 0}
								<span class="text-muted-foreground">
									· {countsByType.map(([type, n]) => `${n} ${type}`).join(' · ')}
								</span>
							{/if}
						</dd>
					</div>
					<div class="flex items-start justify-between gap-4">
						<dt class="shrink-0 text-muted-foreground">Connections</dt>
						<dd class="min-w-0 truncate text-right font-mono text-xs">
							{connectionNames.join(', ')}
						</dd>
					</div>
					<div class="flex items-start justify-between gap-4">
						<dt class="shrink-0 text-muted-foreground">Status</dt>
						<dd class="text-right text-xs">
							{#if staleCount === 0 && errorCount === 0}
								<span class="text-success">All up to date</span>
							{:else}
								{#if staleCount > 0}<span class="text-warning">{staleCount} stale</span>{/if}
								{#if staleCount > 0 && errorCount > 0}<span class="text-muted-foreground">
										·
									</span>{/if}
								{#if errorCount > 0}<span class="text-destructive">{errorCount} with errors</span
									>{/if}
							{/if}
						</dd>
					</div>
					<div class="flex items-start justify-between gap-4">
						<dt class="shrink-0 text-muted-foreground">Last activity</dt>
						<dd class="text-xs">
							{lastActivityTs > 0 ? relativeTime(lastActivityTs, now) : 'No activity yet'}
						</dd>
					</div>
				</dl>
			{:else if tab === 'history'}
				{#if revisions.length === 0}
					<div class="flex flex-col items-center gap-2 py-10 text-center">
						<History class="h-6 w-6 text-muted-foreground/50" />
						<p class="text-sm text-muted-foreground">No history yet.</p>
						<p class="max-w-60 text-xs text-muted-foreground/70">
							A version is saved automatically each time you edit this notebook.
						</p>
					</div>
				{:else}
					<ol class="relative ml-3 border-l border-dotted border-border pl-0">
						{#each revisions as rev (rev.id)}
							<li class="relative flex items-start gap-3 py-3 pl-6">
								<span
									class="absolute top-3 -left-3.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background"
									aria-hidden="true"
								>
									<Pencil class="h-3 w-3 text-muted-foreground" />
								</span>
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium text-foreground">
										{rev.actor}
										{rev.label}.
									</p>
									<p class="mt-0.5 text-xs text-muted-foreground">{relativeTime(rev.ts, now)}</p>
								</div>
								<button
									type="button"
									class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
									title="Revert to this version"
									aria-label="Revert to version from {relativeTime(rev.ts, now)}"
									disabled={revertingId === rev.id}
									onclick={() => onRevert(rev)}
								>
									<Undo2 class="h-3.5 w-3.5" />
								</button>
							</li>
						{/each}
					</ol>
					<p class="mt-2 text-center text-xs text-muted-foreground/60">
						Showing up to 15 recent versions.
					</p>
				{/if}
			{:else if tab === 'relationships'}
				{#if relations.length === 0}
					<div class="flex flex-col items-center gap-2 py-10 text-center">
						<ArrowRight class="h-6 w-6 text-muted-foreground/50" />
						<p class="text-sm text-muted-foreground">No cell references.</p>
						<p class="max-w-60 text-xs text-muted-foreground/70">
							Cells reference each other by name with <code>from name</code> — links show up here.
						</p>
					</div>
				{:else}
					<ul class="space-y-3">
						{#each relations as rel (rel.id)}
							<li class="rounded-md border border-border p-3">
								<p class="font-mono text-xs font-medium">{rel.name}</p>
								{#if rel.upstream.length > 0}
									<p class="mt-1.5 text-xs text-muted-foreground">
										Depends on: <span class="font-mono text-foreground/80"
											>{rel.upstream.join(', ')}</span
										>
									</p>
								{/if}
								{#if rel.downstream.length > 0}
									<p class="mt-1 text-xs text-muted-foreground">
										Used by: <span class="font-mono text-foreground/80"
											>{rel.downstream.join(', ')}</span
										>
									</p>
								{/if}
								{#if rel.crossNotebook > 0}
									<p class="mt-1 text-xs text-muted-foreground">
										Referenced by {rel.crossNotebook} cell{rel.crossNotebook === 1 ? '' : 's'} in other
										notebook{rel.crossNotebook === 1 ? '' : 's'}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{:else if tab === 'insights'}
				{#if runStats.total === 0}
					<div class="flex flex-col items-center gap-2 py-10 text-center">
						<CheckCircle2 class="h-6 w-6 text-muted-foreground/50" />
						<p class="text-sm text-muted-foreground">No runs recorded yet.</p>
						<p class="max-w-60 text-xs text-muted-foreground/70">
							Run a cell to see success rate, runtimes, and row counts here.
						</p>
					</div>
				{:else}
					<div class="grid grid-cols-2 gap-2">
						<div class="rounded-md border border-border p-3">
							<p class="text-2xs text-muted-foreground">Runs</p>
							<p class="font-mono text-lg font-medium tabular-nums">{runStats.total}</p>
						</div>
						<div class="rounded-md border border-border p-3">
							<p class="text-2xs text-muted-foreground">Success</p>
							<p class="font-mono text-lg font-medium tabular-nums">
								{runStats.successRate != null ? `${runStats.successRate}%` : '—'}
							</p>
						</div>
						<div class="rounded-md border border-border p-3">
							<p class="text-2xs text-muted-foreground">Avg runtime</p>
							<p class="font-mono text-lg font-medium tabular-nums">{fmtMs(runStats.avgMs)}</p>
						</div>
						<div class="rounded-md border border-border p-3">
							<p class="text-2xs text-muted-foreground">Rows returned</p>
							<p class="font-mono text-lg font-medium tabular-nums">
								{runStats.totalRows.toLocaleString()}
							</p>
						</div>
					</div>
					<p class="mt-4 mb-1 text-2xs font-medium text-muted-foreground">Recent runs</p>
					<ul class="space-y-1">
						{#each recentRuns as event (event.id)}
							<li class="flex items-center gap-2 rounded px-1 py-1.5 text-xs hover:bg-muted/40">
								{#if event.eventType === 'run-success'}
									<CheckCircle2 class="h-3.5 w-3.5 shrink-0 text-success" />
								{:else}
									<XCircle class="h-3.5 w-3.5 shrink-0 text-destructive" />
								{/if}
								<span class="min-w-0 flex-1 truncate font-mono">{eventCellName(event.cellId)}</span>
								<span class="shrink-0 font-mono text-muted-foreground tabular-nums"
									>{fmtMs(event.runtimeMs)}</span
								>
								<span class="shrink-0 font-mono text-muted-foreground tabular-nums"
									>{event.rowCount.toLocaleString()} rows</span
								>
								<span class="hidden w-20 shrink-0 text-right text-muted-foreground sm:inline"
									>{relativeTime(event.ts, now)}</span
								>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
