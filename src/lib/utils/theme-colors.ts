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

/** Resolves a CSS custom property (e.g. `--chart-1`) on `:root` to a concrete
 *  color string — converts an `oklch(...)` value via oklchToRgb, passes
 *  anything else through unchanged.
 *
 *  Lightness may come back as a bare 0-1 fraction (`oklch(0.746 .16 232.661)`,
 *  what dev serves unminified) or as a percentage (`oklch(74.6% .16 232.661)`,
 *  what the production CSS minifier rewrites it to) — both are valid oklch()
 *  syntax, so the regex has to accept the optional `%` and rescale. */
export function resolveCSSColor(varName: string): string {
	const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
	const m = raw.match(/^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+([\d.]+)/);
	if (m) {
		const l = parseFloat(m[1]) / (m[2] ? 100 : 1);
		return oklchToRgb(l, parseFloat(m[3]), parseFloat(m[4]));
	}
	return raw;
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
export function resolveChartColorway(): string[] {
	return CHART_COLORWAY_VARS.map(resolveCSSColor);
}
