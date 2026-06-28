<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		renderPlotly,
		themeLayout,
		DEFAULT_PLOTLY_CONFIG
	} from '$lib/services/plotly-render.svelte';
	import type { Data, Layout } from 'plotly.js-dist-min';

	interface Props {
		/** A Plotly figure spec as JSON (Figure.to_json() from python-runner.ts's
		 *  wrapper script) — `{data: [...], layout: {...}}`. */
		figureJson: string;
		height?: number;
	}

	const { figureJson, height = 360 }: Props = $props();

	let el: HTMLDivElement | undefined = $state();
	let Plotly: typeof import('plotly.js-dist-min') | undefined;

	const figure = $derived.by(() => {
		try {
			return JSON.parse(figureJson) as { data: Data[]; layout: Partial<Layout> };
		} catch {
			return null;
		}
	});

	async function render(): Promise<void> {
		if (!el || !figure) return;
		Plotly = await renderPlotly(el, figure.data, figure.layout, {
			height,
			config: DEFAULT_PLOTLY_CONFIG
		});
	}

	$effect(() => {
		void figure;
		void themeLayout(); // re-render when the theme toggles
		void render();
	});

	onDestroy(() => {
		if (el && Plotly) Plotly.purge(el);
	});
</script>

<div bind:this={el} style="height: {height}px;"></div>

{#if figure === null}
	<p class="text-xs text-destructive/90">Couldn't parse this figure's JSON spec.</p>
{/if}
