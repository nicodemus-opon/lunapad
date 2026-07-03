<script lang="ts">
	import {
		runCell,
		cancelCell,
		updateCellCode,
		updateCellName,
		setCellResultViewMode,
		setCellResultChartConfig,
		openWorksheetView,
		getCells,
		getConnections,
		getIsDbtProject,
		testCell,
		type Cell
	} from '$lib/stores/notebook.svelte';
	import { toast } from 'svelte-sonner';
	import Editor from '$lib/components/Editor.svelte';
	import InlineResultView from '$lib/components/InlineResultView.svelte';
	import CellMenu from '$lib/components/cell/CellMenu.svelte';
	import MaterializeDialog from '$lib/components/MaterializeDialog.svelte';
	import PromoteDialog from '$lib/components/PromoteDialog.svelte';
	import PromoteSeedDialog from '$lib/components/PromoteSeedDialog.svelte';
	import { BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';
	import { Loader2, Pin, PinOff, Play, Maximize2 } from '@lucide/svelte';

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
		onDelete
	}: Props = $props();

	const cells = $derived(getCells());
	const cell = $derived(cells.find((c) => c.id === cellId) ?? null);
	const cellIndex = $derived(cell ? cells.findIndex((c) => c.id === cell.id) : -1);
	const isQueryCell = $derived(cell?.cellType === 'query');
	const isPythonCell = $derived(cell?.cellType === 'python');
	const isPlotCell = $derived(cell?.cellType === 'plot');
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

	const showCode = $derived(
		focused || pinned || selected || (reportView === false && cell?.display === 'full')
	);
	const codeExpanded = $derived(!reportView && (focused || pinned || cell?.display === 'full'));
	const running = $derived(cell?.status === 'running');
	const hasResult = $derived(Boolean(cell?.result && cell.status === 'success'));
	const showResult = $derived(hasResult && !cell?.hideResult);

	function handleGutterClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
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
		else void runCell(cellId);
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="query-block-view group/qb relative my-2 rounded-md border border-transparent transition-colors {selected
		? 'border-ring bg-muted/10'
		: 'hover:border-border'}"
	data-cell-id={cellId}
	onfocusin={() => {
		focused = true;
		onFocus();
	}}
	onfocusout={(e) => {
		const related = e.relatedTarget as Node | null;
		if (related && e.currentTarget.contains(related)) return;
		handleEditorBlur();
	}}
	onmouseenter={() => (hovered = true)}
	onmouseleave={() => (hovered = false)}
>
	<div class="flex gap-1">
		<div
			class="qb-gutter flex w-5 shrink-0 flex-col items-center gap-0.5 pt-1 opacity-0 transition-opacity group-focus-within/qb:opacity-100 group-hover/qb:opacity-100 {selected ||
			focused ||
			menuOpen
				? 'opacity-100'
				: ''}"
		>
			{#if cell}
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
						isPlotCell={isPlotCell}
						dragHandle={false}
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
		</div>

		<div class="min-w-0 flex-1">
			{#if cell}
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
							{#if cell.executionMs != null}
								<span class="text-2xs text-muted-foreground">{fmtMs(cell.executionMs)}</span>
							{/if}
						</div>
						<Editor
							bind:this={editorRef}
							code={cell.code}
							errors={cell.errors}
							language={cell.cellType === 'python'
								? 'python'
								: cell.language === 'sql'
									? 'sql'
									: 'prql'}
							{dark}
							layout="auto"
							embeddedNotebook
							onchange={(c) => updateCellCode(cellId, c)}
						/>
					</div>
				{:else if !showResult && cell.status !== 'running' && cell.status !== 'error' && !codeExpanded}
					<button
						type="button"
						class="w-full rounded-md border border-dashed border-border px-3 py-2 text-left text-xs text-muted-foreground hover:border-border hover:bg-muted/30"
						onclick={handleGutterClick}
					>
						{cell.outputName || 'Query'} — click to edit
					</button>
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
				{:else if cell.status === 'error'}
					<div
						class="rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive"
					>
						{cell.errors[0]?.reason ?? cell.errors[0]?.display ?? 'Query failed'}
					</div>
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

<style>
	.query-block-view :global(.notebook-code-block .monaco-editor) {
		min-height: 4rem;
	}
</style>
