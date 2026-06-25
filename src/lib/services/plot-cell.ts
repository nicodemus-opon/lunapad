import * as Plot from '@observablehq/plot';
import type { Cell } from '$lib/stores/notebook.svelte';

export interface PlotCellScope {
	[outputName: string]: { rows: Record<string, unknown>[]; columns: string[] };
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

/** Runs a plot cell's JS against its resolved dependency scope and returns the
 *  rendered element, or throws on a JS runtime error — the same
 *  `new Function(...)` sandbox pattern ChartView.svelte's `custom` chart type
 *  already uses for its (fixed rows/columns) sandbox, generalized here to N
 *  dynamic globals, one per upstream cell referenced by name. Callers that
 *  want a graceful inline error instead of a thrown exception should use
 *  `evaluatePlotCell` below. */
export function runPlotCode(
	code: string,
	scope: PlotCellScope,
	width: number,
	height: number
): Element {
	const names = Object.keys(scope);
	const values = names.map((n) => scope[n]);
	// eslint-disable-next-line no-new-func
	const fn = new Function(...names, 'Plot', 'width', 'height', `'use strict'; ${code}`);
	const result = fn(...values, Plot, width, height);
	if (result === undefined) {
		// The single most common mistake here: writing `Plot.plot({...})` as a
		// bare statement instead of `return Plot.plot({...})` — `new Function`
		// bodies need an explicit return, unlike a REPL or an arrow function's
		// expression body. Plot.plot(undefined) would otherwise render a blank
		// plot with no error, which is a much more confusing failure mode.
		throw new Error(
			'code did not return anything — did you forget `return` before Plot.plot(...)?'
		);
	}
	return result instanceof Element ? result : Plot.plot(result);
}

/** UI-facing wrapper around `runPlotCode` — catches errors and renders them as
 *  an inline message instead of throwing, for use directly as a PlotChart
 *  `render` function. */
export function evaluatePlotCell(
	code: string,
	scope: PlotCellScope,
	width: number,
	height: number
): Element {
	try {
		return runPlotCode(code, scope, width, height);
	} catch (e) {
		const div = document.createElement('div');
		div.className = 'text-sm text-destructive p-4 whitespace-pre-wrap';
		div.textContent = `Plot spec error: ${e instanceof Error ? e.message : String(e)}`;
		return div;
	}
}

/** Ambient TS declarations for a plot cell's sandbox globals, fed to Monaco's
 *  TypeScript service as a per-cell "extra lib" so referencing an upstream
 *  cell's outputName autocompletes `.rows`/`.columns`. See
 *  src/lib/monaco/plot-globals.ts for why only one cell's globals can be
 *  active at a time. */
export function buildSandboxGlobalsDts(deps: Cell[]): string {
	const decls = deps.map(
		(d) => `declare const ${d.outputName}: { rows: Record<string, unknown>[]; columns: string[] };`
	);
	decls.push('declare const width: number;', 'declare const height: number;');
	return decls.join('\n');
}

/** Sandbox-globals declarations for the older `custom` chart-config code box
 *  (ChartConfigPanel.svelte) — a single result's rows/columns/width/height,
 *  as opposed to plot cells' by-name multi-cell binding above. */
export const CUSTOM_CHART_GLOBALS_DTS = [
	'declare const rows: Record<string, unknown>[];',
	'declare const columns: string[];',
	'declare const width: number;',
	'declare const height: number;'
].join('\n');
