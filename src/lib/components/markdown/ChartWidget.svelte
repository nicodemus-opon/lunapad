<script lang="ts">
	import { getContext } from 'svelte';
	import ChartView from '../ChartView.svelte';
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
		drillCell
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
			code
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
	{#if data.length && (config.xColumn || config.chartType === 'custom')}
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
				<button
					class="md-chart-action"
					onclick={openDrill}
					title="View detail rows"
					aria-label="View detail"
				>
					<Table2 class="h-3.5 w-3.5" />
				</button>
			{/if}
			<button
				class="md-chart-action"
				onclick={exportPng}
				title="Download PNG"
				aria-label="Download PNG"
			>
				<Download class="h-3.5 w-3.5" />
			</button>
			<button
				class="md-chart-action"
				onclick={() => (fullscreen = true)}
				title="Fullscreen"
				aria-label="Fullscreen"
			>
				<Maximize2 class="h-3.5 w-3.5" />
			</button>
		</div>
	{:else}
		<div class="md-chart-empty md-chart-skeleton">Loading chart…</div>
	{/if}
</div>

{#if fullscreen}
	<div class="md-chart-overlay" role="dialog" aria-modal="true">
		<div class="md-chart-overlay-header">
			<span>{title ?? 'Chart'}</span>
			<button onclick={() => (fullscreen = false)} title="Close (Esc)" aria-label="Close">
				<X class="h-4 w-4" />
			</button>
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
	.md-chart {
		width: 100%;
		margin: 0.5rem 0;
		position: relative;
	}
	.md-chart-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 0.8rem;
		opacity: 0.6;
	}
	.md-chart-skeleton {
		animation: chart-pulse 1.5s ease-in-out infinite;
	}
	@keyframes chart-pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 0.85;
		}
	}
	.md-chart-actions {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		display: flex;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.md-chart:hover .md-chart-actions {
		opacity: 1;
	}
	.md-chart-action {
		background: color-mix(in oklch, var(--background, white) 80%, transparent);
		border: 1px solid color-mix(in oklch, currentColor 15%, transparent);
		border-radius: 0.3rem;
		padding: 0.25rem;
	}
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
		border-bottom: 1px solid color-mix(in oklch, currentColor 12%, transparent);
		font-weight: 600;
	}
	.md-chart-overlay-body {
		flex: 1;
		min-height: 0;
		padding: 1.5rem;
	}
</style>
