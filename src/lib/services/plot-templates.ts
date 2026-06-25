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
// ends with `return Plot.plot(...)` — the sandbox is a real function body
// (via `new Function`), not a REPL, so the value has to be explicitly
// returned or nothing renders.
export const PLOT_TEMPLATES: PlotTemplate[] = [
	{
		id: 'line',
		label: 'Line chart',
		description: 'Single series over a continuous or date x-axis.',
		code: `// Rename "data" to an upstream cell's output name
return Plot.plot({
  marks: [
    Plot.lineY(data.rows, { x: "date", y: "value", stroke: "var(--chart-1)" })
  ]
})
`
	},
	{
		id: 'multi-line',
		label: 'Multi-series line',
		description: 'Several lines, color-encoded by a category column.',
		code: `return Plot.plot({
  color: { legend: true },
  marks: [
    Plot.lineY(data.rows, { x: "date", y: "value", stroke: "category" })
  ]
})
`
	},
	{
		id: 'stacked-area',
		label: 'Stacked area',
		description: 'Cumulative contribution of each category over time.',
		code: `return Plot.plot({
  color: { legend: true },
  marks: [
    Plot.areaY(data.rows, Plot.stackY({ x: "date", y: "value", fill: "category" }))
  ]
})
`
	},
	{
		id: 'bar-sorted',
		label: 'Sorted bar (color-encoded)',
		description: 'Categorical bar chart sorted by value, colored by a second category.',
		code: `return Plot.plot({
  x: { tickRotate: -40 },
  color: { legend: true },
  marks: [
    Plot.barY(data.rows, Plot.sort("value", { x: "category", y: "value", fill: "group" })),
    Plot.ruleY([0])
  ]
})
`
	},
	{
		id: 'bar-horizontal',
		label: 'Horizontal bar (ranking)',
		description: 'Best for long category labels or top-N rankings.',
		code: `return Plot.plot({
  marginLeft: 120,
  marks: [
    Plot.barX(data.rows, Plot.sort({ y: "category" }, { x: "value", y: "category", fill: "var(--chart-1)" })),
    Plot.ruleX([0])
  ]
})
`
	},
	{
		id: 'scatter-regression',
		label: 'Scatter + regression',
		description: 'Correlation between two numeric columns with a fitted trend line.',
		code: `return Plot.plot({
  marks: [
    Plot.dot(data.rows, { x: "x_value", y: "y_value", fill: "var(--chart-1)", fillOpacity: 0.6 }),
    Plot.linearRegressionY(data.rows, { x: "x_value", y: "y_value", stroke: "var(--chart-2)" })
  ]
})
`
	},
	{
		id: 'small-multiples',
		label: 'Faceted small multiples',
		description: 'One mini-chart per category, sharing the same x/y scales.',
		code: `return Plot.plot({
  fx: { label: null },
  marks: [
    Plot.frame(),
    Plot.lineY(data.rows, { x: "date", y: "value", fx: "category", stroke: "var(--chart-1)" })
  ]
})
`
	},
	{
		id: 'reference-line',
		label: 'Bar chart with a reference line',
		description: 'Annotate a threshold/target on top of a bar or line chart.',
		code: `return Plot.plot({
  marks: [
    Plot.barY(data.rows, { x: "category", y: "value", fill: "var(--chart-1)" }),
    Plot.ruleY([0]),
    // Swap 100 for the actual threshold
    Plot.ruleY([100], { stroke: "var(--destructive)", strokeDasharray: "4,3" }),
    Plot.text([{ x: 0, y: 100, label: "Target" }], { x: "x", y: "y", dy: -8, text: "label" })
  ]
})
`
	},
	{
		id: 'calendar-heatmap',
		label: 'Calendar heatmap',
		description: 'Date × weekday grid colored by a numeric value, GitHub-contributions style.',
		code: `return Plot.plot({
  marginLeft: 40,
  color: { type: "linear", scheme: "blues" },
  marks: [
    Plot.cell(data.rows, {
      x: (d) => Math.floor((new Date(d.date).getTime()) / 6.048e8),
      y: (d) => new Date(d.date).getDay(),
      fill: "value"
    })
  ]
})
`
	},
	{
		id: 'box-plot',
		label: 'Box plot',
		description: 'Distribution comparison across a categorical axis.',
		code: `return Plot.plot({
  marks: [
    Plot.boxY(data.rows, { x: "category", y: "value", fill: "var(--chart-1)" })
  ]
})
`
	},
	{
		id: 'text-annotations',
		label: 'Annotated points',
		description: 'Scatter/line with text labels called out next to specific points.',
		code: `return Plot.plot({
  marks: [
    Plot.dot(data.rows, { x: "x_value", y: "y_value", fill: "var(--chart-1)" }),
    Plot.text(data.rows, { x: "x_value", y: "y_value", text: "label", dy: -10 })
  ]
})
`
	},
	{
		id: 'two-cell-overlay',
		label: 'Combine two upstream cells',
		description: 'Overlay marks from two different query cells in one plot.',
		code: `// Rename "series_a" and "series_b" to two upstream cells' output names
return Plot.plot({
  color: { legend: true },
  marks: [
    Plot.lineY(series_a.rows, { x: "date", y: "value", stroke: "var(--chart-1)" }),
    Plot.lineY(series_b.rows, { x: "date", y: "value", stroke: "var(--chart-2)" })
  ]
})
`
	},
	{
		id: 'histogram',
		label: 'Histogram',
		description: 'Distribution of a single numeric column.',
		code: `return Plot.plot({
  marks: [
    Plot.rectY(data.rows, Plot.binX({ y: "count" }, { x: "value", fill: "var(--chart-1)" })),
    Plot.ruleY([0])
  ]
})
`
	}
];
