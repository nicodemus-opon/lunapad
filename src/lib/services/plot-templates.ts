export interface PlotTemplate {
	id: string;
	label: string;
	description: string;
	code: string;
}

// Each snippet references a placeholder upstream-cell name (`data`,
// `series_a`/`series_b`) that the user renames to a real outputName from
// their notebook — see resolvePlotDataRefs in cell-deps.ts for how those
// names get resolved into {rows, columns} at evaluation time. Every snippet
// ends with `return { data: [...], layout: {...} }` — the sandbox is a real
// function body (via `new Function`), not a REPL, so the figure has to be
// explicitly returned. Series colors use `var(--chart-N)` strings, which
// Plotly (like any CSS consumer) resolves at paint time.
export const PLOT_TEMPLATES: PlotTemplate[] = [
	{
		id: 'line',
		label: 'Line chart',
		description: 'Single series over a continuous or date x-axis.',
		code: `// Rename "data" to an upstream cell's output name
return {
  data: [
    { type: "scatter", mode: "lines", x: data.rows.map(r => r.date), y: data.rows.map(r => r.value), line: { color: "var(--chart-1)" } }
  ],
  layout: {}
};
`
	},
	{
		id: 'multi-line',
		label: 'Multi-series line',
		description: 'Several lines, color-encoded by a category column.',
		code: `const groups = [...new Set(data.rows.map(r => r.category))];
return {
  data: groups.map((g, i) => ({
    type: "scatter", mode: "lines", name: g,
    x: data.rows.filter(r => r.category === g).map(r => r.date),
    y: data.rows.filter(r => r.category === g).map(r => r.value),
    line: { color: \`var(--chart-\${(i % 5) + 1})\` }
  })),
  layout: { showlegend: true }
};
`
	},
	{
		id: 'stacked-area',
		label: 'Stacked area',
		description: 'Cumulative contribution of each category over time.',
		code: `const groups = [...new Set(data.rows.map(r => r.category))];
return {
  data: groups.map((g, i) => ({
    type: "scatter", mode: "lines", name: g, stackgroup: "one", fill: "tonexty",
    x: data.rows.filter(r => r.category === g).map(r => r.date),
    y: data.rows.filter(r => r.category === g).map(r => r.value),
    line: { color: \`var(--chart-\${(i % 5) + 1})\` }
  })),
  layout: { showlegend: true }
};
`
	},
	{
		id: 'bar-sorted',
		label: 'Sorted bar (color-encoded)',
		description: 'Categorical bar chart sorted by value, colored by a second category.',
		code: `const groups = [...new Set(data.rows.map(r => r.group))];
const sorted = [...data.rows].sort((a, b) => b.value - a.value);
return {
  data: groups.map((g, i) => ({
    type: "bar", name: g,
    x: sorted.filter(r => r.group === g).map(r => r.category),
    y: sorted.filter(r => r.group === g).map(r => r.value),
    marker: { color: \`var(--chart-\${(i % 5) + 1})\` }
  })),
  layout: { xaxis: { tickangle: -40 }, showlegend: true }
};
`
	},
	{
		id: 'bar-horizontal',
		label: 'Horizontal bar (ranking)',
		description: 'Best for long category labels or top-N rankings.',
		code: `const sorted = [...data.rows].sort((a, b) => a.value - b.value);
return {
  data: [
    { type: "bar", orientation: "h", x: sorted.map(r => r.value), y: sorted.map(r => r.category), marker: { color: "var(--chart-1)" } }
  ],
  layout: { margin: { l: 120 } }
};
`
	},
	{
		id: 'scatter-regression',
		label: 'Scatter + regression',
		description: 'Correlation between two numeric columns with a fitted trend line.',
		code: `const xs = data.rows.map(r => r.x_value);
const ys = data.rows.map(r => r.y_value);
const n = xs.length;
const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0), sxx = xs.reduce((a, x) => a + x * x, 0);
const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
const intercept = (sy - slope * sx) / n;
const xMin = Math.min(...xs), xMax = Math.max(...xs);
return {
  data: [
    { type: "scatter", mode: "markers", x: xs, y: ys, marker: { color: "var(--chart-1)", opacity: 0.6 } },
    { type: "scatter", mode: "lines", x: [xMin, xMax], y: [slope * xMin + intercept, slope * xMax + intercept], line: { color: "var(--chart-2)" } }
  ],
  layout: { showlegend: false }
};
`
	},
	{
		id: 'small-multiples',
		label: 'Faceted small multiples',
		description: 'One mini-chart per category (up to 4), sharing a 2x2 grid.',
		code: `// Capped at 4 categories — Plotly has no auto-faceting, so each facet
// needs its own xaxis/yaxis slice of a fixed grid.
const groups = [...new Set(data.rows.map(r => r.category))].slice(0, 4);
return {
  data: groups.map((g, i) => ({
    type: "scatter", mode: "lines", name: g, xaxis: \`x\${i + 1}\`, yaxis: \`y\${i + 1}\`,
    x: data.rows.filter(r => r.category === g).map(r => r.date),
    y: data.rows.filter(r => r.category === g).map(r => r.value),
    line: { color: "var(--chart-1)" }
  })),
  layout: {
    grid: { rows: 2, columns: 2, pattern: "independent" },
    showlegend: false,
    annotations: groups.map((g, i) => ({
      text: g, xref: \`x\${i + 1} domain\`, yref: \`y\${i + 1} domain\`, x: 0.5, y: 1.1, showarrow: false
    }))
  }
};
`
	},
	{
		id: 'reference-line',
		label: 'Bar chart with a reference line',
		description: 'Annotate a threshold/target on top of a bar or line chart.',
		code: `return {
  data: [
    { type: "bar", x: data.rows.map(r => r.category), y: data.rows.map(r => r.value), marker: { color: "var(--chart-1)" } }
  ],
  layout: {
    // Swap 100 for the actual threshold
    shapes: [{ type: "line", x0: 0, x1: 1, xref: "paper", y0: 100, y1: 100, line: { color: "var(--destructive)", dash: "dash" } }],
    annotations: [{ x: 0, y: 100, xref: "x", yref: "y", text: "Target", showarrow: false, yshift: 10 }]
  }
};
`
	},
	{
		id: 'calendar-heatmap',
		label: 'Calendar heatmap',
		description: 'Date × weekday grid colored by a numeric value, GitHub-contributions style.',
		code: `const weekOf = (d) => Math.floor(new Date(d).getTime() / 6.048e8);
const dayOf = (d) => new Date(d).getDay();
return {
  data: [
    {
      type: "heatmap",
      x: data.rows.map(r => weekOf(r.date)),
      y: data.rows.map(r => dayOf(r.date)),
      z: data.rows.map(r => r.value),
      colorscale: "Blues"
    }
  ],
  layout: { margin: { l: 40 } }
};
`
	},
	{
		id: 'box-plot',
		label: 'Box plot',
		description: 'Distribution comparison across a categorical axis.',
		code: `return {
  data: [
    { type: "box", x: data.rows.map(r => r.category), y: data.rows.map(r => r.value), marker: { color: "var(--chart-1)" } }
  ],
  layout: {}
};
`
	},
	{
		id: 'text-annotations',
		label: 'Annotated points',
		description: 'Scatter/line with text labels called out next to specific points.',
		code: `return {
  data: [
    {
      type: "scatter", mode: "markers+text",
      x: data.rows.map(r => r.x_value), y: data.rows.map(r => r.y_value), text: data.rows.map(r => r.label),
      textposition: "top center", marker: { color: "var(--chart-1)" }
    }
  ],
  layout: {}
};
`
	},
	{
		id: 'two-cell-overlay',
		label: 'Combine two upstream cells',
		description: 'Overlay traces from two different query cells in one chart.',
		code: `// Rename "series_a" and "series_b" to two upstream cells' output names
return {
  data: [
    { type: "scatter", mode: "lines", name: "Series A", x: series_a.rows.map(r => r.date), y: series_a.rows.map(r => r.value), line: { color: "var(--chart-1)" } },
    { type: "scatter", mode: "lines", name: "Series B", x: series_b.rows.map(r => r.date), y: series_b.rows.map(r => r.value), line: { color: "var(--chart-2)" } }
  ],
  layout: { showlegend: true }
};
`
	},
	{
		id: 'histogram',
		label: 'Histogram',
		description: 'Distribution of a single numeric column.',
		code: `return {
  data: [
    { type: "histogram", x: data.rows.map(r => r.value), marker: { color: "var(--chart-1)" } }
  ],
  layout: {}
};
`
	}
];
