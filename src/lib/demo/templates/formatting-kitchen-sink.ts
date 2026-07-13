import { SlidersHorizontal } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import { makeDemoCell, makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

const rows = [
	{ region: 'North', status: 'Active', revenue: 128400, orders: 214, completion: 86 },
	{ region: 'South', status: 'Watch', revenue: 94200, orders: 168, completion: 62 },
	{ region: 'West', status: 'Active', revenue: 151900, orders: 239, completion: 91 },
	{ region: 'East', status: 'Blocked', revenue: 73100, orders: 121, completion: 44 }
];

const summaryRows = [
	{
		revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
		orders: rows.reduce((sum, row) => sum + row.orders, 0),
		completion: Math.round(rows.reduce((sum, row) => sum + row.completion, 0) / rows.length),
		active_regions: rows.filter((row) => row.status === 'Active').length
	}
];

function buildRowsQuery(): string {
	const selects = rows
		.map(
			(row) =>
				`SELECT '${row.region}' AS region, '${row.status}' AS status, ${row.revenue} AS revenue, ${row.orders} AS orders, ${row.completion} AS completion`
		)
		.join('\nUNION ALL\n');
	return `${selects}\nORDER BY revenue DESC`;
}

function buildSummaryQuery(): string {
	return `SELECT
  SUM(revenue) AS revenue,
  SUM(orders) AS orders,
  ROUND(AVG(completion)) AS completion,
  SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active_regions
FROM format_rows`;
}

function build(): Notebook {
	const rowsCell: Cell = {
		...makeDemoCell(buildRowsQuery(), 'format_rows', 'sql'),
		status: 'success',
		result: {
			rows,
			columns: ['region', 'status', 'revenue', 'orders', 'completion']
		},
		resultViewMode: 'table',
		display: 'collapsed'
	};

	const summaryCell: Cell = {
		...makeDemoCell(buildSummaryQuery(), 'format_summary', 'sql'),
		status: 'success',
		result: {
			rows: summaryRows,
			columns: ['revenue', 'orders', 'completion', 'active_regions']
		},
		resultViewMode: 'stats',
		display: 'collapsed'
	};

	const markdown = `# Formatting kitchen sink

{% toc /%}

This notebook is a visual QA fixture for every slash-inserted block. It should look consistent in the visual editor, report preview, and static export.

{% badge value="QA fixture" color="info" /%}
{% badge value="Seeded data" color="success" /%}

## Heading scale

# Heading 1: report title
## Heading 2: section title
### Heading 3: subsection title
#### Heading 4: nested subsection
##### Heading 5: compact label
###### Heading 6: smallest label

Regular prose should keep a comfortable measure. This paragraph includes **bold text**, _italic text_, ~~deleted text~~, \`inline_code\`, and [a local link](#formatting-kitchen-sink).

> Blockquotes need to look intentional, compact, and readable. They should not collapse into plain muted italics.

---

## Lists and table

- Bullet item with a short label
- Bullet item with a longer sentence that wraps across lines to test indentation and line height

1. Numbered item
2. Another numbered item

- [ ] Unchecked task
- [x] Checked task

| Region | Status | Revenue |
| --- | --- | ---: |
| North | Active | 128400 |
| South | Watch | 94200 |

## Code, media, and math

\`\`\`sql
SELECT region, SUM(revenue) AS revenue
FROM format_rows
GROUP BY region
ORDER BY revenue DESC;
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Slash command] --> B[Visual editor]
  B --> C[Report preview]
  C --> D[Static export]
\`\`\`

![Lunapad logo](/img/logo.svg)

{% bookmark url="https://example.com/lunapad" title="Bookmark card" description="Link previews should use the same compact panel rhythm." /%}
{% embed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" /%}
{% video src="/img/logo.svg" muted=true /%}
{% math latex="E = mc^2" display=true /%}

## Data widgets

{% grid cols=4 gap="compact" %}
{% metric value=$format_summary.revenue label="Revenue" format="currency" accent="info" /%}
{% metric value=$format_summary.orders label="Orders" format="number" accent="success" /%}
{% metric value=$format_summary.completion label="Completion" format="percent" accent="warning" /%}
{% metric value=$format_summary.active_regions label="Active regions" accent="neutral" /%}
{% /grid %}

{% progress value=$format_summary.completion max=100 label="Average completion" color="success" /%}

{% chart type="bar" data=$format_rows.rows x="region" y="revenue" title="Revenue by region" height=220 /%}

{% datatable data=$format_rows.rows cols=["region","status","revenue","orders","completion"] limit=4 /%}

{% filter kind="dropdown" param="region" label="Region" options=["North","South","West","East"] /%}

## Callouts and cards

{% callout type="info" title="Info callout" %}
Compact informational callout with body copy.
{% /callout %}

{% callout type="success" title="Success callout" %}
Success state should share the same padding and title rhythm.
{% /callout %}

{% callout type="warning" title="Warning callout" %}
Warning state should not feel larger than the surrounding prose.
{% /callout %}

{% callout type="error" title="Error callout" %}
Error state keeps the same structure and density.
{% /callout %}

{% grid cols=2 %}
{% card title="Neutral card" %}
Cards should feel related to callouts without becoming nested-looking panels.
{% /card %}
{% card title="Warning card" accent="warning" %}
Accented cards use tone without side stripes.
{% /card %}
{% /grid %}

## Containers

{% columns gap="default" %}
{% column %}
### Column A
Column content with a metric below.
{% metric value=$format_summary.orders label="Column metric" layout="row" /%}
{% /column %}
{% column %}
### Column B
Column content with a badge below.
{% badge value="Aligned" color="success" /%}
{% /column %}
{% /columns %}

{% details summary="Details block" open=true %}
The details body should use the same panel spacing as cards and callouts.
{% /details %}

{% tabs %}
{% tab label="Overview" %}
Tabs should have compact triggers and a readable panel.
{% /tab %}
{% tab label="Rows" %}
{% datatable data=$format_rows.rows limit=2 /%}
{% /tab %}
{% /tabs %}

## Logic blocks

{% if gt($format_rows.count, 0) %}
{% callout type="success" title="Conditional branch" %}
The if branch renders because the fixture has rows.
{% /callout %}
{% else /%}
{% callout type="warning" title="Fallback branch" %}
This branch should remain editable in the visual editor.
{% /callout %}
{% /if %}

{% group data=$format_rows.rows by="status" %}
{% card title="$group" %}
{% each data=$items %}
- $region: $revenue revenue, $orders orders
{% /each %}
{% /card %}
{% /group %}

## Query and report presets

The two collapsed query cells above exercise query insertion. The sections below mirror the summary, filtered, grouped, and tabbed report presets so the fixture covers their rendered shapes in one place.`;

	const cells: Cell[] = [
		rowsCell,
		summaryCell,
		{ ...makeDemoMarkdownCell(markdown), display: 'output' }
	];

	return {
		id: makeDemoId(),
		name: 'Formatting Kitchen Sink',
		folderId: null,
		cells,
		defaultCellLanguage: 'sql',
		filters: {}
	};
}

export const formattingKitchenSinkTemplate: DashboardTemplate = {
	id: 'formatting-kitchen-sink',
	name: 'Formatting Kitchen Sink',
	description: 'QA notebook for every slash command, Markdown primitive, and Markdoc component.',
	category: 'starters',
	icon: SlidersHorizontal,
	build
};
