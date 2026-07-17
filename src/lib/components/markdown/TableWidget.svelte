<script lang="ts">
	import { getContext } from 'svelte';
	import { Maximize2, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import ResultTable from '$lib/components/ResultTable.svelte';
	import { FILTER_CONTEXT_KEY, type FilterContextValue } from './filter-context';
	import type { ColumnFormatKind } from '$lib/services/column-format';
	import { pivotTable } from '$lib/services/report-table-pivot';
	import { summarizeTable, type TableAggKind } from '$lib/services/report-table-summary';
	import type {
		ColumnConditionalRules,
		ReportTableConditionalRule
	} from '$lib/services/report-table-conditional-format';

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
		conditionalFormats?: Array<{ column: string; rules: ReportTableConditionalRule[] }>;
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
		valueCurrencySymbol,
		conditionalFormats = []
	}: Props = $props();

	const filterCtx = getContext<FilterContextValue | undefined>(FILTER_CONTEXT_KEY);
	const isLinkedActive = $derived(
		linkedFilter && filterCtx ? Boolean(filterCtx.getValue(linkedFilter)) : false
	);

	const columns = $derived(cols && cols.length ? cols : Object.keys(data[0] ?? {}));
	// `limit` is treated as rows-per-page; the table paginates the full set.
	const effectivePageSize = $derived((limit && limit > 0 ? limit : pageSize) || 10);
	let fullscreen = $state(false);

	const transformed = $derived.by(() => {
		const src = data;
		const baseCols = columns;

		const resolvedIndex =
			index && index.length
				? index
				: pivotBy && valueCol
					? baseCols.filter((c) => c !== pivotBy && c !== valueCol)
					: (index ?? []);

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

	const conditionalRuleMap = $derived.by(() => {
		const out: ColumnConditionalRules = {};
		for (const item of conditionalFormats) {
			if (!item || typeof item !== 'object') continue;
			const col = typeof item.column === 'string' ? item.column : '';
			if (!col || !Array.isArray(item.rules)) continue;
			out[col] = item.rules as ReportTableConditionalRule[];
		}
		return out;
	});
	const ghostCols = $derived(Math.min(Math.max(columns.length || 4, 3), 6));
</script>

{#if transformed.rows.length}
	<div class="md-datatable-wrap" class:linked-active={isLinkedActive}>
		<ResultTable
			rows={transformed.rows}
			columns={transformed.columns}
			name="datatable"
			pageSize={effectivePageSize}
			{headerInsights}
			truncated={false}
			columnFormatOverrides={transformed.formatOverrides}
			columnFormatRules={conditionalRuleMap}
			fillHeight={false}
		/>
		<div class="md-datatable-actions">
			{#if transformed.rows.length > effectivePageSize}
				<Button
					variant="ghost"
					size="icon-xs"
					class="md-datatable-expand md-action"
					onclick={() => (fullscreen = true)}
					title="Expand table"
					aria-label="Expand table"
				>
					<Maximize2 class="h-3 w-3" />
				</Button>
			{/if}
		</div>
	</div>
{:else}
	<div class="md-datatable-empty">
		<p>{data.length ? 'No rows after filter' : 'Run query to preview table'}</p>
		<div class="md-datatable-ghost" style="--md-ghost-cols: {ghostCols}">
			{#each [1, 2, 3, 4] as row (row)}
				<div class="md-datatable-ghost-row">
					{#each Array(ghostCols) as _, col (col)}
						<div class="md-datatable-ghost-cell"></div>
					{/each}
				</div>
			{/each}
		</div>
	</div>
{/if}

{#if fullscreen}
	<div class="md-datatable-overlay" role="dialog" aria-modal="true">
		<div class="md-datatable-overlay-header">
			<span>{data.length} rows</span>
			<Button
				variant="ghost"
				size="icon-sm"
				onclick={() => (fullscreen = false)}
				title="Close (Esc)"
				aria-label="Close"
			>
				<X class="h-4 w-4" />
			</Button>
		</div>
		<div class="md-datatable-overlay-body">
			<ResultTable
				rows={transformed.rows}
				columns={transformed.columns}
				name="datatable"
				pageSize={effectivePageSize}
				{headerInsights}
				fillHeight={true}
				truncated={false}
				columnFormatOverrides={transformed.formatOverrides}
				columnFormatRules={conditionalRuleMap}
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
	.md-datatable-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: color-mix(in oklab, var(--background) 96%, transparent);
		backdrop-filter: blur(8px);
		display: flex;
		flex-direction: column;
	}
	.md-datatable-overlay-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border);
		font-weight: 600;
	}
	.md-datatable-overlay-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 1rem 1.5rem;
	}
</style>
