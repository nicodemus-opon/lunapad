# Markdoc widget reference

Every markdown cell renders through [Markdoc](https://markdoc.dev/). When a query cell runs, its `outputName` becomes a live variable (`$orders`, `$monthly`, etc.) that markdown cells can read. Shared reports use the same pipeline.

For the notebook workflow (preview, toolbar, chart inheritance), see [Results, charts, and dashboards](05-results-charts-dashboards.md). This page is the syntax reference.

## Variables from query cells

Only **query cells with results** publish variables. Markdown cells, Python cells, and cells that haven't run yet do not.

Given a query cell whose output name is `orders`:

| Expression         | Value                                      |
| ------------------ | ------------------------------------------ |
| `$orders.revenue`  | First row, `revenue` column                |
| `$orders.status`   | First row, any column name from the result |
| `$orders.rows`     | Full result set (array of row objects)     |
| `$orders.count`    | Row count                                  |
| `$orders.rowCount` | Same as `count`                            |
| `$orders.columns`  | Comma-separated column names               |

Column names from the first row are also available as `$orders.column_name` fields.

If you reference a cell that doesn't exist or hasn't been run, the editor shows a diagnostic and preview renders an error banner. Run upstream cells first.

## Live numbers in prose

Wrap values in `{% ... %}` so Markdoc evaluates them:

```
We processed {% $orders.count %} orders.
Revenue hit {% currency($orders.revenue) %} last month.
Peak month: {% formatDate($top.month, "MMM YYYY") %}.
```

`$orders.revenue` on its own in plain text is **not** evaluated. It is only live inside `{% %}` tags (prose) or tag attributes (`value=$orders.revenue` on a widget). The toolbar ref picker inserts `$cell.column` for attribute positions; wrap it yourself when writing sentences.

Format functions (`currency`, `compact`, `percent`, `sign`, `formatDate`) work inside those tags. Comparison functions (`gt`, `gte`, `lt`, `lte`) work inside `{% if %}` blocks.

Markdoc in Lunapad has **no arithmetic operators** and no `| round` pipe. If you need a ratio, percent of total, or rounded share, compute it in a query cell and reference the column:

```prql
# share
from totals
derive { pct_of_total = this_value * 100.0 / grand_total }
```

Then in markdown: `{% percent($share.pct_of_total, 1) %}`. The `percent()` function expects a 0–100 scale; it formats decimals and appends `%`, it does not multiply by 100.

## Conditionals

```
{% if gt($orders.count, 0) %}
  Has data.
{% else /%}
  No data yet.
{% /if %}
```

`{% else %}` must always be self-closing (`{% else /%}`). Chain extra branches as `{% else gt($x, 0) /%}`.

## Editor shortcuts

| Action               | How                                                                               |
| -------------------- | --------------------------------------------------------------------------------- |
| Insert `$cell.col`   | Toolbar ref picker, or type `$` and pick from completions (for widget attributes) |
| Inline in a sentence | Type `{% $cell.col %}` or `{% currency($cell.col) %}` manually                    |
| Insert a widget      | Type `/` at line start → metric, chart, callout, mermaid, …                       |
| Formatting           | Toolbar: bold, italic, link, heading levels                                       |
| Validate             | Errors underline in Monaco when `$` or `{%` is present                            |
| Preview              | Toggle preview on the cell                                                        |

## Widget tags

Widgets use `{% tagName ... /%}` for self-closing tags or `{% tagName %}...{% /tagName %}` for blocks. Inside tag attributes, pass data with `$cell.field` or `$cell.rows`.

### Format functions

Callable inside `{% ... %}` prose tags and as attribute values on widgets.

| Function                    | Signature                    | Example                   | Output                  |
| --------------------------- | ---------------------------- | ------------------------- | ----------------------- |
| `currency`                  | `currency(value)`            | `currency(42000)`         | `$42,000`               |
| `compact`                   | `compact(value)`             | `compact(1500000)`        | `1.5M`                  |
| `percent`                   | `percent(value, decimals)`   | `percent(75.25, 1)`       | `75.3%`                 |
| `sign`                      | `sign(value)`                | `sign(-12)`               | `-12`                   |
| `formatDate`                | `formatDate(value, pattern)` | `formatDate(d, "MMM DD")` | `Mar 05`                |
| `gt` / `gte` / `lt` / `lte` | `gt(a, b)`                   | -                         | boolean, for `{% if %}` |

`formatDate` pattern tokens: `YYYY`, `MMM` (3-letter month), `MM` (zero-padded month), `DD` (zero-padded day), `D` (day, no padding).

### `metric`: a single KPI

```
{% metric value=$orders.revenue label="Revenue" vs=$previous.revenue format="currency" /%}
```

| Attribute | Type             | Required | Default  | Notes                                                              |
| --------- | ---------------- | -------- | -------- | ------------------------------------------------------------------ |
| `value`   | number or string | yes      | -        | The headline number                                                |
| `label`   | string           | no       | -        | Caption shown under the value                                      |
| `vs`      | number or string | no       | -        | Comparison value; when set, shows a trend arrow and percent change |
| `format`  | string           | no       | `number` | One of `number`, `currency`, `compact`, `percent`                  |

### `chart`: any of the chart types

```
{% chart type="bar" data=$orders.rows x="month" y="revenue" /%}
```

| Attribute           | Type             | Notes                                                                                                                                                                                                                 |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`              | string           | One of `table`, `big-value`, `delta`, `value`, `line`, `bar`, `bar-horizontal`, `area`, `scatter`, `bubble`, `pie`, `histogram`, `heatmap`, `calendar-heatmap`, `funnel`, `box-plot`, `sankey`, `custom`, `sparkline` |
| `data`              | array            | Rows to chart, usually `$cell.rows`                                                                                                                                                                                   |
| `ref`               | object           | Alternative to `data`: pass `$cell` directly to also inherit a saved chart configuration from that cell                                                                                                               |
| `x`                 | string           | Column for the X axis                                                                                                                                                                                                 |
| `y`                 | string           | Column for a single Y series (shorthand for `yColumns=["..."]`)                                                                                                                                                       |
| `yColumns`          | array of strings | Multiple Y series                                                                                                                                                                                                     |
| `yColumnsSecondary` | array of strings | Y series on a secondary axis                                                                                                                                                                                          |
| `colorColumn`       | string           | Column used to color-split series or points                                                                                                                                                                           |
| `sizeColumn`        | string           | Column used for bubble/scatter point size                                                                                                                                                                             |
| `seriesMode`        | string           | `auto`, `grouped`, or `stacked`                                                                                                                                                                                       |
| `sortOrder`         | string           | `none`, `asc`, or `desc`, sorts by the X axis                                                                                                                                                                         |
| `histogramBins`     | number           | Bin count, histogram only                                                                                                                                                                                             |
| `title`             | string           | Chart title                                                                                                                                                                                                           |
| `height`            | number           | Pixels, default `280` (`sparkline` always renders at 60px regardless)                                                                                                                                                 |

### `datatable`: a result table

```
{% datatable data=$orders.rows cols=["id","customer","total"] limit=20 /%}
```

| Attribute | Type             | Required | Default     | Notes                                    |
| --------- | ---------------- | -------- | ----------- | ---------------------------------------- |
| `data`    | array            | yes      | -           | Rows to display                          |
| `cols`    | array of strings | no       | all columns | Which columns to show, in order          |
| `limit`   | number           | no       | `10`        | Rows shown before a "view all" expansion |

### `badge`: an inline status label

```
{% badge value="active" color="success" /%}
```

| Attribute | Type             | Required | Notes                                                                                                              |
| --------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `value`   | string or number | yes      | Text shown in the badge                                                                                            |
| `color`   | string           | no       | `info`, `success`, `warning`, `error`, or `neutral`. Left unset, color is derived consistently from the value text |

### `progress`: a progress bar

```
{% progress value=$job.completed max=100 label="Backfill" color="success" /%}
```

| Attribute | Type   | Required | Default | Notes                                 |
| --------- | ------ | -------- | ------- | ------------------------------------- |
| `value`   | number | yes      | -       | Current value, clamped to `0..max`    |
| `max`     | number | no       | `100`   | Scale                                 |
| `label`   | string | no       | -       | Caption above the bar                 |
| `color`   | string | no       | `info`  | `info`, `success`, `warning`, `error` |

### `filter`: a control that parameterizes upstream queries

```
{% filter kind="dropdown" param="region" label="Region" options=$regions.rows optionsColumn="name" /%}
```

| Attribute       | Type   | Required | Default    | Notes                                                                |
| --------------- | ------ | -------- | ---------- | -------------------------------------------------------------------- |
| `kind`          | string | no       | `dropdown` | `dropdown`, `text-input`, `date-range`, `button-group`               |
| `param`         | string | yes      | -          | The parameter name, used as `${param}` in query cells                |
| `label`         | string | no       | -          | Caption on the control                                               |
| `options`       | array  | no       | -          | Fixed list of values, or an array of rows (use with `optionsColumn`) |
| `optionsColumn` | string | no       | -          | When `options` is rows, which field to use as the option value       |
| `default`       | string | no       | -          | Initial value. When set, there's no "All" choice in a dropdown       |

A filter doesn't wrap or filter other widgets directly. Instead, give an upstream query cell a `${param}` placeholder:

```prql
from orders
filter region == "${region}"
```

Changing the filter control re-runs that query cell (and anything downstream of it) with the new value substituted in as raw text, so wrap it in quotes yourself for a string literal. Embedded single quotes in the value are escaped automatically.

### `details`: a collapsible section

```
{% details summary="Methodology" open=false %}
Anything can go in here: paragraphs, other widgets, lists.
{% /details %}
```

| Attribute | Type    | Required | Default |
| --------- | ------- | -------- | ------- |
| `summary` | string  | yes      | -       |
| `open`    | boolean | no       | `false` |

### `tabs` / `tab`: a tabbed group

```
{% tabs %}
  {% tab label="Summary" %}
    {% metric value=$total.revenue format="currency" /%}
  {% /tab %}
  {% tab label="By region" %}
    {% chart type="bar" data=$byRegion.rows x="region" y="revenue" /%}
  {% /tab %}
{% /tabs %}
```

`tabs` only accepts `tab` children. Each `tab` requires a `label` and can contain anything.

### `columns` / `column`: side-by-side layout

```
{% columns %}
  {% column width="300px" %}
    {% metric value=$daily.revenue label="Today" format="currency" /%}
  {% /column %}
  {% column %}
    {% chart type="line" data=$trend.rows x="day" y="revenue" /%}
  {% /column %}
{% /columns %}
```

`column` takes an optional `width` (pixels, a percentage string, or an `fr` unit). Columns with no width split the row evenly.

### `grid`: a multi-column grid

```
{% grid cols=2 %}
  {% card title="Q1" %}{% metric value=$q1.revenue format="currency" /%}{% /card %}
  {% card title="Q2" %}{% metric value=$q2.revenue format="currency" /%}{% /card %}
{% /grid %}
```

`cols` (number, default `3`) sets the column count. Children flow left to right, wrapping into new rows.

### `callout`: a colored note box

```
{% callout type="warning" %}
This can't be undone.
{% /callout %}
```

`type` (default `info`): `info`, `success`, `warning`, `error`.

### `card`: a bordered section

```
{% card title="Monthly summary" %}
  {% metric value=$monthly.revenue label="Revenue" format="currency" /%}
{% /card %}
```

`title` is optional; omit it for an untitled card.

### `mermaid`: diagrams (all Mermaid types)

Use `{% mermaid %}...{% /mermaid %}` for any [Mermaid](https://mermaid.js.org/) diagram type: flowchart, sequenceDiagram, stateDiagram-v2, erDiagram, gantt, pie, gitGraph, classDiagram, kanban, mindmap, timeline, and others.

Fenced ` ```mermaid ` blocks also render. They are the most reliable option for static diagrams. Only `{% mermaid %}` supports data-driven generation with `{% group %}` and `{% each %}` loop tags.

**Static:** source is preserved literally (newlines, YAML `---` frontmatter, `[*]` state nodes, etc.):

```
{% mermaid %}
---
title: Order flow
---
stateDiagram-v2
    [*] --> Still
    Still --> [*]
{% /mermaid %}
```

**Dynamic:** embed `{% group %}` and `{% each %}` inside the mermaid body. The expander slices your template from the original source and interpolates bare `$column` tokens, preserving whitespace and indentation exactly as written. That matters for mindmap, flowchart subgraphs, and sequence diagrams. Use `$keyId` for Mermaid ids when the grouped value contains spaces (`$keyId` is slugified; `$key` is the display value).

**Loop tag rules:** do not put blank lines _inside_ a `{% each %}` body (Markdoc treats them as block boundaries and breaks tag nesting). Put `{% /each %}` on the line immediately after the template row.

```
{% mermaid %}
kanban
  {% group data=$tasks.rows by="status" order=["Todo","In Progress","Review","Done"] %}
  $keyId[$key]
    {% each data=$items %}
    t$id[$title]@{ ticket: $ticket, priority: '$priority', assigned: '$assignee' }
    {% /each %}
  {% /group %}
{% /mermaid %}
```

Optional attribute: `code=$cell.field` to pass pre-built diagram text from a cell variable instead of a body.

### `group` / `each`: loop tags for diagram templates

Primarily used inside `{% mermaid %}`, but usable elsewhere.

**`{% group data=$rows by="column" order=[...] %}`** groups rows and exposes `$key`, `$keyId`, and `$items` in the body per group.

**`{% each data=$rows %}`** or **`{% each data=$items %}`** iterates rows and exposes all columns as `$col` in the body.

## Common mistakes

| Mistake                                           | What happens                  | Fix                                         |
| ------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| `$orders.revenue` in plain prose                  | Shows literally as text       | Use `{% $orders.revenue %}` or a widget tag |
| `{{orders.revenue}}` double-curly (old notebooks) | Shows literally as text       | Rewrite to `{% $orders.revenue %}`          |
| Hard-coded numbers in prose                       | Report goes stale             | Reference a query cell; lint may warn       |
| `{% else %}` without self-close                   | Parse error                   | Use `{% else /%}` always                    |
| `percent($x, 1)` on a 0–1 fraction                | Shows `0.5%` instead of `50%` | Multiply to 0–100 in SQL/PRQL first         |
| Arithmetic inside `{% metric %}`                  | Not supported                 | Compute in a query cell                     |
| Blank lines inside `{% each %}` in mermaid        | Broken tag nesting            | Keep the loop body contiguous               |
| Referenced cell not run                           | Error banner in preview       | Run upstream query cells                    |
| Complex static mermaid in `{% mermaid %}`         | Garbled diagram text          | Use a fenced ` ```mermaid ` block           |

## Full dashboard example

Query cells (run these first):

```prql
# orders — seed table
from orders
```

```prql
# monthly_revenue
from orders
derive { month = date_trunc("month", order_date) }
group month ( aggregate { total_revenue = sum amount } )
```

```prql
# region_performance
from orders
group region ( aggregate { total_revenue = sum amount, order_count = count this } )
```

Markdown cell:

```
## Revenue dashboard

{% badge value="Live" color="success" /%}

Month to date: **{% currency($monthly_revenue.total_revenue) %}** across {% $orders.count %} orders.

{% grid cols=2 %}
{% metric value=$monthly_revenue.total_revenue label="Revenue" format="currency" /%}
{% metric value=$region_performance.order_count label="Orders" /%}
{% /grid %}

{% chart type="bar" data=$region_performance.rows x="region" y="total_revenue" title="By region" /%}
```

Publish via **Share** or add the notebook to a [Site](09-sharing-and-reports.md).

## Next

[AI assistant](07-ai-assistant.md).
