<script lang="ts">
	import { getContext } from 'svelte';
	import ChartView from '../ChartView.svelte';
	import { Button } from '$lib/components/ui/button';
	import type {
		ChartConfig,
		ChartType,
		ChartSeriesMode,
		ChartSortOrder
	} from '$lib/types/gui-pipeline';
	import {
		plotlyClickToFilterValue,
		resolveChartFilterBinding,
		toggleFilterValue
	} from '$lib/services/chart-filter';
	import {
		FILTER_CONTEXT_KEY,
		DRILL_CONTEXT_KEY,
		type FilterContextValue,
		type DrillContextValue
	} from './filter-context';
	import { Maximize2, X, Download, Table2 } from '@lucide/svelte';

	interface Props {
		data?: Record<string, unknown>[];
		chartType?: ChartType;
		xColumn?: string;
		yColumns?: string[];
		yColumnsSecondary?: string[];
		colorColumn?: string | null;
		sizeColumn?: string | null;
		seriesMode?: ChartSeriesMode;
		sortOrder?: ChartSortOrder;
		histogramBins?: number;
		title?: string;
		code?: string;
		compact?: boolean;
		height?: number;
		filterParam?: string;
		filterColumn?: string;
		drillCell?: string;
		latColumn?: string | null;
		lonColumn?: string | null;
		geoScope?: ChartConfig['geoScope'];
	}

	const {
		data = [],
		chartType,
		xColumn,
		yColumns,
		yColumnsSecondary,
		colorColumn = null,
		sizeColumn,
		seriesMode,
		sortOrder,
		histogramBins,
		title,
		code,
		compact = false,
		height = 280,
		filterParam,
		filterColumn,
		drillCell,
		latColumn = null,
		lonColumn = null,
		geoScope
	}: Props = $props();

	const filterCtx = getContext<FilterContextValue | undefined>(FILTER_CONTEXT_KEY);
	const drillCtx = getContext<DrillContextValue | undefined>(DRILL_CONTEXT_KEY);

	const config = $derived.by(
		(): ChartConfig => ({
			chartType: chartType ?? 'bar',
			xColumn: xColumn ?? '',
			yColumns: yColumns ?? [],
			yColumnsSecondary,
			colorColumn,
			sizeColumn,
			seriesMode,
			sortOrder,
			histogramBins,
			title,
			code,
			latColumn,
			lonColumn,
			geoScope
		})
	);

	const filterBinding = $derived(
		resolveChartFilterBinding({
			filterParam,
			filterColumn,
			xColumn: config.xColumn
		})
	);

	const columns = $derived(data[0] ? Object.keys(data[0]) : []);
	const effectiveHeight = $derived(compact ? 60 : height);

	const chartState = $derived.by((): 'ready' | 'empty' | 'missing-axis' => {
		if (!data.length) return 'empty';
		if (config.code?.trim()) return 'ready';
		if (!config.xColumn) return 'missing-axis';
		return 'ready';
	});

	let fullscreen = $state(false);
	let chartRef: ChartView | undefined = $state();

	function handlePlotClick(event: {
		points?: Array<{ x?: unknown; y?: unknown; label?: unknown; customdata?: unknown }>;
	}) {
		const point = event.points?.[0];
		if (!point) return;
		if (filterBinding && filterCtx) {
			const next = plotlyClickToFilterValue(point);
			if (next !== null) {
				const current = filterCtx.getValue(filterBinding.param);
				filterCtx.setValue(filterBinding.param, toggleFilterValue(current, next));
			}
		}
	}

	function openDrill() {
		if (drillCell) drillCtx?.openDetail?.(drillCell, title);
	}

	async function exportPng() {
		const name = (title ?? 'chart').replace(/\s+/g, '-').toLowerCase();
		await chartRef?.exportPng(`${name}.png`);
	}
</script>

<div class="md-chart" style="height: {effectiveHeight}px">
	{#if chartState === 'ready'}
		<ChartView
			bind:this={chartRef}
			rows={data}
			{columns}
			{config}
			height={effectiveHeight}
			onPlotClick={filterBinding ? handlePlotClick : undefined}
		/>
		<div class="md-chart-actions">
			{#if drillCell}
				<Button
					variant="ghost"
					size="icon-xs"
					class="md-chart-action md-action"
					onclick={openDrill}
					title="View detail rows"
					aria-label="View detail"
				>
					<Table2 class="h-3.5 w-3.5" />
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="icon-xs"
				class="md-chart-action md-action"
				onclick={exportPng}
				title="Download PNG"
				aria-label="Download PNG"
			>
				<Download class="h-3.5 w-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				class="md-chart-action md-action"
				onclick={() => (fullscreen = true)}
				title="Fullscreen"
				aria-label="Fullscreen"
			>
				<Maximize2 class="h-3.5 w-3.5" />
			</Button>
		</div>
	{:else if chartState === 'missing-axis'}
		<div class="md-chart-empty">Set x and y columns to preview chart</div>
	{:else}
		<div class="md-chart-empty">
			<p>Run query to preview chart</p>
			<div class="md-chart-ghost-bars" aria-hidden="true">
				{#each [42, 68, 55, 80, 48, 72, 60] as h (h)}
					<div class="md-chart-ghost-bar" style="height: {h}%"></div>
				{/each}
			</div>
		</div>
	{/if}
</div>

{#if fullscreen}
	<div class="md-chart-overlay" role="dialog" aria-modal="true">
		<div class="md-chart-overlay-header">
			<span>{title ?? 'Chart'}</span>
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
		<div class="md-chart-overlay-body">
			<ChartView
				rows={data}
				{columns}
				{config}
				height={undefined}
				onPlotClick={filterBinding ? handlePlotClick : undefined}
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
	.md-chart-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: color-mix(in oklch, var(--background, white) 96%, transparent);
		backdrop-filter: blur(8px);
		display: flex;
		flex-direction: column;
	}
	.md-chart-overlay-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border);
		font-weight: 600;
	}
	.md-chart-overlay-body {
		flex: 1;
		min-height: 0;
		padding: 1.5rem;
	}
</style>
