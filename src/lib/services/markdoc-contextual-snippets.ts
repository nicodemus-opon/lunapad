import type { MarkdownRefColumn, MarkdownRefEntry } from '$lib/services/markdoc-catalog';
import { WIDGET_SNIPPETS } from '$lib/services/markdoc-snippets';

const NUMERIC_TYPE_RE = /int|float|double|decimal|numeric|number|real|bigint|smallint|tinyint/i;
const TEXT_TYPE_RE = /char|text|string|uuid|date|time|bool|category|enum/i;

export function getUsableMarkdocRefEntry(entries: MarkdownRefEntry[]): MarkdownRefEntry | null {
	return (
		entries.find(
			(entry) => entry.cellName && entry.columns.length > 0 && (entry.rowCount ?? 1) > 0
		) ?? null
	);
}

function rowRef(entry: MarkdownRefEntry | null): string {
	return entry ? `$${entry.cellName}.rows` : '$cell.rows';
}

function cellRef(entry: MarkdownRefEntry | null): string {
	return entry ? `$${entry.cellName}` : '$cell';
}

function columnName(col: MarkdownRefColumn | undefined, fallback: string): string {
	return col?.name || fallback;
}

function looksNumeric(col: MarkdownRefColumn | undefined): boolean {
	return Boolean(col?.type && NUMERIC_TYPE_RE.test(col.type));
}

function looksText(col: MarkdownRefColumn | undefined): boolean {
	return Boolean(!col?.type || TEXT_TYPE_RE.test(col.type));
}

function dimensionColumn(entry: MarkdownRefEntry | null): string {
	const found = entry?.columns.find((col) => looksText(col));
	return columnName(found ?? entry?.columns[0], 'category');
}

function metricColumn(entry: MarkdownRefEntry | null): string {
	const found = entry?.columns.find((col) => looksNumeric(col));
	return columnName(found ?? entry?.columns[1] ?? entry?.columns[0], 'value');
}

function detailColumn(entry: MarkdownRefEntry | null): string {
	const dimension = dimensionColumn(entry);
	const metric = metricColumn(entry);
	const found = entry?.columns.find((col) => col.name !== dimension && col.name !== metric);
	return columnName(found ?? entry?.columns[2] ?? entry?.columns[0], 'detail');
}

function refField(entry: MarkdownRefEntry | null, col: string): string {
	return `${cellRef(entry)}.${col}`;
}

function rowField(col: string): string {
	return `$${col}`;
}

function quoteList(values: string[]): string {
	return `[${values.map((v) => JSON.stringify(v)).join(',')}]`;
}

function loopCardBody(entry: MarkdownRefEntry | null): string {
	const dimension = dimensionColumn(entry);
	const metric = metricColumn(entry);
	const detail = detailColumn(entry);
	return `{% card title="${rowField(dimension)}" %}
{% metric value=${rowField(metric)} label="${metric}" /%}
{% badge value="${rowField(detail)}" /%}
{% /card %}`;
}

export function buildContextualMarkdocSnippet(
	tagName: string,
	entries: MarkdownRefEntry[]
): string {
	const entry = getUsableMarkdocRefEntry(entries);
	if (!entry) return '';
	const rows = rowRef(entry);
	const cell = cellRef(entry);
	const dimension = dimensionColumn(entry);
	const metric = metricColumn(entry);
	const detail = detailColumn(entry);
	const param = dimension.replace(/[^A-Za-z0-9_]+/g, '_') || 'filter_value';

	switch (tagName) {
		case 'report-summary':
			return `## ${entry?.cellName ?? 'Result'} summary

{% grid cols=2 %}
{% metric value=${refField(entry, metric)} label="${metric}" /%}
{% chart type="bar" data=${rows} x="${dimension}" y="${metric}" /%}
{% /grid %}

{% datatable data=${rows} cols=${quoteList([dimension, metric, detail])} limit=20 /%}`;
		case 'report-filtered':
			return `## ${entry?.cellName ?? 'Filtered result'}

{% filter kind="dropdown" param="${param}" label="${dimension}" options=${rows} optionsColumn="${dimension}" /%}

{% chart type="bar" data=${rows} x="${dimension}" y="${metric}" filterParam="${param}" filterColumn="${dimension}" /%}

{% datatable data=${rows} cols=${quoteList([dimension, metric, detail])} linkedFilter="${param}" limit=20 /%}`;
		case 'report-grouped':
			return `## ${entry?.cellName ?? 'Grouped result'}

{% group data=${rows} by="${dimension}" %}
{% card title="$key" %}
{% each data=$items %}
${loopCardBody(entry)}
{% /each %}
{% /card %}
{% /group %}`;
		case 'report-tabs':
			return `## ${entry?.cellName ?? 'Result'} drilldown

{% tabs %}
{% tab label="Chart" %}
{% chart type="bar" data=${rows} x="${dimension}" y="${metric}" /%}
{% /tab %}
{% tab label="Rows" %}
{% datatable data=${rows} cols=${quoteList([dimension, metric, detail])} limit=20 /%}
{% /tab %}
{% tab label="Grouped" %}
{% group data=${rows} by="${dimension}" %}
{% details summary="$key" %}
{% each data=$items %}
${loopCardBody(entry)}
{% /each %}
{% /details %}
{% /group %}
{% /tab %}
{% /tabs %}`;
		case 'metric':
			return `{% metric value=${refField(entry, metric)} label="${metric}" /%}`;
		case 'chart':
			return `{% chart type="bar" data=${rows} x="${dimension}" y="${metric}" /%}`;
		case 'datatable':
			return `{% datatable data=${rows} cols=${quoteList([dimension, metric, detail])} limit=20 /%}`;
		case 'badge':
			return `{% badge value=${refField(entry, dimension)} /%}`;
		case 'progress':
			return `{% progress value=${refField(entry, metric)} max=100 label="${metric}" /%}`;
		case 'filter':
			return `{% filter kind="dropdown" param="${param}" label="${dimension}" options=${rows} optionsColumn="${dimension}" /%}`;
		case 'columns':
			return `{% columns %}
{% column %}
{% metric value=${refField(entry, metric)} label="${metric}" /%}
{% /column %}
{% column %}
{% chart type="bar" data=${rows} x="${dimension}" y="${metric}" /%}
{% /column %}
{% /columns %}`;
		case 'column':
			return `{% column %}
{% metric value=${refField(entry, metric)} label="${metric}" /%}
{% /column %}`;
		case 'grid':
			return `{% grid cols=2 %}
{% metric value=${refField(entry, metric)} label="${metric}" /%}
{% datatable data=${rows} cols=${quoteList([dimension, metric])} limit=10 /%}
{% /grid %}`;
		case 'callout':
			return `{% callout type="info" %}
Review {% ${cell}.count %} rows before publishing.
{% /callout %}`;
		case 'card':
			return `{% card title="${entry?.cellName ?? 'Result'}" %}
{% chart type="bar" data=${rows} x="${dimension}" y="${metric}" /%}
{% /card %}`;
		case 'details':
			return `{% details summary="Show ${entry?.cellName ?? 'result'} rows" %}
{% datatable data=${rows} limit=20 /%}
{% /details %}`;
		case 'tabs':
			return `{% tabs %}
{% tab label="Chart" %}
{% chart type="bar" data=${rows} x="${dimension}" y="${metric}" /%}
{% /tab %}
{% tab label="Rows" %}
{% datatable data=${rows} limit=20 /%}
{% /tab %}
{% /tabs %}`;
		case 'tab':
			return `{% tab label="${entry?.cellName ?? 'Result'}" %}
{% datatable data=${rows} limit=20 /%}
{% /tab %}`;
		case 'if':
		case 'conditional':
			return `{% if gt(${cell}.count, 0) %}
{% chart type="bar" data=${rows} x="${dimension}" y="${metric}" /%}
{% else /%}
{% callout type="warning" %}
No rows returned for ${entry?.cellName ?? 'this result'}.
{% /callout %}
{% /if %}`;
		case 'else':
			return WIDGET_SNIPPETS.else;
		case 'group':
			return `{% group data=${rows} by="${dimension}" %}
{% card title="$key" %}
{% each data=$items %}
${loopCardBody(entry)}
{% /each %}
{% /card %}
{% /group %}`;
		case 'each':
			return `{% each data=${rows} %}
${loopCardBody(entry)}
{% /each %}`;
		case 'mermaid':
			return `{% mermaid %}
flowchart TD
  {% each data=${rows} %}
  ${rowField(dimension)}["${rowField(dimension)}"]
  {% /each %}
{% /mermaid %}`;
		case 'mermaid-loop':
			return `{% mermaid %}
kanban
  {% group data=${rows} by="${dimension}" %}
  $keyId[$key]
    {% each data=$items %}
    item_${rowField(metric)}[${rowField(detail)}]
    {% /each %}
  {% /group %}
{% /mermaid %}`;
		case 'summary-table':
			return `{% datatable data=${rows} index=${quoteList([dimension])} valueCol="${metric}" agg="sum" valueFormatKind="number" /%}`;
		case 'pivot-table':
			return `{% datatable data=${rows} index=${quoteList([dimension])} pivotBy="${detail}" valueCol="${metric}" agg="sum" valueFormatKind="number" /%}`;
		default:
			return WIDGET_SNIPPETS[tagName as keyof typeof WIDGET_SNIPPETS] ?? '';
	}
}
