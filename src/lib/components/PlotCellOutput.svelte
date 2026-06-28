<script lang="ts">
	import PlotlyMount from './PlotlyMount.svelte';
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
	// live `.result` — not stored state, same as ChartView's chart-builder
	// derived values, so the chart updates as you type or as upstream cells
	// re-run.
	const result = $derived(evaluatePlotCell(cell.code, buildPlotScope(deps)));
</script>

<PlotlyMount figure={result.figure} errorText={result.error} />
