<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import CellStatusChip from './CellStatusChip.svelte';
	import {
		Clock,
		Database,
		FlaskConical,
		Loader2,
		Play,
		CheckCircle2,
		XCircle
	} from '@lucide/svelte';
	import { runCell, materializeCell, type Cell } from '$lib/stores/notebook.svelte';

	interface IntelligenceSummary {
		rowCount: number;
		columnCount: number;
		connectionId: string;
		nextAnalysis: string | null;
		qualityWarnings: number;
		perfWarnings: number;
		joinCount: number;
		schemaMatchCount: number;
	}

	let {
		cell,
		showResult,
		running,
		intelligenceSummary,
		connectionName,
		isDbtProject,
		onOpenMaterialize,
		onShowSql,
		onRunTests,
		onOverlayChange,
		onOpenFull
	}: {
		cell: Cell;
		showResult: boolean;
		running: boolean;
		intelligenceSummary: IntelligenceSummary | null;
		/** Set only when the cell uses a non-default connection. */
		connectionName: string | null;
		isDbtProject: boolean;
		onOpenMaterialize: () => void;
		onShowSql: () => void;
		onRunTests: () => void;
		onOverlayChange?: (open: boolean) => void;
		/** Present when the result is large enough to warrant a dedicated tab. */
		onOpenFull?: () => void;
	} = $props();

	function fmtMs(ms: number): string {
		return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
	}

	function humanizeInterval(minutes: number): string {
		if (minutes < 60) return `every ${minutes} minute${minutes === 1 ? '' : 's'}`;
		if (minutes % 60 === 0) {
			const hours = minutes / 60;
			return `every ${hours} hour${hours === 1 ? '' : 's'}`;
		}
		return `every ${minutes} minutes`;
	}

	function shortInterval(minutes: number): string {
		if (minutes < 60) return `${minutes}m`;
		if (minutes % 60 === 0) return `${minutes / 60}h`;
		return `${minutes}m`;
	}

	function intervalMinutesToCronExpression(minutes: number): string {
		if (minutes > 0 && minutes < 60) return `*/${minutes} * * * *`;
		if (minutes >= 60 && minutes % 60 === 0) return `0 */${minutes / 60} * * *`;
		return `*/${minutes} * * * *`;
	}

	const failedTests = $derived(cell.dbtTestResults.filter((r) => r.status === 'fail').length);
	const showMaterializeChip = $derived(cell.materializeStatus !== 'idle' || cell.scheduleEnabled);
	const materializeTone = $derived(
		cell.materializeStatus === 'error' || cell.scheduleStatus === 'error'
			? ('destructive' as const)
			: ('neutral' as const)
	);
</script>

<div class="flex h-6 flex-wrap items-center gap-2">
	{#if showResult && cell.result}
		<Popover.Root onOpenChange={onOverlayChange}>
			<Popover.Trigger
				class="rounded font-mono text-2xs text-muted-foreground tabular-nums transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
				aria-label="Show run details"
			>
				{cell.result.rows.length.toLocaleString()} rows · {cell.result.columns.length} cols{running
					? ' · updating…'
					: cell.executionMs != null
						? ` · ${fmtMs(cell.executionMs)}`
						: ''}
			</Popover.Trigger>
			<Popover.Content class="w-72 space-y-2 p-3 text-xs">
				<div class="space-y-1">
					<p class="font-medium">Last run</p>
					<p class="text-muted-foreground">
						{cell.result.rows.length.toLocaleString()} rows · {cell.result.columns.length} columns{cell.executionMs !=
						null
							? ` · ${fmtMs(cell.executionMs)}`
							: ''}{cell.result.truncated ? ' · truncated' : ''}
					</p>
					<p class="font-mono text-muted-foreground">{connectionName ?? 'DuckDB (built-in)'}</p>
				</div>
				{#if intelligenceSummary}
					<div class="space-y-1 border-t pt-2">
						<p class="font-medium">Insights</p>
						<p class="text-muted-foreground">
							{intelligenceSummary.perfWarnings} performance warning{intelligenceSummary.perfWarnings ===
							1
								? ''
								: 's'},
							{intelligenceSummary.qualityWarnings} quality warning{intelligenceSummary.qualityWarnings ===
							1
								? ''
								: 's'}
						</p>
						<p class="text-muted-foreground">
							{intelligenceSummary.joinCount} join suggestion{intelligenceSummary.joinCount === 1
								? ''
								: 's'},
							{intelligenceSummary.schemaMatchCount} schema match{intelligenceSummary.schemaMatchCount ===
							1
								? ''
								: 'es'}
						</p>
						{#if intelligenceSummary.nextAnalysis}
							<p class="text-muted-foreground">Next: {intelligenceSummary.nextAnalysis}</p>
						{/if}
					</div>
				{/if}
				{#if cell.compiledSQL}
					<div class="border-t pt-2">
						<button
							class="text-xs text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground"
							onclick={onShowSql}
						>
							Show compiled SQL
						</button>
					</div>
				{/if}
			</Popover.Content>
		</Popover.Root>
	{/if}

	{#if cell.needsRun && cell.status !== 'running'}
		<CellStatusChip tone="warning" onOpenChange={onOverlayChange}>
			{#snippet label()}
				<Clock />
				{cell.staleReason === 'code-changed' ? 'stale · code changed' : 'stale'}
			{/snippet}
			{#snippet content()}
				<div class="space-y-2 text-xs">
					<p>
						{#if cell.staleReason === 'code-changed'}
							Code changed since the last run.
						{:else if cell.staleSources.length > 0}
							Upstream changed: <span class="font-mono"
								>{cell.staleSources.slice(0, 3).join(', ')}{cell.staleSources.length > 3
									? ` +${cell.staleSources.length - 3} more`
									: ''}</span
							>.
						{:else}
							An upstream cell changed since the last run.
						{/if}
					</p>
					<button
						class="inline-flex items-center gap-1 rounded border border-warning/50 bg-warning/10 px-2 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
						onclick={() => runCell(cell.id)}
					>
						<Play class="h-2.5 w-2.5 fill-current" />
						Re-run
					</button>
				</div>
			{/snippet}
		</CellStatusChip>
	{/if}

	{#if showMaterializeChip}
		<CellStatusChip tone={materializeTone} onOpenChange={onOverlayChange}>
			{#snippet label()}
				{#if cell.materializeStatus === 'running' || cell.scheduleStatus === 'running'}
					<Loader2 class="animate-spin" />
					materializing
				{:else if cell.materializeStatus === 'error'}
					<XCircle />
					materialize failed
				{:else if cell.scheduleStatus === 'error'}
					<XCircle />
					schedule failed
				{:else}
					<Database />
					{cell.materializeMode}{cell.scheduleEnabled
						? ` · ${shortInterval(cell.scheduleIntervalMinutes)}`
						: ''}
				{/if}
			{/snippet}
			{#snippet content()}
				<div class="space-y-2 text-xs">
					<div class="space-y-1">
						<p class="font-medium">Materialization</p>
						<p class="text-muted-foreground">
							Mode: {cell.materializeMode}{cell.materializedRelationType
								? ` · last built as ${cell.materializedRelationType}`
								: ''}
						</p>
						{#if cell.materializeStatus === 'success'}
							<p class="inline-flex items-center gap-1 text-success">
								<CheckCircle2 class="h-3 w-3" /> materialized
							</p>
						{:else if cell.materializeStatus === 'error'}
							<p class="text-destructive">Last materialization failed.</p>
						{/if}
					</div>
					{#if cell.scheduleEnabled}
						<div class="space-y-1 border-t pt-2">
							<p class="font-medium">Schedule</p>
							<p class="text-muted-foreground">
								{humanizeInterval(cell.scheduleIntervalMinutes)} · {cell.scheduleScope === 'segment'
									? 'cell + downstream'
									: 'this cell only'}
							</p>
							<p class="font-mono text-muted-foreground">
								{intervalMinutesToCronExpression(cell.scheduleIntervalMinutes)}
							</p>
							{#if cell.scheduleStatus === 'error' && cell.scheduleLastError}
								<p class="font-mono text-destructive">{cell.scheduleLastError}</p>
							{/if}
						</div>
					{/if}
					<div class="flex items-center gap-2 border-t pt-2">
						<button
							class="rounded border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted/60"
							disabled={cell.materializeStatus === 'running'}
							onclick={() => void materializeCell(cell.id)}
						>
							Materialize now
						</button>
						<button
							class="rounded border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted/60"
							onclick={onOpenMaterialize}
						>
							Edit…
						</button>
					</div>
				</div>
			{/snippet}
		</CellStatusChip>
	{/if}

	{#if isDbtProject && cell.dbtTestStatus !== 'idle'}
		<CellStatusChip
			tone={cell.dbtTestStatus === 'fail'
				? 'destructive'
				: cell.dbtTestStatus === 'pass'
					? 'positive'
					: 'neutral'}
			onOpenChange={onOverlayChange}
		>
			{#snippet label()}
				{#if cell.dbtTestStatus === 'running'}
					<Loader2 class="animate-spin" />
					testing…
				{:else if cell.dbtTestStatus === 'pass'}
					<FlaskConical />
					{cell.dbtTestResults.length} passing
				{:else}
					<FlaskConical />
					{failedTests} failed
				{/if}
			{/snippet}
			{#snippet content()}
				<div class="space-y-2 text-xs">
					{#if cell.dbtTestStatus === 'running'}
						<p class="inline-flex items-center gap-1.5 text-muted-foreground">
							<Loader2 class="h-3 w-3 animate-spin" /> Running tests…
						</p>
					{:else if cell.dbtTestResults.length === 0}
						<p class="text-muted-foreground italic">
							No tests found for this model. Add tests to _models.yml.
						</p>
					{:else}
						<div class="flex flex-col gap-1">
							{#each cell.dbtTestResults as result (result.testName)}
								<div class="flex items-center gap-2">
									{#if result.status === 'pass'}
										<CheckCircle2 class="h-3 w-3 shrink-0 text-success" />
									{:else}
										<XCircle class="h-3 w-3 shrink-0 text-destructive" />
									{/if}
									<span class="font-mono">{result.testName}</span>
									{#if result.column}
										<span class="text-muted-foreground">({result.column})</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					<button
						class="rounded border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted/60 disabled:opacity-50"
						disabled={cell.dbtTestStatus === 'running'}
						onclick={onRunTests}
					>
						Run tests again
					</button>
				</div>
			{/snippet}
		</CellStatusChip>
	{/if}

	{#if connectionName}
		<span
			class="inline-flex h-5 shrink-0 items-center rounded border border-border/70 px-1.5 font-mono text-2xs text-muted-foreground"
			title="This cell runs on {connectionName}"
		>
			{connectionName}
		</span>
	{/if}

	{#if onOpenFull}
		<button
			class="ml-auto shrink-0 rounded text-2xs text-muted-foreground underline-offset-2 transition-colors outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
			onclick={onOpenFull}
		>
			Open full results →
		</button>
	{/if}
</div>
