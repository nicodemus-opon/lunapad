<script lang="ts">
	import PlotlyMount from './PlotlyMount.svelte';
	import ChartView from './ChartView.svelte';
	import ChartConfigurator from './ChartConfigurator.svelte';
	import { buildPlotScope, evaluatePlotCell } from '$lib/services/plot-cell';
	import { chartConfigToPlotCode } from '$lib/services/plot-defaults';
	import { isChartableSourceCell } from '$lib/services/cell-deps';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import type { ChartConfig } from '$lib/types/gui-pipeline';

	interface Props {
		cell: Cell;
		/** Resolved upstream cells (see resolvePlotDataRefs) — passed in rather
		 * than re-resolved here since the caller already computes this for the
		 * editor's intellisense globals too. Used for code-mode evaluation. */
		deps: Cell[];
		/** Every cell in the notebook, in document order — used to resolve
		 * plotSourceCellId and to list data-source options for GUI mode. */
		allCells: Cell[];
		onPlotSourceCellChange: (sourceCellId: string | null) => void;
		onPlotConfigChange: (config: ChartConfig | null) => void;
		/** Fires once with the ejected code when the user switches from GUI to
		 * code mode — the caller is expected to both save this as cell.code and
		 * flip plotMode to 'code'. One-way: there's no code-to-GUI equivalent,
		 * arbitrary JS can't be reconstructed into a ChartConfig. */
		onEjectToCode: (code: string) => void;
	}

	const { cell, deps, allCells, onPlotSourceCellChange, onPlotConfigChange, onEjectToCode }: Props =
		$props();

	const isGuiMode = $derived(cell.plotMode === 'gui');
	const sourceOptions = $derived(allCells.filter(isChartableSourceCell));
	const sourceCell = $derived(allCells.find((c) => c.id === cell.plotSourceCellId) ?? null);

	// Recomputed reactively from the cell's own code and its dependencies'
	// live `.result` — not stored state, same as ChartView's chart-builder
	// derived values, so the chart updates as you type or as upstream cells
	// re-run. Only relevant in code mode.
	const codeResult = $derived(evaluatePlotCell(cell.code, buildPlotScope(deps)));

	function handleSourceChange(e: Event): void {
		const value = (e.currentTarget as HTMLSelectElement).value;
		onPlotSourceCellChange(value || null);
	}

	function handleEject(): void {
		if (!cell.plotConfig || !sourceCell) return;
		onEjectToCode(chartConfigToPlotCode(cell.plotConfig, sourceCell.outputName));
	}
</script>

{#if isGuiMode}
	<div class="flex items-center justify-between gap-2 pb-1.5">
		<select
			class="h-6 max-w-48 truncate rounded-md border border-border bg-transparent px-1.5 text-2xs text-muted-foreground outline-none focus-visible:text-foreground"
			value={cell.plotSourceCellId ?? ''}
			onchange={handleSourceChange}
		>
			<option value="">Choose data source…</option>
			{#each sourceOptions as opt (opt.id)}
				<option value={opt.id}>{opt.outputName}</option>
			{/each}
		</select>
		<div class="flex items-center gap-1">
			{#if sourceCell?.result && cell.plotConfig}
				<ChartConfigurator
					config={cell.plotConfig}
					columns={sourceCell.result.columns}
					rows={sourceCell.result.rows}
					onUpdate={onPlotConfigChange}
				/>
			{/if}
			<button
				type="button"
				class="h-6 shrink-0 rounded-md px-2 font-mono text-2xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
				disabled={!cell.plotConfig || !sourceCell}
				title="Switch to freeform Plotly JS (one-way — can't switch back)"
				onclick={handleEject}
			>
				&lt;/&gt; Switch to code
			</button>
		</div>
	</div>
	{#if sourceCell?.result && cell.plotConfig}
		<ChartView
			config={cell.plotConfig}
			rows={sourceCell.result.rows}
			columns={sourceCell.result.columns}
		/>
	{:else}
		<p class="px-1 py-6 text-center text-xs text-muted-foreground italic">
			Pick a data source above to configure this chart.
		</p>
	{/if}
{:else}
	<PlotlyMount figure={codeResult.figure} errorText={codeResult.error} />
{/if}
