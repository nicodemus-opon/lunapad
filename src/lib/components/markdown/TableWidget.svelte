<script lang="ts">
	import { getContext } from 'svelte';
	import { Maximize2, X, Download } from '@lucide/svelte';
	import * as Table from '$lib/components/ui/table';
	import { downloadCsv } from '$lib/services/widget-export';
	import { FILTER_CONTEXT_KEY, type FilterContextValue } from './filter-context';

	interface Props {
		data?: Record<string, unknown>[];
		cols?: string[];
		limit?: number;
		linkedFilter?: string;
	}

	const { data = [], cols, limit = 10, linkedFilter }: Props = $props();

	const filterCtx = getContext<FilterContextValue | undefined>(FILTER_CONTEXT_KEY);
	const isLinkedActive = $derived(
		linkedFilter && filterCtx ? Boolean(filterCtx.getValue(linkedFilter)) : false
	);

	const columns = $derived(cols && cols.length ? cols : Object.keys(data[0] ?? {}));
	const rows = $derived(data.slice(0, limit));
	let fullscreen = $state(false);

	function fmt(v: unknown): string {
		if (v === null || v === undefined) return '—';
		if (typeof v === 'number') return v.toLocaleString();
		return String(v);
	}

	function exportCsv() {
		downloadCsv('table.csv', columns, data);
	}
</script>

{#snippet table(rowsToShow: Record<string, unknown>[])}
	<Table.Root containerClass="rounded-md " class="text-xs">
		<Table.Header>
			<Table.Row>
				{#each columns as col (col)}<Table.Head class="h-7 px-2">{col}</Table.Head>{/each}
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rowsToShow as row, i (i)}
				<Table.Row>
					{#each columns as col (col)}<Table.Cell class="h-7 px-2">{fmt(row[col])}</Table.Cell
						>{/each}
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/snippet}

{#if rows.length}
	<div class="md-datatable-wrap" class:linked-active={isLinkedActive}>
		{@render table(rows)}
		<div class="md-datatable-actions">
			<button
				class="md-datatable-expand"
				onclick={exportCsv}
				title="Download CSV"
				aria-label="Download CSV"
			>
				<Download class="h-3 w-3" />
			</button>
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
			{@render table(data)}
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
		top: 0.5rem;
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
