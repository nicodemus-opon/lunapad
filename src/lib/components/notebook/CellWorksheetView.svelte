<script lang="ts">
	import NotebookCell from '$lib/components/NotebookCell.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		runCell,
		runPythonCell,
		runPlotCell,
		cancelCell,
		closeWorksheetView,
		getConnections,
		type Cell
	} from '$lib/stores/notebook.svelte';
	import type { GUISourceSchema } from '$lib/types/gui-pipeline';
	import type { ResultViewMode } from '$lib/types/gui-pipeline';
	import { BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';
	import { Loader2, Minimize2, Play, X } from '@lucide/svelte';
	import CellStatusChip from '$lib/components/cell/CellStatusChip.svelte';

	let {
		cell,
		index,
		notebookId,
		dark = false,
		prevCellSources = [],
		autoRun = false,
		collabEnabled = false,
		onShareWithAI,
		onFixWithAI,
		onContinueWithAI,
		onOpenResultTab
	}: {
		cell: Cell;
		index: number;
		notebookId: string;
		dark?: boolean;
		prevCellSources?: GUISourceSchema[];
		autoRun?: boolean;
		collabEnabled?: boolean;
		onShareWithAI?: () => void;
		onFixWithAI?: (errorMsg: string) => void;
		onContinueWithAI?: (instruction: string) => void;
		onOpenResultTab?: (
			cellId: string,
			notebookId: string,
			name: string,
			preferredViewMode?: ResultViewMode
		) => void;
	} = $props();

	const isQueryCell = $derived(cell.cellType === 'query');
	const isPythonCell = $derived(cell.cellType === 'python');
	const isPlotCell = $derived(cell.cellType === 'plot');
	const running = $derived(cell.status === 'running');
	const connections = $derived(getConnections());
	const connectionName = $derived(
		cell.connectionId ? (connections.find((c) => c.id === cell.connectionId)?.name ?? null) : null
	);

	function run() {
		if (isPythonCell) runPythonCell(cell.id);
		else if (isPlotCell) runPlotCell(cell.id);
		else runCell(cell.id);
	}

	function exitWorksheet() {
		closeWorksheetView(notebookId);
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
	<div class="flex shrink-0 items-center gap-2 border-b border-border bg-background px-4 py-2">
		<span class="truncate font-mono text-sm font-medium text-foreground">
			{cell.outputName || `cell ${index + 1}`}
		</span>
		{#if connectionName}
			<CellStatusChip tone="neutral" class="font-mono" ariaLabel="Connection: {connectionName}">
				{#snippet label()}
					{connectionName}
				{/snippet}
			</CellStatusChip>
		{:else if isQueryCell}
			<CellStatusChip tone="neutral" class="font-mono" ariaLabel="Connection: DuckDB">
				{#snippet label()}
					DuckDB
				{/snippet}
			</CellStatusChip>
		{/if}
		<div class="flex-1"></div>
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					class="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					onclick={run}
					disabled={running}
					aria-label="Run cell"
				>
					{#if running}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<Play class="h-3.5 w-3.5" />
					{/if}
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content><p class="text-xs">Run cell (⇧↵)</p></Tooltip.Content>
		</Tooltip.Root>
		{#if running}
			<button
				class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
				onclick={() => cancelCell(cell.id)}
				aria-label="Cancel run"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		{/if}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					onclick={exitWorksheet}
					aria-label="Exit worksheet view"
				>
					<Minimize2 class="h-3.5 w-3.5" />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content><p class="text-xs">Exit worksheet view (Esc or ⌘E)</p></Tooltip.Content>
		</Tooltip.Root>
	</div>
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		{#key cell.id}
			<NotebookCell
				worksheet
				{cell}
				{index}
				isFirst={true}
				isLast={true}
				{dark}
				{prevCellSources}
				{notebookId}
				{autoRun}
				{onShareWithAI}
				{onFixWithAI}
				{onContinueWithAI}
				{onOpenResultTab}
				{collabEnabled}
			/>
		{/key}
	</div>
</div>
