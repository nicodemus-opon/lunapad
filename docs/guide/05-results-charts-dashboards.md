# Results, charts, and dashboards

## Reading results

Query results render as a sortable, paginated table right below the cell. For a deeper look at a dataset, switch to the stats view: per-column null ratios, distinct counts, and value distributions, useful for sanity-checking a table you haven't worked with before.

## Charts

Any result can be turned into a chart instead of a table. Pick a type based on what you're trying to show:

| Type | Use it for |
|---|---|
| Table | Raw rows, when a chart wouldn't add anything |
| KPI / Value / Delta | A single number, optionally compared against a previous value |
| Line / Area | A metric over time |
| Bar / Horizontal bar | Comparing a metric across categories |
| Scatter / Bubble | Relationships between two (or three) numeric fields |
| Pie | Share of a whole, for a small number of categories |
| Histogram | Distribution of a single numeric column |
| Heatmap / Calendar heatmap | Density across two dimensions, or across days |
| Funnel | Drop-off across ordered stages |
| Box plot | Spread and outliers across groups |
| Sankey | Flow between categories |
| Custom | Anything the above don't cover |

Charts pick up sensible defaults from the result columns and can be adjusted from there, axes, color grouping, stacking, sort order.

## Auto-suggested metrics

Lunapad looks at a result's columns, numeric, date, boolean, text, null ratio, distinct count, and suggests metrics that might be worth deriving: rates, ratios, time-bucketed rollups, and similar, as a starting point rather than something you have to think up from scratch.

## Turning a notebook into a report or dashboard

Markdown cells aren't just static prose. They can embed live widgets, tables, charts, single metrics, badges, progress bars, tabs, filters, all backed by the actual query results in the notebook. A markdown cell like this:

```
## Revenue this month

{% metric value=$monthly.revenue label="Revenue" format="currency" /%}
{% chart type="line" data=$daily.rows x="date" y="revenue" /%}
```

renders as a live KPI and chart pulled straight from the `monthly` and `daily` query cells. Combine several of these in one notebook and you have a dashboard, built out of the same cells you'd use for any other query.

The full widget syntax, every tag and every attribute, is in [the Markdoc reference](06-markdoc-reference.md).

## Next

[The Markdoc reference](06-markdoc-reference.md) for the complete widget syntax, or skip ahead to [AI assistant](07-ai-assistant.md).
