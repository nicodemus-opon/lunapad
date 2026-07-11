import type { Cell } from '$lib/stores/notebook.svelte';
import type { ChartConfig, ChartType } from '$lib/types/gui-pipeline';
import { inferSmartChartConfig, inferSmartChartConfigForType } from '$lib/utils';
import { CHART_COLOR_VARS } from '$lib/utils/theme-colors';
import { isChartableSourceCell } from '$lib/services/cell-deps';

export type PlotStarterKind = 'auto' | 'bar' | 'line' | 'scatter' | 'pie' | 'area';

const KIND_TO_CHART_TYPE: Record<Exclude<PlotStarterKind, 'auto'>, ChartType> = {
	bar: 'bar',
	line: 'line',
	scatter: 'scatter',
	pie: 'pie',
	area: 'area'
};

/** Nearest preceding query/python cell with a non-empty outputName — mirrors
 *  the scan resolvePlotDataRefs does in cell-deps.ts, just returns the
 *  closest one instead of every cell referenced by name in existing code. */
export function findPlotSourceCell(cells: Cell[], beforeIdx: number): Cell | null {
	for (let i = beforeIdx - 1; i >= 0; i--) {
		const c = cells[i];
		if (isChartableSourceCell(c)) return c;
	}
	return null;
}

export interface PlotDefaults {
	plotMode: 'gui' | 'code';
	plotConfig: ChartConfig | null;
	plotSourceCellId: string | null;
	code: string;
}

const NO_SOURCE_SAMPLE_CODE = `// No upstream cell to chart yet — reference one by outputName, e.g. my_query.rows
const category = ['A', 'B', 'C', 'D'];
const value = [24, 13, 42, 8];
return {
  data: [{ type: 'bar', x: category, y: value, marker: { color: 'var(--chart-1)' } }],
  layout: {}
};
`;

function dynamicSourceCode(source: Cell): string {
	const name = source.outputName;
	return `// ${name} hasn't run yet — this reads its columns/rows dynamically so the
// chart is correct whenever it eventually does run.
const cols = ${name}.columns.length ? ${name}.columns : Object.keys(${name}.rows[0] ?? {});
const xKey = cols[0];
const yKey = cols.find((c) => typeof ${name}.rows[0]?.[c] === 'number') ?? cols[1] ?? cols[0];
return {
  data: [
    {
      type: 'bar',
      x: ${name}.rows.map((r) => r[xKey]),
      y: ${name}.rows.map((r) => r[yKey]),
      marker: { color: 'var(--chart-1)' }
    }
  ],
  layout: {}
};
`;
}

/**
 * Sane defaults for a freshly-created plot cell. Prefers the GUI builder
 * (reusing the same inferSmartChartConfig(ForType) heuristic the query-cell
 * chart view already uses) whenever there's a source cell with actual result
 * rows to configure against; falls back to a working code-mode sample
 * otherwise, so a new plot cell never renders blank.
 */
export function buildPlotDefaults(
	source: Cell | null,
	kind: PlotStarterKind = 'auto'
): PlotDefaults {
	if (!source) {
		return {
			plotMode: 'code',
			plotConfig: null,
			plotSourceCellId: null,
			code: NO_SOURCE_SAMPLE_CODE
		};
	}
	const rows = source.result?.rows ?? [];
	const columns = source.result?.columns ?? [];
	if (rows.length === 0) {
		return {
			plotMode: 'code',
			plotConfig: null,
			plotSourceCellId: null,
			code: dynamicSourceCode(source)
		};
	}
	const config =
		kind === 'auto'
			? inferSmartChartConfig(columns, rows)
			: inferSmartChartConfigForType(columns, rows, KIND_TO_CHART_TYPE[kind]);
	return { plotMode: 'gui', plotConfig: config, plotSourceCellId: source.id, code: '' };
}

interface TraceSpec {
	plotlyType: string;
	mode?: string;
	fill?: string;
}

// Chart types this codegen can faithfully translate into a literal Plotly
// trace. Anything else (table/big-value/delta/value/map/choropleth/sankey/
// box-plot/calendar-heatmap/funnel/custom) falls back to a plain bar chart of
// the config's x/first-y below, with a comment noting the eject was partial —
// same "best effort, human cleans up the rest" spirit as gui-prql.ts's
// RawStage catch-all for PRQL it can't parse into GUI stages.
const CHART_TYPE_TRACE: Partial<Record<ChartType, TraceSpec>> = {
	bar: { plotlyType: 'bar' },
	'bar-horizontal': { plotlyType: 'bar' },
	line: { plotlyType: 'scatter', mode: 'lines' },
	area: { plotlyType: 'scatter', mode: 'lines', fill: 'tozeroy' },
	scatter: { plotlyType: 'scatter', mode: 'markers' },
	bubble: { plotlyType: 'scatter', mode: 'markers' },
	histogram: { plotlyType: 'histogram' },
	pie: { plotlyType: 'pie' }
};

function jsStringArray(values: string[]): string {
	return `[${values.map((v) => JSON.stringify(v)).join(', ')}]`;
}

/**
 * One-way "eject" from a GUI-mode plot cell's ChartConfig into equivalent,
 * editable freeform Plotly JS — same asymmetry as gui-prql.ts's RawStage: a
 * GUI config can always be turned into code, but arbitrary code can't
 * reliably be turned back into a config. Colors always come from the app's
 * theme (CHART_COLOR_VARS), never hardcoded hex, matching buildPlotDefaults
 * and ChartView.svelte.
 */
export function chartConfigToPlotCode(config: ChartConfig, sourceOutputName: string): string {
	const name = sourceOutputName;
	const spec = CHART_TYPE_TRACE[config.chartType];

	if (!spec || !config.xColumn || config.yColumns.length === 0) {
		const xCol = config.xColumn || '';
		const yCol = config.yColumns[0] || '';
		return `// ${config.chartType} couldn't be fully translated to code — kept the
// closest bar-chart equivalent of your config's columns. Tweak as needed.
return {
  data: [
    {
      type: 'bar',
      x: ${name}.rows.map((r) => r[${JSON.stringify(xCol)}]),
      y: ${name}.rows.map((r) => r[${JSON.stringify(yCol)}]),
      marker: { color: 'var(--chart-1)' }
    }
  ],
  layout: {}
};
`;
	}

	if (config.chartType === 'pie') {
		const yCol = config.yColumns[0];
		return `return {
  data: [
    {
      type: 'pie',
      labels: ${name}.rows.map((r) => r[${JSON.stringify(config.xColumn)}]),
      values: ${name}.rows.map((r) => r[${JSON.stringify(yCol)}]),
      marker: { colors: ${jsStringArray(CHART_COLOR_VARS)} }
    }
  ],
  layout: {}
};
`;
	}

	if (config.chartType === 'histogram') {
		return `return {
  data: [
    {
      type: 'histogram',
      x: ${name}.rows.map((r) => r[${JSON.stringify(config.xColumn)}]),
      marker: { color: 'var(--chart-1)' }
    }
  ],
  layout: {}
};
`;
	}

	const traceExtras: string[] = [];
	if (spec.mode) traceExtras.push(`mode: ${JSON.stringify(spec.mode)}`);
	if (spec.fill) traceExtras.push(`fill: ${JSON.stringify(spec.fill)}`);
	const horizontal = config.chartType === 'bar-horizontal';
	if (horizontal) traceExtras.push(`orientation: 'h'`);

	const traces = config.yColumns
		.map((yCol, i) => {
			const color = CHART_COLOR_VARS[i % CHART_COLOR_VARS.length];
			const xExpr = `${name}.rows.map((r) => r[${JSON.stringify(config.xColumn)}])`;
			const yExpr = `${name}.rows.map((r) => r[${JSON.stringify(yCol)}])`;
			const colorField = spec.plotlyType === 'bar' ? 'marker' : 'line';
			return `    {
      type: ${JSON.stringify(spec.plotlyType)},
      ${horizontal ? `x: ${yExpr},\n      y: ${xExpr}` : `x: ${xExpr},\n      y: ${yExpr}`},
      name: ${JSON.stringify(yCol)},
      ${colorField}: { color: ${JSON.stringify(color)} }${traceExtras.length ? `,\n      ${traceExtras.join(',\n      ')}` : ''}
    }`;
		})
		.join(',\n');

	return `return {
  data: [
${traces}
  ],
  layout: {}
};
`;
}
