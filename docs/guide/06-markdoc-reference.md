# Markdoc widget reference

Complete syntax for every widget you can embed in a markdown cell. For the concept and why you'd use these, see [Results, charts, and dashboards](05-results-charts-dashboards.md).

There are two separate syntaxes, and they don't mix:

- **Legacy inline refs**, `{{ }}`, available in any markdown cell. Good for dropping a single live number into a sentence.
- **Markdoc tags**, `{% %}`, available once a markdown cell contains at least one `{%`. Good for charts, tables, and layout.

A markdown cell that contains `{%` switches entirely to the Markdoc renderer; one that doesn't, keeps using the legacy `{{ }}` renderer. Don't mix the two in the same cell.

## Legacy inline refs: `{{ }}`

```
{{outputName.count}}              row count
{{outputName.rowCount}}           row count (alias)
{{outputName.columns}}            comma-separated column names
{{outputName.columnName}}         first row, named column
{{outputName[N].columnName}}      Nth row (negative indexes count from the end), named column
{{outputName.columnName[N]}}      same, column-first order
{{expr | round(N)}}               arithmetic expression, rounded to N decimals
{{currency(outputName.field)}}    any format function (see below), called directly
```

Examples:

```
Total orders: {{orders.count}}
Second row's revenue: {{orders[1].revenue}}
Last row: {{orders[-1].month}}
Share of total: {{(subset.value * 100 / total.value) | round(1)}}%
Formatted: {{currency(sales.total)}}
```

Arithmetic (`+ - * /`) and the `| round(N)` filter only work here, in `{{ }}`, not inside `{% %}` tags.

**Errors render inline instead of failing the whole cell:**

| Situation                                         | Renders as          |
| ------------------------------------------------- | ------------------- |
| Referenced cell hasn't been run, or doesn't exist | `[⚡ name not run]` |
| Row index out of range                            | `[row N missing]`   |
| Column doesn't exist on that row                  | `[key not found]`   |

## Markdoc tags: `{% %}`

Inside `{% %}`, a cell's data is available as a variable, `$outputName`, not as `{{ }}`. There is no arithmetic and no pipe operator here, only variables, attribute values, and function calls:

```
$outputName.count        row count
$outputName.rowCount     row count (alias)
$outputName.columns      comma-separated column names
$outputName.rows         full result set, as an array of row objects
$outputName.fieldName    first row's value for that column
```

Conditionals use the comparison functions below:

```
{% if gt($orders.count, 0) %}
  Has data.
{% else /%}
  No data yet.
{% /if %}
```

`{% else %}` must always be self-closing (`{% else /%}`), even when it isn't the last branch, chain additional conditions as `{% else <condition> /%}`.

### Format functions

Usable both inside `{% %}` tags and inside legacy `{{ }}` refs.

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

Use `{% mermaid %}...{% /mermaid %}` for any [Mermaid](https://mermaid.js.org/) diagram — flowchart, sequenceDiagram, stateDiagram-v2, erDiagram, gantt, pie, gitGraph, classDiagram, kanban, mindmap, timeline, and more. Fenced ` ```mermaid ` blocks also render, but only `{% mermaid %}` supports data-driven generation with loop tags.

**Static** — source is preserved literally (newlines, YAML `---` frontmatter, `[*]` state nodes, etc.):

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

**Dynamic** — embed `{% group %}` / `{% each %}` inside the mermaid body. The expander slices your template from the original source and interpolates bare `$column` tokens, **preserving whitespace and indentation exactly as written** — critical for mindmap, flowchart subgraphs, sequence diagrams, etc. Use `$keyId` for Mermaid ids when the grouped value contains spaces (`$keyId` is slugified; `$key` is the display value).

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

**`{% group data=$rows by="column" order=[...] %}`** — groups rows; exposes `$key`, `$keyId`, and `$items` in the body per group.

**`{% each data=$rows %}`** or **`{% each data=$items %}`** — iterates rows; exposes all columns as `$col` in the body.

## Next

[AI assistant](07-ai-assistant.md).
