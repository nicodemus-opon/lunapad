<script lang="ts">
	import type { DatasetOverview } from '$lib/services/column-profile';
	import { fmtPct, STATS_BAR_PRIMARY } from './stats-ui';

	interface Props {
		overview: DatasetOverview;
	}

	const { overview }: Props = $props();
</script>

<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
	<div class="rounded-lg border bg-card px-3 py-2.5">
		<p class="text-[10px] tracking-wider text-muted-foreground uppercase">Rows</p>
		<p class="mt-0.5 text-lg font-semibold tabular-nums">{overview.rowCount.toLocaleString()}</p>
	</div>
	<div class="rounded-lg border bg-card px-3 py-2.5">
		<p class="text-[10px] tracking-wider text-muted-foreground uppercase">Columns</p>
		<p class="mt-0.5 text-lg font-semibold tabular-nums">{overview.columnCount}</p>
	</div>
	<div class="rounded-lg border bg-card px-3 py-2.5">
		<p class="text-[10px] tracking-wider text-muted-foreground uppercase">Missing cells</p>
		<p class="mt-0.5 text-lg font-semibold tabular-nums">
			{overview.totalMissingCells.toLocaleString()}
		</p>
		{#if overview.rowCount > 0 && overview.columnCount > 0}
			<p class="text-[10px] text-muted-foreground tabular-nums">
				{fmtPct(
					(overview.totalMissingCells / (overview.rowCount * overview.columnCount)) * 100,
					1
				)} of grid
			</p>
		{/if}
	</div>
	<div class="rounded-lg border bg-card px-3 py-2.5">
		<p class="text-[10px] tracking-wider text-muted-foreground uppercase">Avg completeness</p>
		<p class="mt-0.5 text-lg font-semibold tabular-nums">
			{fmtPct(overview.avgCompleteness, 1)}
		</p>
		<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
			<div
				class="h-full rounded-full {STATS_BAR_PRIMARY} transition-all"
				style="width: {overview.avgCompleteness}%"
			></div>
		</div>
	</div>
</div>
