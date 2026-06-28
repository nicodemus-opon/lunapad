// Shared Plotly mounting/theming logic — every chart-rendering surface in the
// app (ChartView's built-in charts, plot cells, Python-cell figures via
// PlotlyView) goes through this so they never drift from one another and the
// ~1MB plotly.js-dist-min bundle is only ever fetched once.
import { resolveCSSColor, resolveChartColorway } from '$lib/utils/theme-colors';
import type { Data, Layout, Config } from 'plotly.js-dist-min';

let plotlyModule: typeof import('plotly.js-dist-min') | undefined;

/** Lazily imports plotly.js-dist-min once and caches the module reference. */
export async function loadPlotly(): Promise<typeof import('plotly.js-dist-min')> {
	plotlyModule ??= await import('plotly.js-dist-min');
	return plotlyModule;
}

// `mode-watcher`'s `mode` store isn't wired to this app's actual theme system
// (+layout.svelte resolves its own `getTheme()`/'system' state and toggles
// `.dark`/`.light` classes on <html> directly — mode-watcher is never told
// about that). So the only reliable signal that the *visual* theme changed is
// the DOM mutation itself: watch <html>'s class attribute and bump a counter,
// which every theme-color-resolving $derived reads to know when to re-run
// resolveCSSColor/resolveChartColorway.
let themeTick = $state(0);
let observing = false;

function ensureThemeObserver(): void {
	if (observing || typeof document === 'undefined') return;
	observing = true;
	const observer = new MutationObserver(() => {
		themeTick++;
	});
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

/** Read inside any `$derived`/`$derived.by` that resolves CSS custom
 *  properties (resolveCSSColor/resolveChartColorway) so it recomputes
 *  whenever the app's light/dark theme actually changes. */
export function watchTheme(): number {
	ensureThemeObserver();
	return themeTick;
}

/** Re-resolves the app's OKLCH design tokens into a Plotly layout patch.
 *  `hoverlabel`/`hovermode` theme every chart's tooltip too, replacing the
 *  old `.plot-tip` CSS hack ChartView used for Observable Plot. */
export function themeLayout(): Partial<Layout> {
	void watchTheme();
	const background = resolveCSSColor('--background');
	const foreground = resolveCSSColor('--foreground');
	const border = resolveCSSColor('--border');
	const mutedForeground = resolveCSSColor('--muted-foreground');
	const popover = resolveCSSColor('--popover');
	const popoverForeground = resolveCSSColor('--popover-foreground');
	return {
		paper_bgcolor: background,
		plot_bgcolor: background,
		font: {
			color: foreground,
			family: 'IBM Plex Sans, ui-sans-serif, system-ui, sans-serif',
			size: 11
		},
		colorway: resolveChartColorway(),
		hovermode: 'closest',
		hoverlabel: {
			bgcolor: popover,
			bordercolor: border,
			font: { color: popoverForeground }
		},
		xaxis: {
			gridcolor: border,
			linecolor: border,
			zerolinecolor: border,
			color: mutedForeground
		},
		yaxis: {
			gridcolor: border,
			linecolor: border,
			zerolinecolor: border,
			color: mutedForeground
		},
		margin: { t: 30, r: 16, b: 36, l: 48 }
	};
}

export const DEFAULT_PLOTLY_CONFIG: Partial<Config> = { displayModeBar: false, responsive: true };

/** Mounts/updates a figure into `el` via Plotly.react(), merging the figure's
 *  own layout under the live theme so callers don't each re-derive theming. */
export async function renderPlotly(
	el: HTMLDivElement,
	data: Data[],
	layout: Partial<Layout>,
	opts: { height?: number; config?: Partial<Config> } = {}
): Promise<typeof import('plotly.js-dist-min')> {
	const Plotly = await loadPlotly();
	await Plotly.react(
		el,
		data,
		mergeThemeLayout(layout, opts.height),
		opts.config ?? DEFAULT_PLOTLY_CONFIG
	);
	return Plotly;
}

/** Layers the live theme under a figure's own layout — a shallow `{...a,...b}`
 *  spread would let the theme's `xaxis`/`yaxis` (which only carry color
 *  defaults) wholesale clobber a figure's own axis config (categoryarray,
 *  tickangle, title, etc.), so those nested objects are merged one level
 *  deep instead, figure-specific keys winning. */
export function mergeThemeLayout(layout: Partial<Layout>, height?: number): Partial<Layout> {
	const theme = themeLayout();
	return {
		...theme,
		...layout,
		xaxis: { ...theme.xaxis, ...layout.xaxis },
		yaxis: { ...theme.yaxis, ...layout.yaxis },
		hoverlabel: { ...theme.hoverlabel, ...layout.hoverlabel },
		margin: { ...theme.margin, ...layout.margin },
		...(height ? { height } : {})
	};
}
