<script lang="ts">
	import { getContext } from 'svelte';
	import { Maximize2, X } from '@lucide/svelte';
	import ResultTable from '$lib/components/ResultTable.svelte';
	import { FILTER_CONTEXT_KEY, type FilterContextValue } from './filter-context';
	import type { ColumnFormatKind } from '$lib/services/column-format';
	import { pivotTable } from '$lib/services/report-table-pivot';
	import { summarizeTable, type TableAggKind } from '$lib/services/report-table-summary';

	interface Props {
		data?: Record<string, unknown>[];
		cols?: string[];
		limit?: number;
		linkedFilter?: string;
		pageSize?: number;
		headerInsights?: 'full' | 'compact';
		/**
		 * Advanced mechanics (client-side transforms) for `{% datatable %}`.
		 * - If `pivotBy` is set: performs a crosstab/pivot with `index` as rows.
		 * - Otherwise: performs a grouped summary with `index` as group-by.
		 */
		index?: string[];
		pivotBy?: string;
		valueCol?: string;
		agg?: TableAggKind;
		round?: number;
		valueFormatKind?: ColumnFormatKind;
		valueCurrencySymbol?: string;
	}

	const {
		data = [],
		cols,
		limit = 10,
		linkedFilter,
		pageSize = 10,
		headerInsights = 'compact',
		index,
		pivotBy,
		valueCol,
		agg = 'sum',
		round,
		valueFormatKind,
		valueCurrencySymbol
	}: Props = $props();

	const filterCtx = getContext<FilterContextValue | undefined>(FILTER_CONTEXT_KEY);
	const isLinkedActive = $derived(
		linkedFilter && filterCtx ? Boolean(filterCtx.getValue(linkedFilter)) : false
	);

	const columns = $derived(cols && cols.length ? cols : Object.keys(data[0] ?? {}));
	const rows = $derived(data.slice(0, limit));
	let fullscreen = $state(false);

	const sourceRows = $derived.by(() => (fullscreen ? data : rows));

	const transformed = $derived.by(() => {
		const src = sourceRows;
		const baseCols = columns;

		const resolvedIndex =
			index && index.length
				? index
				: pivotBy && valueCol
					? baseCols.filter((c) => c !== pivotBy && c !== valueCol)
					: index ?? [];

		if (pivotBy && valueCol && resolvedIndex.length) {
			return pivotTable(src, {
				index: resolvedIndex,
				pivotBy,
				valueCol,
				agg,
				round,
				valueFormatKind,
				valueCurrencySymbol
			});
		}

		if (valueCol && resolvedIndex.length && resolvedIndex.length) {
			return summarizeTable(src, {
				groupBy: resolvedIndex,
				valueCol,
				agg,
				round,
				valueFormatKind,
				valueCurrencySymbol
			});
		}

		return {
			columns: baseCols,
			rows: src,
			formatOverrides: undefined
		};
	});
</script>

{#if rows.length}
	<div class="md-datatable-wrap" class:linked-active={isLinkedActive}>
		<ResultTable
			rows={transformed.rows}
			columns={transformed.columns}
			name="datatable"
			pageSize={pageSize}
			headerInsights={headerInsights}
			truncated={!fullscreen && data.length > limit}
			columnFormatOverrides={transformed.formatOverrides}
			fillHeight={false}
		/>
		<div class="md-datatable-actions">
			{#if data.length > limit}
				<button
					class="md-datatable-expand"
					onclick={() => (fullscreen = true)}
					title="Show all rows"
					aria-label="Show all rows"
				>
					<Maximize2 class="h-3 w-3" />
				</button>
			{/if}
		</div>
	</div>
	{#if data.length > limit}
		<div class="md-datatable-truncated">showing {limit} of {data.length} rows</div>
	{/if}
{:else}
	<div class="md-datatable-empty">No rows</div>
{/if}

{#if fullscreen}
	<div class="md-datatable-overlay" role="dialog" aria-modal="true">
		<div class="md-datatable-overlay-header">
			<span>{data.length} rows</span>
			<button onclick={() => (fullscreen = false)} title="Close (Esc)" aria-label="Close">
				<X class="h-4 w-4" />
			</button>
		</div>
		<div class="md-datatable-overlay-body">
			<ResultTable
				rows={transformed.rows}
				columns={transformed.columns}
				name="datatable"
				pageSize={pageSize}
				headerInsights={headerInsights}
				fillHeight={true}
				truncated={false}
				columnFormatOverrides={transformed.formatOverrides}
			/>
		</div>
	</div>
{/if}

<svelte:window
	onkeydown={(e) => {
		if (fullscreen && e.key === 'Escape') fullscreen = false;
	}}
/>

<style>
	.md-datatable-wrap {
		position: relative;
	}
	.md-datatable-truncated,
	.md-datatable-empty {
		font-size: 0.72rem;
		opacity: 0.6;
		margin: 0.2rem 0 0.5rem;
	}
	.md-datatable-wrap.linked-active {
		outline: 2px solid color-mix(in oklch, var(--chart-1, #3b82f6) 50%, transparent);
		border-radius: 0.35rem;
	}
	.md-datatable-actions {
		position: absolute;
		/* Place actions below `ResultTable`'s global search input. */
		top: 2.25rem;
		right: 0.4rem;
		display: flex;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.md-datatable-expand {
		background: color-mix(in oklch, var(--background, white) 80%, transparent);
		border: 1px solid color-mix(in oklch, currentColor 15%, transparent);
		border-radius: 0.3rem;
		padding: 0.25rem;
	}
	.md-datatable-wrap:hover .md-datatable-actions {
		opacity: 1;
	}
	.md-datatable-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: color-mix(in oklch, var(--background, white) 96%, transparent);
		backdrop-filter: blur(8px);
		display: flex;
		flex-direction: column;
	}
	.md-datatable-overlay-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid color-mix(in oklch, currentColor 12%, transparent);
		font-weight: 600;
	}
	.md-datatable-overlay-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 1rem 1.5rem;
	}
</style>
