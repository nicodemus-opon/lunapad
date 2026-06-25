<script lang="ts">
	import PlotChart from './PlotChart.svelte';
	import { buildPlotScope, evaluatePlotCell } from '$lib/services/plot-cell';
	import type { Cell } from '$lib/stores/notebook.svelte';

	interface Props {
		cell: Cell;
		/** Resolved upstream cells (see resolvePlotDataRefs) — passed in rather
		 * than re-resolved here since the caller already computes this for the
		 * editor's intellisense globals too. */
		deps: Cell[];
	}

	const { cell, deps }: Props = $props();

	// Recomputed reactively from the cell's own code and its dependencies'
	// live `.result` — not stored state, same as ChartView's `plotRender`
	// derived, so the chart updates as you type or as upstream cells re-run.
	const render = $derived((width: number, height: number) =>
		evaluatePlotCell(cell.code, buildPlotScope(deps), width, height)
	);
</script>

<PlotChart {render} />
