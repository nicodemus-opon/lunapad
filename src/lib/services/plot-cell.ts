import type { Cell } from '$lib/stores/notebook.svelte';
import type { Data, Layout } from 'plotly.js-dist-min';

export interface PlotCellScope {
	[outputName: string]: { rows: Record<string, unknown>[]; columns: string[] };
}

export interface PlotCellFigure {
	data: Data[];
	layout: Partial<Layout>;
}

export interface PlotCellResult {
	figure: PlotCellFigure | null;
	error: string | null;
}

/** Builds the sandbox scope a plot cell's code runs against: one global per
 *  resolved upstream dependency, named after its outputName. Same shape as the
 *  `rows`/`columns` pair query cells already expose, just keyed by name so a
 *  plot can reference several upstream cells at once. */
export function buildPlotScope(deps: Cell[]): PlotCellScope {
	const scope: PlotCellScope = {};
	for (const dep of deps) {
		scope[dep.outputName] = { rows: dep.result?.rows ?? [], columns: dep.result?.columns ?? [] };
	}
	return scope;
}

function asFigure(result: unknown): PlotCellFigure {
	if (
		result === null ||
		typeof result !== 'object' ||
		!Array.isArray((result as { data?: unknown }).data)
	) {
		throw new Error('code must return a Plotly figure object: { data: [...], layout: {...} }');
	}
	const fig = result as { data: unknown[]; layout?: unknown };
	return { data: fig.data as Data[], layout: (fig.layout as Partial<Layout>) ?? {} };
}

/** Runs a plot cell's JS against its resolved dependency scope and returns the
 *  Plotly figure it returns, or throws on a JS runtime error. The sandbox is a
 *  real function body (via `new Function`), not a REPL, so the figure has to
 *  be explicitly `return`ed. Plotly figures are a plain `{data, layout}` POJO
 *  (no builder API/global needed, unlike Observable Plot) — the same shape
 *  PlotlyView.svelte already renders for Python-cell figures, so callers that
 *  want a graceful inline error instead of a thrown exception should use
 *  `evaluatePlotCell` below, which feeds straight into PlotlyMount. */
export function runPlotCode(code: string, scope: PlotCellScope): PlotCellFigure {
	const names = Object.keys(scope);
	const values = names.map((n) => scope[n]);
	// eslint-disable-next-line no-new-func
	const fn = new Function(...names, `'use strict'; ${code}`);
	const result = fn(...values);
	if (result === undefined) {
		// The single most common mistake here: writing `{ data: [...] }` as a
		// bare statement instead of `return { data: [...] }` — `new Function`
		// bodies need an explicit return, unlike a REPL or an arrow function's
		// expression body.
		throw new Error(
			'code did not return anything — did you forget `return`? e.g. `return { data: [...], layout: {...} }`'
		);
	}
	return asFigure(result);
}

/** UI-facing wrapper around `runPlotCode` — catches errors and returns them
 *  as a message instead of throwing, for use directly as PlotlyMount's
 *  `figure`/`errorText` props. */
export function evaluatePlotCell(code: string, scope: PlotCellScope): PlotCellResult {
	try {
		return { figure: runPlotCode(code, scope), error: null };
	} catch (e) {
		return { figure: null, error: e instanceof Error ? e.message : String(e) };
	}
}

/** Same sandbox/validation as `evaluatePlotCell`, but for the older `custom`
 *  chart-config code box (ChartConfigPanel.svelte) — a single result's fixed
 *  `rows`/`columns` globals instead of plot cells' by-name multi-cell scope. */
export function evaluateCustomChartCode(
	code: string,
	rows: Record<string, unknown>[],
	columns: string[]
): PlotCellResult {
	try {
		// eslint-disable-next-line no-new-func
		const fn = new Function('rows', 'columns', `'use strict'; ${code}`);
		const result = fn(rows, columns);
		if (result === undefined) {
			throw new Error(
				'code did not return anything — did you forget `return`? e.g. `return { data: [...], layout: {...} }`'
			);
		}
		return { figure: asFigure(result), error: null };
	} catch (e) {
		return { figure: null, error: e instanceof Error ? e.message : String(e) };
	}
}

/** Ambient TS declarations for a plot cell's sandbox globals, fed to Monaco's
 *  TypeScript service as a per-cell "extra lib" so referencing an upstream
 *  cell's outputName autocompletes `.rows`/`.columns`. See
 *  src/lib/monaco/plot-globals.ts for why only one cell's globals can be
 *  active at a time. */
export function buildSandboxGlobalsDts(deps: Cell[]): string {
	return deps
		.map(
			(d) =>
				`declare const ${d.outputName}: { rows: Record<string, unknown>[]; columns: string[] };`
		)
		.join('\n');
}

/** Sandbox-globals declarations for the older `custom` chart-config code box
 *  (ChartConfigPanel.svelte) — a single result's rows/columns, as opposed to
 *  plot cells' by-name multi-cell binding above. */
export const CUSTOM_CHART_GLOBALS_DTS = [
	'declare const rows: Record<string, unknown>[];',
	'declare const columns: string[];'
].join('\n');
