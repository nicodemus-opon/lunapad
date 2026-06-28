<script lang="ts">
	import { onDestroy } from 'svelte';
	import { renderPlotly, themeLayout } from '$lib/services/plotly-render.svelte';
	import type { Data, Layout } from 'plotly.js-dist-min';

	interface Props {
		figure: { data: Data[]; layout: Partial<Layout> } | null;
		errorText?: string | null;
	}

	const { figure, errorText = null }: Props = $props();

	let el: HTMLDivElement | undefined = $state();
	let Plotly: typeof import('plotly.js-dist-min') | undefined;

	async function render(): Promise<void> {
		if (!el || !figure) return;
		Plotly = await renderPlotly(el, figure.data, figure.layout);
	}

	$effect(() => {
		void figure;
		void themeLayout(); // re-render when the theme toggles
		void render();
	});

	// Plotly's own `config.responsive` only reacts to window resize, not
	// arbitrary container resize (split-panel drags, sidebar toggles) — so
	// container resize is still observed here, but resolved via
	// Plotly.Plots.resize(el) (in-place reflow) rather than a full re-render.
	$effect(() => {
		if (!el) return;
		const ro = new ResizeObserver(() => {
			if (Plotly && el) Plotly.Plots.resize(el);
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	onDestroy(() => {
		if (el && Plotly) Plotly.purge(el);
	});

	export async function exportPng(filename: string): Promise<void> {
		if (!el || !Plotly) return;
		const rect = el.getBoundingClientRect();
		const url = await Plotly.toImage(el, {
			format: 'png',
			width: rect.width,
			height: rect.height,
			scale: window.devicePixelRatio || 1
		});
		const a = document.createElement('a');
		a.download = filename;
		a.href = url;
		a.click();
	}
</script>

<div class="relative h-full w-full">
	<div bind:this={el} style="width:100%;height:100%"></div>
	{#if errorText}
		<div
			class="absolute inset-0 overflow-auto bg-background p-4 text-sm whitespace-pre-wrap text-destructive"
		>
			{errorText}
		</div>
	{/if}
</div>
