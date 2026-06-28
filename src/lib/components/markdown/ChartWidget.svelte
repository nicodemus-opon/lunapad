<script lang="ts">
	// Renders the same ChartView (and therefore Plotly) used by inline cell
	// results, so theming and hover tooltips apply here too with no extra work.
	import ChartView from '../ChartView.svelte';
	import type {
		ChartConfig,
		ChartType,
		ChartSeriesMode,
		ChartSortOrder
	} from '$lib/types/gui-pipeline';
	import { Maximize2, X } from '@lucide/svelte';

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
		height = 280
	}: Props = $props();

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

	const columns = $derived(data[0] ? Object.keys(data[0]) : []);
	const effectiveHeight = $derived(compact ? 60 : height);
	let fullscreen = $state(false);
</script>

<div class="md-chart" style="height: {effectiveHeight}px">
	{#if data.length && (config.xColumn || config.chartType === 'custom')}
		<ChartView rows={data} {columns} {config} height={effectiveHeight} />
		<button
			class="md-chart-expand"
			onclick={() => (fullscreen = true)}
			title="Fullscreen"
			aria-label="Fullscreen"
		>
			<Maximize2 class="h-3.5 w-3.5" />
		</button>
	{:else}
		<div class="md-chart-empty">No chart data</div>
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
			<ChartView rows={data} {columns} {config} height={undefined} />
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
	.md-chart-expand {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		opacity: 0;
		transition: opacity 0.15s;
		background: color-mix(in oklch, var(--background, white) 80%, transparent);
		border: 1px solid color-mix(in oklch, currentColor 15%, transparent);
		border-radius: 0.3rem;
		padding: 0.25rem;
	}
	.md-chart:hover .md-chart-expand {
		opacity: 1;
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
