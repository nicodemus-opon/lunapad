<script lang="ts">
	import {
		runCell,
		cancelCell,
		updateCellCode,
		setCellResultViewMode,
		setCellResultChartConfig,
		openWorksheetView,
		getCells,
		type Cell
	} from '$lib/stores/notebook.svelte';
	import Editor from '$lib/components/Editor.svelte';
	import InlineResultView from '$lib/components/InlineResultView.svelte';
	import { Loader2, Pin, PinOff, Play, GripVertical, Maximize2 } from '@lucide/svelte';

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

	const cell = $derived(getCells().find((c) => c.id === cellId) ?? null);

	let focused = $state(false);
	let editorRef = $state<{ focus: () => void } | null>(null);

	const showCode = $derived(
		focused || pinned || selected || reportView === false && cell?.display === 'full'
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

	function tickFocus() {
		requestAnimationFrame(() => editorRef?.focus());
	}

	function handleRun() {
		if (!cell) return;
		if (running) cancelCell(cellId);
		else void runCell(cellId);
	}

	function handleEditorBlur() {
		focused = false;
		onBlur();
		if (cell && (cell.cellType === 'query' || cell.cellType === 'python' || cell.cellType === 'plot')) {
			void runCell(cellId);
		}
	}

	function fmtMs(ms: number): string {
		return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
	}

	$effect(() => {
		if (!selected && !pinned) focused = false;
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="query-block-view group/qb relative my-2 rounded-md border border-transparent transition-colors {selected
		? 'border-ring/40 bg-muted/10'
		: 'hover:border-border/40'}"
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
>
	<div class="flex gap-1">
		<div
			class="qb-gutter flex w-5 shrink-0 flex-col items-center gap-0.5 pt-1 opacity-0 transition-opacity group-hover/qb:opacity-100 group-focus-within/qb:opacity-100 {selected ||
			focused
				? 'opacity-100'
				: ''}"
		>
			<button
				type="button"
				class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
				title="Focus block"
				aria-label="Focus block"
				onmousedown={handleGutterClick}
			>
				<GripVertical class="h-3.5 w-3.5" />
			</button>
			{#if cell?.cellType === 'query' || cell?.cellType === 'python' || cell?.cellType === 'plot'}
				<button
					type="button"
					class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground {running
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
						<Play class="h-3 w-3 fill-current" />
					{/if}
				</button>
			{/if}
			{#if !reportView}
				<button
					type="button"
					class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
					title="Open in worksheet (rename, language, GUI editor)"
					aria-label="Open in worksheet"
					onclick={(e) => {
						e.stopPropagation();
						if (notebookId) openWorksheetView(notebookId, cellId);
					}}
				>
					<Maximize2 class="h-3 w-3" />
				</button>
			{/if}
			<button
				type="button"
				class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground {pinned
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
					<PinOff class="h-3 w-3" />
				{:else}
					<Pin class="h-3 w-3" />
				{/if}
			</button>
		</div>

		<div class="min-w-0 flex-1">
			{#if cell}
				{#if showResult && cell.result}
					<div class="qb-result mb-1">
						<InlineResultView
							rows={cell.result.rows}
							columns={cell.result.columns}
							name={cell.outputName || 'result'}
							initialViewMode={cell.resultViewMode}
							initialChartConfig={cell.resultChartConfig}
							onViewModeChange={(mode) => setCellResultViewMode(cellId, mode)}
							onChartConfigChange={(config) => setCellResultChartConfig(cellId, config)}
							controlsVisible={focused || selected}
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
					<div class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
						{cell.errors[0]?.reason ?? cell.errors[0]?.display ?? 'Query failed'}
					</div>
				{:else if !codeExpanded}
					<button
						type="button"
						class="w-full rounded-md border border-dashed border-border/50 px-3 py-2 text-left text-xs text-muted-foreground hover:border-border hover:bg-muted/30"
						onclick={handleGutterClick}
					>
						{cell.outputName || 'Query'} — click to edit
					</button>
				{/if}

				{#if codeExpanded && (cell.cellType === 'query' || cell.cellType === 'python' || cell.cellType === 'plot')}
					<div class="qb-code notebook-code-block overflow-hidden rounded-md border border-border/40 bg-muted/15">
						<div class="flex items-center justify-between border-b border-border/30 px-2 py-0.5">
							<span class="font-mono text-2xs text-muted-foreground">{cell.outputName || 'query'}</span>
							{#if cell.executionMs != null}
								<span class="text-2xs text-muted-foreground">{fmtMs(cell.executionMs)}</span>
							{/if}
						</div>
						<Editor
							bind:this={editorRef}
							code={cell.code}
							errors={cell.errors}
							language={cell.cellType === 'python' ? 'python' : cell.language === 'sql' ? 'sql' : 'prql'}
							{dark}
							layout="auto"
							embeddedNotebook
							onchange={(c) => updateCellCode(cellId, c)}
						/>
					</div>
				{/if}
			{:else}
				<div class="px-3 py-2 text-xs text-muted-foreground">Missing cell</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.query-block-view :global(.notebook-code-block .monaco-editor) {
		min-height: 4rem;
	}
</style>
