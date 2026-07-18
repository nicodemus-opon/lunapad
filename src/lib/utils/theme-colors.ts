// Shared CSS-custom-property → concrete-color resolution, used by every chart
// engine in the app (ChartView's Observable Plot charts, PlotlyView's Plotly
// figures) so they read the same OKLCH design tokens (src/routes/layout.css)
// and never drift from one another.
//
// Discrete fill/stroke channels in raw SVG can use `var(--chart-1)` strings
// directly — the browser resolves them at paint time. But some consumers
// (continuous color scale interpolation, Plotly layout properties, anything
// that isn't a live SVG attribute) need an actual parseable color, not a CSS
// custom property reference — that's what resolveCSSColor is for.

/** Converts an OKLCH triple (as used by this app's design tokens) to an sRGB
 *  `rgb(...)` string. */
export function oklchToRgb(l: number, c: number, h: number): string {
	const hRad = (h * Math.PI) / 180;
	const a = c * Math.cos(hRad);
	const b = c * Math.sin(hRad);
	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.291485548 * b;
	const ll = l_ ** 3,
		mm = m_ ** 3,
		ss = s_ ** 3;
	const lr = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss;
	const lg = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss;
	const lb = -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss;
	const gamma = (x: number) => {
		const v = Math.max(0, Math.min(1, x));
		return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
	};
	return `rgb(${Math.round(gamma(lr) * 255)},${Math.round(gamma(lg) * 255)},${Math.round(gamma(lb) * 255)})`;
}

// The published report page (/r/[token]) renders its charts during SSR, where
// `getComputedStyle`/`document` don't exist — reading a live CSS var there throws
// `ReferenceError: getComputedStyle is not defined` and 500s the whole page. Fall
// back to the `:root` (light-theme) design tokens from layout.css so SSR produces
// valid output; the client re-resolves the live theme (incl. dark mode) on hydration.
const isBrowser = typeof document !== 'undefined' && typeof getComputedStyle !== 'undefined';

const SSR_TOKEN_FALLBACKS: Record<string, string> = {
	'--chart-1': 'oklch(0.809 0.105 251.813)',
	'--chart-2': 'oklch(0.811 0.111 293.571)',
	'--chart-3': 'oklch(0.8816 0.0276 93.128)',
	'--chart-4': 'oklch(0.704 0.04 256.788)',
	'--chart-5': 'oklch(0.588 0.158 241.966)',
	'--radius': '0.395rem'
};

/** Reads a CSS custom property off `:root`, or an SSR-safe fallback when the DOM
 *  isn't available (server render of the shared report page). `overrides` lets a
 *  caller inject a resolved workspace brand theme's token values for that SSR
 *  pass — e.g. a shared report page rendering under a custom brand theme, where
 *  there's no live `document` to read the (client-only) override <style> tag
 *  from. Ignored in the browser, where getComputedStyle already reflects
 *  whatever theme is applied. */
function readCSSVar(varName: string, overrides?: Record<string, string>): string {
	if (!isBrowser) return overrides?.[varName] ?? SSR_TOKEN_FALLBACKS[varName] ?? '';
	return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/** Resolves a CSS custom property (e.g. `--chart-1`) on `:root` to a concrete
 *  color string — converts an `oklch(...)` value via oklchToRgb, passes
 *  anything else through unchanged.
 *
 *  Lightness may come back as a bare 0-1 fraction (`oklch(0.746 .16 232.661)`,
 *  what dev serves unminified) or as a percentage (`oklch(74.6% .16 232.661)`,
 *  what the production CSS minifier rewrites it to) — both are valid oklch()
 *  syntax, so the regex has to accept the optional `%` and rescale. */
export function resolveCSSColor(varName: string, overrides?: Record<string, string>): string {
	const raw = readCSSVar(varName, overrides);
	const m = raw.match(/^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+([\d.]+)/);
	if (m) {
		const l = parseFloat(m[1]) / (m[2] ? 100 : 1);
		return oklchToRgb(l, parseFloat(m[3]), parseFloat(m[4]));
	}
	// Not an oklch() triple — either a plain color (hex/rgb/hsl, e.g. from a
	// pasted workspace brand theme) or empty; pass through as-is either way.
	return raw;
}

/** Resolves a CSS length custom property (e.g. `--radius`) to pixels. */
export function resolveCSSLengthPx(varName: string): number {
	const raw = readCSSVar(varName);
	if (!raw) return 6;
	if (raw.endsWith('px')) return parseFloat(raw);
	if (raw.endsWith('rem')) {
		const rootPx = isBrowser ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 16;
		return parseFloat(raw) * rootPx;
	}
	if (!isBrowser) return 6;
	const probe = document.createElement('div');
	probe.style.cssText = `position:absolute;visibility:hidden;width:${raw}`;
	document.body.appendChild(probe);
	const px = probe.getBoundingClientRect().width;
	probe.remove();
	return px;
}

/** Reads a CSS font-family stack from a custom property. */
export function resolveCSSFontFamily(varName: string): string {
	return readCSSVar(varName);
}

export const CHART_COLORWAY_VARS = [
	'--chart-1',
	'--chart-2',
	'--chart-3',
	'--chart-4',
	'--chart-5'
];

/** The app's default series color cycle, resolved to concrete colors —
 *  matches CHART_COLOR_RANGE in ChartView.svelte, for engines (like Plotly)
 *  that can't take live `var()` references for a colorway. */
export function resolveChartColorway(overrides?: Record<string, string>): string[] {
	return CHART_COLORWAY_VARS.map((v) => resolveCSSColor(v, overrides));
}

/** `var(--chart-N)` strings for discrete fill/stroke channels that *can* take
 *  a live CSS custom property reference (the browser resolves them at paint
 *  time, so they re-theme for free) — used by ChartView.svelte's series
 *  colors and by generated plot-cell code (see plot-defaults.ts) so both
 *  read the same token list instead of duplicating it. */
export const CHART_COLOR_VARS = CHART_COLORWAY_VARS.map((v) => `var(${v})`);

/** Move an sRGB color toward white by `amount` percent (0–100). */
export function rgbLighten(rgb: string, amount: number): string {
	const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
	if (!m) return rgb;
	const mix = (n: number) => Math.min(255, Math.round(n + (255 - n) * (amount / 100)));
	return `rgb(${mix(+m[1])},${mix(+m[2])},${mix(+m[3])})`;
}

/**
 * Mermaid's base theme darkens every `cScaleN` by 75 in dark mode (and kanban
 * darkens again). Pre-lighten so baked-in SVG styles end up near the target
 * surface color; {@link themeMermaidSvg} then pins the final tokens with CSS vars.
 */
export function compensateMermaidCScale(rgb: string, darkMode: boolean): string {
	return darkMode ? rgbLighten(rgb, 88) : rgbLighten(rgb, 32);
}
