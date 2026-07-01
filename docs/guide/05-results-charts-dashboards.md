# Results, charts, and dashboards

## Reading results

Query results render as a sortable, paginated table right below the cell. Switch views with the tabs above the result:

| View  | What you get                                                               |
| ----- | -------------------------------------------------------------------------- |
| Table | Raw rows, column sort, pagination                                          |
| Chart | Configured visualization (see below)                                       |
| Stats | Per-column cards with completeness, distinct counts, top values, histograms, and data-quality hints |

Stats is the fast sanity check when you inherit a table you haven't profiled before. It profiles the rows currently loaded in the result (up to 1,000 when auto-limited). Wide tables use a column picker; flagged columns (high nulls, constants, likely IDs) surface first.

Click a column header in the table view to add a **column description**. Descriptions stick on the cell and show in a popover when you hover the header. Fill these in when someone else will read the report and won't know your naming conventions.

## Charts

Any result can be turned into a chart instead of a table. Pick a type based on what you're trying to show:

| Type                       | Use it for                                                    |
| -------------------------- | ------------------------------------------------------------- |
| Table                      | Raw rows, when a chart wouldn't add anything                  |
| KPI / Value / Delta        | A single number, optionally compared against a previous value |
| Line / Area                | A metric over time                                            |
| Bar / Horizontal bar       | Comparing a metric across categories                          |
| Scatter / Bubble           | Relationships between two (or three) numeric fields           |
| Pie                        | Share of a whole, for a small number of categories            |
| Histogram                  | Distribution of a single numeric column                       |
| Heatmap / Calendar heatmap | Density across two dimensions, or across days                 |
| Funnel                     | Drop-off across ordered stages                                |
| Box plot                   | Spread and outliers across groups                             |
| Sankey                     | Flow between categories                                       |
| Custom                     | Anything the above don't cover                                |

The chart configurator picks sensible defaults from your columns. Adjust axes, color grouping, stacking, sort order, and secondary Y series from the panel. Save the config on the cell; markdown widgets can inherit it with `ref=$cellName` (see [Markdoc reference](06-markdoc-reference.md)).

## Auto-suggested metrics

After a query runs, Lunapad inspects column types (numeric, date, boolean, text), null ratios, and distinct counts. It may suggest derived metrics: rates, ratios, time-bucketed rollups. Accept a suggestion to add a new downstream cell pre-filled with the expression. Treat it as a starting point; read the SQL before you ship it.

## Turning a notebook into a report or dashboard

Markdown cells embed live widgets: tables, charts, metrics, badges, progress bars, tabs, filters, all backed by query results in the same notebook.

The markdown editor is Monaco with a toolbar and `/` slash commands.

| You want                   | What to type                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A number inside a sentence | `{% $orders.revenue %}` or `{% currency($orders.revenue) %}`                                                                                |
| A KPI card                 | `/metric` or toolbar → inserts `{% metric value=$cell.value ... /%}`                                                                        |
| A chart                    | `/chart` or configure the query cell's chart view and use `ref=$cell` in markdown                                                           |
| Pick a cell column         | Toolbar **Insert ref** or type `$` for completions → inserts `$orders.revenue` for use in **tag attributes** (e.g. `value=$orders.revenue`) |

Toggle **preview** on the cell to see the rendered report. The editor underlines broken `$` refs and Markdoc parse errors before you publish.

Full syntax is in [Markdoc reference](06-markdoc-reference.md).

Mini example. Three query cells:

```prql
# daily
from orders
derive { day = date_trunc("day", created_at) }
group day ( aggregate { revenue = sum amount } )
```

```prql
# monthly
from orders
derive { month = date_trunc("month", created_at) }
group month ( aggregate { revenue = sum amount } )
```

```prql
# regions
from orders
group region ( aggregate { revenue = sum amount } )
```

One markdown cell:

```
## Revenue

{% metric value=$monthly.revenue label="This month" format="currency" /%}
{% chart type="line" data=$daily.rows x="day" y="revenue" /%}
{% chart type="bar" data=$regions.rows x="region" y="revenue" /%}
```

Run the query cells first. The markdown cell updates when their results change.

## Next

[The Markdoc reference](06-markdoc-reference.md) for the complete widget syntax, or [AI assistant](07-ai-assistant.md) if you want help building models.
