<script lang="ts">
	import {
		runCell,
		runPythonCell,
		cancelCell,
		updateCellCode,
		updatePythonCellCode,
		updateCellName,
		updateGuiStages,
		runGuiStagePreview,
		setStageResultCollapsed,
		getPrecedingCodeForCell,
		setCellResultViewMode,
		setCellResultChartConfig,
		updateCellColumnWidths,
		openWorksheetView,
		getCells,
		getConnections,
		getTables,
		getExternalSchemaTables,
		getPythonTableHints,
		getIsDbtProject,
		testCell,
		type Cell
	} from '$lib/stores/notebook.svelte';
	import { toast } from 'svelte-sonner';
	import Editor from '$lib/components/Editor.svelte';
	import GUIEditor from '$lib/components/gui/GUIEditor.svelte';
	import InlineResultView from '$lib/components/InlineResultView.svelte';
	import PythonCellOutput from '$lib/components/PythonCellOutput.svelte';
	import CellMenu from '$lib/components/cell/CellMenu.svelte';
	import CellModeSwitchDialogs from '$lib/components/cell/CellModeSwitchDialogs.svelte';
	import MaterializeDialog from '$lib/components/MaterializeDialog.svelte';
	import PromoteDialog from '$lib/components/PromoteDialog.svelte';
	import PromoteSeedDialog from '$lib/components/PromoteSeedDialog.svelte';
	import {
		BUILTIN_DUCKDB_CONNECTION_ID,
		getPRQLTargetForConnection,
		resolveConnection
	} from '$lib/types/connection';
	import { createCellModeSwitch, cellModeOf } from '$lib/services/cell-mode-switch.svelte';
	import { registerCellMeta } from '$lib/keyboard/cell-bridge.svelte';
	import { mapErrorsToStages } from '$lib/services/gui-prql';
	import type { PRQLStageError } from '$lib/services/gui-prql';
	import type { GUISourceSchema } from '$lib/types/gui-pipeline';
	import { Loader2, Pin, PinOff, Play, Maximize2, ChevronsDownUp, ChevronsUpDown } from '@lucide/svelte';

	interface Props {
		cellId: string;
		pinned: boolean;
		selected: boolean;
		dark?: boolean;
		notebookId: string;
		reportView?: boolean;
		onFocus: () => void;
		onBlur: () => void;
		onTogglePin: () => void;
		onSetDisplay: (display: 'full' | 'output' | 'collapsed') => void;
		onDelete: () => void;
	}

	const {
		cellId,
		pinned,
		selected,
		dark = false,
		notebookId,
		reportView = false,
		onFocus,
		onBlur,
		onTogglePin,
		onSetDisplay,
		onDelete
	}: Props = $props();

	const cells = $derived(getCells());
	const cell = $derived(cells.find((c) => c.id === cellId) ?? null);
	const cellIndex = $derived(cell ? cells.findIndex((c) => c.id === cell.id) : -1);
	const isQueryCell = $derived(cell?.cellType === 'query');
	const isPythonCell = $derived(cell?.cellType === 'python');
	const isPlotCell = $derived(cell?.cellType === 'plot');
	const pythonTableHints = $derived(cell ? getPythonTableHints(cell.code, notebookId) : []);
	const connections = $derived(getConnections());
	const isDbtProject = $derived(getIsDbtProject());
	const connectionValue = $derived(cell?.connectionId ?? BUILTIN_DUCKDB_CONNECTION_ID);

	let focused = $state(false);
	let hovered = $state(false);
	let editorRef = $state<{ focus: () => void } | null>(null);
	let nameDraft = $state('');
	let nameFocused = $state(false);
	let menuOpen = $state(false);
	let sqlExpanded = $state(false);
	let materializeDialogOpen = $state(false);
	let promoteDialogOpen = $state(false);
	let promoteSeedDialogOpen = $state(false);

	const collapsed = $derived(cell?.display === 'collapsed');
	const codeExpanded = $derived(
		!reportView && !collapsed && (pinned || cell?.display === 'full')
	);
	const running = $derived(cell?.status === 'running');
	const showResult = $derived(
		!collapsed &&
			!cell?.hideResult &&
			Boolean(cell?.result) &&
			(cell?.status === 'success' || cell?.status === 'running')
	);
	const showPythonOutput = $derived(
		!collapsed && !cell?.hideResult && isPythonCell && Boolean(cell?.pythonOutput)
	);
	const hasVisibleOutput = $derived(showResult || showPythonOutput);

	// ── PRQL / Visual / SQL toggle ────────────────────────────────────────────
	const tables = $derived(getTables());
	const externalSchemaTables = $derived(getExternalSchemaTables());
	const cellSqlDialect = $derived(
		getPRQLTargetForConnection(resolveConnection(connections, cell?.connectionId))
	);
	const cellMode = $derived(cell ? cellModeOf(cell) : 'prql');
	const isGuiMode = $derived(isQueryCell && cell?.editMode === 'gui');

	const modeSwitch = createCellModeSwitch(
		() => cell,
		() => cellSqlDialect
	);

	const connectionType = $derived(
		connections.find((entry) => entry.id === connectionValue)?.type ?? 'duckdb-wasm'
	);
	const cellCatalogName = $derived.by(() => {
		if (connectionType === 'duckdb-wasm') return undefined;
		const conn = connections.find((c) => c.id === connectionValue);
		return (conn as { catalogName?: string } | undefined)?.catalogName;
	});
	const guiTables = $derived.by(() => {
		if (connectionValue === BUILTIN_DUCKDB_CONNECTION_ID) return tables;
		const merged: typeof tables = [];
		const seen = new Set<string>();
		for (const table of externalSchemaTables) {
			if (table.connectionId !== connectionValue) continue;
			const qualifiedName =
				cellCatalogName && table.schema
					? `${cellCatalogName}.${table.schema}.${table.name}`
					: table.schema
						? `${table.schema}.${table.name}`
						: table.name;
			if (seen.has(qualifiedName)) continue;
			seen.add(qualifiedName);
			merged.push({
				name: qualifiedName,
				fileName: qualifiedName,
				rowCount: 0,
				columns: table.columns,
				columnTypes: table.columnTypes
			});
		}
		return merged;
	});
	// Preceding query/python cells (with output names) become upstream schemas.
	const prevCellSources = $derived<GUISourceSchema[]>(
		cells
			.slice(0, cellIndex < 0 ? 0 : cellIndex)
			.filter(
				(c) => (c.cellType === 'query' || c.cellType === 'python') && c.outputName
			)
			.map((c) => ({ name: c.outputName || `_cell_${c.id}`, columns: c.result?.columns ?? [] }))
	);
	const stageErrorMap = $derived(
		cell && cell.editMode === 'gui' && cell.errors.length > 0
			? mapErrorsToStages(
					cell.guiStages,
					cell.errors,
					(() => {
						const p = getPrecedingCodeForCell(cell.id);
						return p ? p.split('\n').length : 0;
					})()
				)
			: new Map<number, PRQLStageError[]>()
	);

	// Register with the global keyboard dispatcher so ⌘↵ / ⇧↵ run the cell
	// (same as classic NotebookCell) instead of falling through to TipTap.
	$effect(() => {
		if (!cell || reportView) return;
		return registerCellMeta({
			cellId: cell.id,
			canInlinePrompt: isQueryCell && cell.editMode !== 'gui',
			isQueryCell,
			isGuiCell: isQueryCell && cell.editMode === 'gui',
			isDbtProject,
			worksheetEligible: isQueryCell || isPythonCell || isPlotCell,
			collapsed: cell.display === 'collapsed',
			display: cell.display,
			outputName: cell.outputName ?? ''
		});
	});

	function handleGutterClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		onSetDisplay('full');
		focused = true;
		onFocus();
		tickFocus();
	}

	function tickFocus(attempts = 5) {
		requestAnimationFrame(() => {
			if (editorRef) {
				editorRef.focus();
			} else if (attempts > 0) {
				// The Editor component may not be bound yet on the first frame after
				// the block expands from "click to edit"; retry a few frames so the
				// caret reliably lands in the newly shown editor.
				tickFocus(attempts - 1);
			}
		});
	}

	function handleRun() {
		if (!cell) return;
		if (running) cancelCell(cellId);
		else if (isPythonCell) void runPythonCell(cellId);
		else void runCell(cellId);
	}

	function handleCodeChange(code: string) {
		if (isPythonCell) updatePythonCellCode(cellId, code);
		else updateCellCode(cellId, code);
	}

	function handleEditorBlur() {
		focused = false;
		onBlur();
	}

	function fmtMs(ms: number): string {
		return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
	}

	$effect(() => {
		if (!selected && !pinned) focused = false;
	});

	$effect(() => {
		if (!nameFocused) nameDraft = cell?.outputName ?? '';
	});

	function commitName(nextName = nameDraft) {
		if (!cell) return;
		nameFocused = false;
		const result = updateCellName(cell.id, nextName.trim());
		if (!result.ok) {
			toast.error(result.error);
			nameDraft = cell.outputName;
		}
	}

	function expandCollapsed() {
		onSetDisplay('full');
		focused = true;
		onFocus();
	}

	function toggleCollapsed() {
		onSetDisplay(collapsed ? 'full' : 'collapsed');
	}

	function handleContainerKeydown(e: KeyboardEvent) {
		if (!collapsed) return;
		if (e.key !== 'Enter' && e.key !== ' ') return;
		if ((e.target as Element).closest('button, input, [data-no-expand], .qb-gutter')) return;
		e.preventDefault();
		expandCollapsed();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="query-block-view group/qb relative -ml-6 my-2 w-[calc(100%+1.5rem)] rounded-md border border-transparent transition-colors {selected
		? 'border-ring bg-muted/10'
		: collapsed
			? 'cursor-pointer border-border/60 bg-muted/10 hover:border-border'
			: 'hover:border-border'}"
	data-cell-id={cellId}
	role={collapsed ? 'button' : undefined}
	tabindex={collapsed ? 0 : undefined}
	aria-label={collapsed ? `Expand ${cell?.outputName || 'query block'}` : undefined}
	onclick={(e) => {
		if (!collapsed) return;
		if ((e.target as Element).closest('button, input, [data-no-expand], .qb-gutter')) return;
		expandCollapsed();
	}}
	onkeydown={handleContainerKeydown}
	onfocusin={() => {
		if (collapsed) return;
		focused = true;
		onFocus();
	}}
	onfocusout={(e) => {
		if (collapsed) return;
		const related = e.relatedTarget as Node | null;
		if (related && e.currentTarget.contains(related)) return;
		handleEditorBlur();
	}}
	onmouseenter={() => (hovered = true)}
	onmouseleave={() => (hovered = false)}
>
	<div class="flex gap-1">
		<div
			class="qb-gutter flex w-5 shrink-0 flex-col items-center gap-0.5 pt-1 opacity-0 transition-opacity hover:opacity-100 group-focus-within/qb:opacity-100 group-hover/qb:opacity-100 {selected ||
			focused ||
			menuOpen
				? 'opacity-100'
				: ''}"
		>
			{#if cell}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div onmousedown={(e) => e.stopPropagation()}>
					<CellMenu
						{cell}
						{notebookId}
						{isQueryCell}
						{isPythonCell}
						isFirst={cellIndex <= 0}
						isLast={cellIndex < 0 || cellIndex >= cells.length - 1}
						{isDbtProject}
						{connections}
						{connectionValue}
						bind:sqlExpanded
						bind:open={menuOpen}
						onOpenMaterialize={() => (materializeDialogOpen = true)}
						onOpenPromote={() => (promoteDialogOpen = true)}
						onOpenPromoteSeed={() => (promoteSeedDialogOpen = true)}
						onRunTests={() => void testCell(cell.id)}
						onOpenWorksheet={() => {
							if (notebookId) openWorksheetView(notebookId, cell.id);
						}}
						{isPlotCell}
						dragHandle={false}
						onDisplayChange={onSetDisplay}
					/>
				</div>
			{/if}
			{#if cell?.cellType === 'query' || cell?.cellType === 'python' || cell?.cellType === 'plot'}
				<button
					type="button"
					class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 {running
						? 'text-primary'
						: ''}"
					title={running ? 'Cancel' : 'Run'}
					aria-label={running ? 'Cancel run' : 'Run block'}
					onclick={(e) => {
						e.stopPropagation();
						handleRun();
					}}
				>
					{#if running}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<Play class="h-3.5 w-3.5 fill-current" />
					{/if}
				</button>
			{/if}
			{#if !reportView}
				<button
					type="button"
					class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					title={collapsed ? 'Expand cell' : 'Collapse cell'}
					aria-label={collapsed ? 'Expand cell' : 'Collapse cell'}
					onclick={(e) => {
						e.stopPropagation();
						toggleCollapsed();
					}}
				>
					{#if collapsed}
						<ChevronsUpDown class="h-3.5 w-3.5" />
					{:else}
						<ChevronsDownUp class="h-3.5 w-3.5" />
					{/if}
				</button>
			{/if}
			{#if !reportView && !collapsed}
				<button
					type="button"
					class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					title="Open in worksheet (rename, language, GUI editor)"
					aria-label="Open in worksheet"
					onmousedown={(e) => {
						e.preventDefault();
						e.stopPropagation();
						if (notebookId) openWorksheetView(notebookId, cellId);
					}}
				>
					<Maximize2 class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if !reportView && !collapsed}
				<button
					type="button"
					class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 {pinned
						? 'text-primary'
						: ''}"
					title={pinned ? 'Unpin code' : 'Pin code visible'}
					aria-label={pinned ? 'Unpin code' : 'Pin code'}
					onclick={(e) => {
						e.stopPropagation();
						onTogglePin();
					}}
				>
					{#if pinned}
						<PinOff class="h-3.5 w-3.5" />
					{:else}
						<Pin class="h-3.5 w-3.5" />
					{/if}
				</button>
			{/if}
		</div>

		<div class="min-w-0 flex-1">
			{#if cell}
				{#if collapsed}
					<div class="flex min-h-7 items-center gap-2 px-1 py-1">
						<span class="truncate font-mono text-sm font-medium text-foreground">
							{cell.outputName || 'Query'}
						</span>
						{#if cell.result && cell.status !== 'idle'}
							<span class="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
								{cell.result.rows.length.toLocaleString()} rows{cell.executionMs != null
									? ` · ${fmtMs(cell.executionMs)}`
									: ''}
							</span>
						{:else if isPythonCell && cell.pythonOutput && cell.status === 'success'}
							<span class="shrink-0 text-2xs text-muted-foreground">Python output</span>
						{:else if cell.status === 'running'}
							<span class="inline-flex items-center gap-1 text-2xs text-muted-foreground">
								<Loader2 class="h-3 w-3 animate-spin" />
								Running…
							</span>
						{:else if cell.status === 'error'}
							<span class="text-2xs text-destructive">Error</span>
						{/if}
					</div>
				{:else}
				<!-- Code comes FIRST (like any notebook); output renders below it. -->
				{#if codeExpanded && (cell.cellType === 'query' || cell.cellType === 'python' || cell.cellType === 'plot')}
					<div
						class="qb-code notebook-code-block overflow-hidden rounded-md border border-border bg-muted/15"
					>
						<div class="flex items-center justify-between border-b border-border px-2 py-0.5">
							<input
								class="h-5 min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-2xs text-muted-foreground outline-none focus:text-foreground"
								aria-label="Cell output name"
								placeholder="model name"
								value={nameDraft}
								onfocus={(e) => {
									nameFocused = true;
									(e.target as HTMLInputElement).select();
								}}
								oninput={(e) => {
									nameDraft = (e.target as HTMLInputElement).value;
								}}
								onblur={(e) => commitName((e.target as HTMLInputElement).value)}
								onclick={(e) => e.stopPropagation()}
								onkeydown={(e) => {
									e.stopPropagation();
									if (e.key === 'Enter') {
										e.preventDefault();
										commitName((e.target as HTMLInputElement).value);
										(e.target as HTMLInputElement).blur();
									}
									if (e.key === 'Escape') {
										e.preventDefault();
										nameDraft = cell.outputName;
										(e.target as HTMLInputElement).blur();
									}
								}}
							/>
							{#if isQueryCell}
								<!-- svelte-ignore a11y_interactive_supports_focus -->
								<div class="mode-tabs" role="tablist" onmousedown={(e) => e.stopPropagation()}>
									<button
										type="button"
										class="mode-tab"
										class:is-active={cellMode === 'prql'}
										onclick={(e) => {
											e.stopPropagation();
											modeSwitch.setMode('prql');
										}}
										title="PRQL code mode"
										role="tab"
										aria-selected={cellMode === 'prql'}>PRQL</button
									>
									<button
										type="button"
										class="mode-tab"
										class:is-active={cellMode === 'visual'}
										onclick={(e) => {
											e.stopPropagation();
											modeSwitch.setMode('visual');
										}}
										title="Visual pipeline editor"
										role="tab"
										aria-selected={cellMode === 'visual'}>Visual</button
									>
									<button
										type="button"
										class="mode-tab"
										class:is-active={cellMode === 'sql'}
										onclick={(e) => {
											e.stopPropagation();
											modeSwitch.setMode('sql');
										}}
										title="SQL mode"
										role="tab"
										aria-selected={cellMode === 'sql'}>SQL</button
									>
								</div>
							{/if}
							{#if cell.executionMs != null}
								<span class="ml-2 text-2xs text-muted-foreground">{fmtMs(cell.executionMs)}</span>
							{/if}
						</div>
						{#if isGuiMode}
							<div class="qb-gui px-1 py-1">
								<GUIEditor
									stages={cell.guiStages}
									tables={guiTables}
									{prevCellSources}
									{dark}
									connectionId={connectionValue}
									{connectionType}
									stageResultsCollapsed={cell.stageResultsCollapsed}
									{stageErrorMap}
									onStagesChange={(stages) => updateGuiStages(cellId, stages)}
									onRunStage={(upToStageIdx) => runGuiStagePreview(cellId, upToStageIdx)}
									onStageResultCollapsedChange={(stageIdx, c) =>
										setStageResultCollapsed(cellId, stageIdx, c)}
								/>
							</div>
						{:else}
							<Editor
								bind:this={editorRef}
								code={cell.code}
								errors={cell.errors}
								language={cell.cellType === 'python'
									? 'python'
									: cell.language === 'sql'
										? 'sql'
										: 'prql'}
								pythonContext={isPythonCell ? { kind: 'data', notebookId } : undefined}
								pythonSchemas={isPythonCell ? prevCellSources : []}
								{pythonTableHints}
								{dark}
								layout="auto"
								embeddedNotebook
								onchange={handleCodeChange}
							/>
						{/if}
					</div>
				{:else if !hasVisibleOutput && cell.status !== 'running' && cell.status !== 'error' && !codeExpanded}
					<button
						type="button"
						class="w-full rounded-md border border-dashed border-border px-3 py-2 text-left text-xs text-muted-foreground hover:border-border hover:bg-muted/30"
						onclick={handleGutterClick}
					>
						{cell.outputName || (isPythonCell ? 'Python' : 'Query')} — click to edit
					</button>
				{/if}

				{#if showPythonOutput && cell.pythonOutput}
					<div class="qb-python-output {codeExpanded ? 'mt-1' : ''}">
						<PythonCellOutput output={cell.pythonOutput} />
					</div>
				{/if}

				{#if showResult && cell.result}
					<div class="qb-result {codeExpanded ? 'mt-1' : ''}">
						<InlineResultView
							rows={cell.result.rows}
							columns={cell.result.columns}
							name={cell.outputName || 'result'}
							initialViewMode={cell.resultViewMode}
							initialChartConfig={cell.resultChartConfig}
							onViewModeChange={(mode) => setCellResultViewMode(cellId, mode)}
							onChartConfigChange={(config) => setCellResultChartConfig(cellId, config)}
							columnWidths={cell.columnWidths}
							onColumnWidthsChange={(widths) => updateCellColumnWidths(cellId, widths)}
							controlsVisible={focused || selected || hovered}
							toolbarReserveSpace={false}
							executionMs={cell.executionMs}
							truncated={cell.result.truncated ?? false}
						/>
					</div>
				{:else if cell.status === 'running'}
					<div class="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
						Running…
					</div>
				{:else if cell.status === 'error' && !isPythonCell}
					<div
						class="rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive"
					>
						{cell.errors[0]?.reason ?? cell.errors[0]?.display ?? 'Query failed'}
					</div>
				{/if}
				{/if}
			{:else}
				<div class="px-3 py-2 text-xs text-muted-foreground">Missing cell</div>
			{/if}
		</div>
	</div>
</div>

{#if cell && (isQueryCell || isPythonCell)}
	<MaterializeDialog bind:open={materializeDialogOpen} {cell} {isDbtProject} />
	<PromoteDialog bind:open={promoteDialogOpen} {cell} />
	<PromoteSeedDialog bind:open={promoteSeedDialogOpen} {cell} />
{/if}

{#if isQueryCell}
	<CellModeSwitchDialogs
		bind:confirmSwitchToGui={modeSwitch.confirmSwitchToGui}
		bind:confirmSwitchToSql={modeSwitch.confirmSwitchToSql}
		bind:confirmSwitchToPrql={modeSwitch.confirmSwitchToPrql}
		onSwitchToGui={modeSwitch.doSwitchToGui}
		onSwitchToSql={modeSwitch.doSwitchToSql}
		onSwitchToPrql={modeSwitch.doSwitchToPrql}
	/>
{/if}

<style>
	.query-block-view :global(.notebook-code-block .monaco-editor) {
		min-height: 4rem;
	}

	.mode-tabs {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.625rem;
		padding: 0 0.125rem;
	}
	.mode-tab {
		position: relative;
		height: 1.25rem;
		padding: 0;
		border: none;
		background: transparent;
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--muted-foreground);
		cursor: pointer;
		transition: color var(--motion-fast) var(--motion-ease-out);
	}
	.mode-tab:hover {
		color: var(--foreground);
	}
	.mode-tab.is-active {
		color: var(--foreground);
	}
	.mode-tab.is-active::after {
		position: absolute;
		right: 0;
		bottom: -0.18rem;
		left: 0;
		height: 2px;
		border-radius: 999px;
		background: var(--secondary);
		content: '';
	}
	.mode-tab:focus-visible {
		outline: none;
		border-radius: var(--radius-sm);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--ring) 35%, transparent);
	}
</style>
