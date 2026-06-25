// Named import of `Tag` breaks under Vite's SSR module runner (@markdoc/markdoc is CJS) —
// go through the default export instead, which works in both SSR and client bundles.
import Markdoc from '@markdoc/markdoc';
const { Tag } = Markdoc;
import type { Config, ConfigFunction, RenderableTreeNode, Schema } from '@markdoc/markdoc';
import type { Cell } from '$lib/stores/notebook.svelte';
import type { ChartConfig } from '$lib/types/gui-pipeline';

// Markdoc cells: a richer alternative to the legacy {{outputName.field}} syntax
// in markdown-interp.ts. Detected by the presence of `{%` — if absent, callers
// should keep using the legacy renderer for backward compatibility.
//
// Syntax notes (verified against @markdoc/markdoc 0.5.7, which has NO pipe
// operator and NO arithmetic/comparison operators — only function calls):
//   $orders.revenue                  variable (first-row field)
//   $orders.rows                     full rows array
//   {% currency($orders.revenue) %}  format functions (see FUNCTIONS below)
//   {% if gt($orders.count, 0) %}...{% else /%}...{% /if %}   built-in conditional
//   (note: {% else %} must be self-closing; chain with {% else <cond> /%} for elsif)
//   {% metric value=$orders.revenue label="Revenue" vs=$prev.revenue /%}
//   {% chart type="bar" data=$orders.rows x="month" y="revenue" /%}
//   {% datatable data=$orders.rows cols=["month","revenue"] limit=10 /%}
//   {% columns %}{% column %}...{% /column %}{% column %}...{% /column %}{% /columns %}
//   {% grid cols=3 %}...{% /grid %}
//   {% callout type="warning" %}...{% /callout %}
//   {% card title="..." %}...{% /card %}
//   {% filter kind="dropdown" param="region" label="Region" options=["US","EU"] /%}
//     parameterizes query cells that contain ${region} in their code (notebook-scoped).
//     Substitution is raw text (dbt/Jinja-style) — wrap it in your own quotes for a
//     string literal: WHERE region = '${region}'. Embedded single quotes are escaped.

export function hasMarkdocSyntax(markdown: string): boolean {
	return /\{%\s*[/$a-zA-Z]/.test(markdown);
}

export function buildMarkdocVariables(cells: Cell[]): Record<string, unknown> {
	const vars: Record<string, unknown> = {};
	for (const cell of cells) {
		if (cell.cellType !== 'query' || !cell.result) continue;
		const { rows, columns } = cell.result;
		vars[cell.outputName] = {
			count: rows.length,
			rowCount: rows.length,
			columns: columns.join(', '),
			rows,
			chartConfig: cell.resultChartConfig ?? null,
			...rows[0]
		};
	}
	return vars;
}

// ── Format functions ────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

const currencyFmt = new Intl.NumberFormat(undefined, {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 0
});
const compactFmt = new Intl.NumberFormat(undefined, {
	notation: 'compact',
	maximumFractionDigits: 1
});

function fmtCurrency(v: unknown): string {
	const n = toNum(v);
	return n === null ? '—' : currencyFmt.format(n);
}

function fmtCompact(v: unknown): string {
	const n = toNum(v);
	return n === null ? '—' : compactFmt.format(n);
}

function fmtPercent(v: unknown, decimals = 1): string {
	const n = toNum(v);
	return n === null ? '—' : `${n.toFixed(decimals)}%`;
}

function fmtSign(v: unknown): string {
	const n = toNum(v);
	if (n === null) return '—';
	const formatted = Math.abs(n).toLocaleString();
	return n < 0 ? `-${formatted}` : `+${formatted}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(v: unknown, pattern?: string): string {
	const d = v instanceof Date ? v : new Date(String(v));
	if (Number.isNaN(d.getTime())) return '—';
	if (!pattern) return d.toLocaleDateString();
	return pattern
		.replace('YYYY', String(d.getFullYear()))
		.replace('MMM', MONTHS[d.getMonth()])
		.replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
		.replace('DD', String(d.getDate()).padStart(2, '0'))
		.replace('D', String(d.getDate()));
}

// Exported so markdown-interp.ts (the legacy {{ }} renderer) can call the exact same
// formatters instead of hand-maintaining a second copy that silently drifts out of sync.
export const FUNCTIONS: Record<string, ConfigFunction> = {
	currency: { transform: (p) => fmtCurrency(p[0]) },
	compact: { transform: (p) => fmtCompact(p[0]) },
	percent: { transform: (p) => fmtPercent(p[0], typeof p[1] === 'number' ? p[1] : undefined) },
	sign: { transform: (p) => fmtSign(p[0]) },
	formatDate: { transform: (p) => fmtDate(p[0], typeof p[1] === 'string' ? p[1] : undefined) },
	gt: { transform: (p) => (toNum(p[0]) ?? -Infinity) > (toNum(p[1]) ?? Infinity) },
	gte: { transform: (p) => (toNum(p[0]) ?? -Infinity) >= (toNum(p[1]) ?? Infinity) },
	lt: { transform: (p) => (toNum(p[0]) ?? Infinity) < (toNum(p[1]) ?? -Infinity) },
	lte: { transform: (p) => (toNum(p[0]) ?? Infinity) <= (toNum(p[1]) ?? -Infinity) }
};

// ── Custom tags ──────────────────────────────────────────────────────────────

const CONTAINER_CHILDREN = [
	'tag',
	'paragraph',
	'list',
	'heading',
	'blockquote',
	'fence',
	'hr',
	'image',
	'table'
];

function metricTrend(
	value: unknown,
	vs: unknown
): { deltaPct: number | null; trend: 'up' | 'down' | 'flat' | null } {
	const v = toNum(value);
	const ref = toNum(vs);
	if (v === null || ref === null || ref === 0) return { deltaPct: null, trend: null };
	const deltaPct = ((v - ref) / Math.abs(ref)) * 100;
	const trend = deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';
	return { deltaPct, trend };
}

const metricTag: Schema = {
	render: 'metric',
	selfClosing: true,
	attributes: {
		value: { type: [Number, String] },
		label: { type: String },
		vs: { type: [Number, String] },
		format: {
			type: String,
			matches: ['number', 'currency', 'compact', 'percent'],
			default: 'number'
		}
	},
	transform(node, config) {
		const attrs = node.transformAttributes(config);
		const { deltaPct, trend } = metricTrend(attrs.value, attrs.vs);
		return new Tag(
			'metric',
			{
				value: attrs.value,
				label: attrs.label,
				format: attrs.format,
				vs: attrs.vs,
				deltaPct,
				trend
			},
			[]
		);
	}
};

const CHART_TYPES = [
	'table',
	'big-value',
	'delta',
	'value',
	'line',
	'bar',
	'bar-horizontal',
	'area',
	'scatter',
	'bubble',
	'pie',
	'histogram',
	'heatmap',
	'calendar-heatmap',
	'funnel',
	'box-plot',
	'sankey',
	'custom'
];

interface ChartRefBag {
	rows?: Record<string, unknown>[];
	chartConfig?: ChartConfig | null;
}

const chartTag: Schema = {
	render: 'chart',
	selfClosing: true,
	attributes: {
		ref: { type: Object },
		type: { type: String, matches: [...CHART_TYPES, 'sparkline'] },
		data: { type: Array },
		x: { type: String },
		y: { type: String },
		yColumns: { type: Array },
		yColumnsSecondary: { type: Array },
		colorColumn: { type: String },
		sizeColumn: { type: String },
		seriesMode: { type: String, matches: ['auto', 'grouped', 'stacked'] },
		sortOrder: { type: String, matches: ['none', 'asc', 'desc'] },
		histogramBins: { type: Number },
		title: { type: String },
		code: { type: String },
		height: { type: Number, default: 280 }
	},
	transform(node, config) {
		const attrs = node.transformAttributes(config) as Record<string, unknown> & {
			ref?: ChartRefBag;
			type?: string;
			data?: unknown[];
			x?: string;
			y?: string;
			yColumns?: string[];
			yColumnsSecondary?: string[];
			colorColumn?: string;
			sizeColumn?: string;
			seriesMode?: string;
			sortOrder?: string;
			histogramBins?: number;
			title?: string;
			code?: string;
			height?: number;
		};
		const baseConfig = attrs.ref?.chartConfig ?? null;
		const data = attrs.data ?? attrs.ref?.rows ?? [];

		const merged: Record<string, unknown> = { ...(baseConfig ?? {}) };
		let compact = false;
		if (attrs.type === 'sparkline') {
			merged.chartType = 'line';
			compact = true;
		} else if (attrs.type) {
			merged.chartType = attrs.type;
		}
		if (attrs.x) merged.xColumn = attrs.x;
		if (attrs.y) merged.yColumns = [attrs.y];
		if (attrs.yColumns) merged.yColumns = attrs.yColumns;
		if (attrs.yColumnsSecondary) merged.yColumnsSecondary = attrs.yColumnsSecondary;
		if (attrs.colorColumn) merged.colorColumn = attrs.colorColumn;
		if (attrs.sizeColumn) merged.sizeColumn = attrs.sizeColumn;
		if (attrs.seriesMode) merged.seriesMode = attrs.seriesMode;
		if (attrs.sortOrder) merged.sortOrder = attrs.sortOrder;
		if (attrs.histogramBins) merged.histogramBins = attrs.histogramBins;
		if (attrs.title) merged.title = attrs.title;
		if (attrs.code) merged.code = attrs.code;

		return new Tag('chart', { ...merged, data, compact, height: attrs.height ?? 280 }, []);
	}
};

const badgeTag: Schema = {
	render: 'badge',
	selfClosing: true,
	attributes: {
		value: { type: [String, Number], required: true },
		color: { type: String, matches: ['info', 'success', 'warning', 'error', 'neutral'] }
	}
};

const progressTag: Schema = {
	render: 'progress',
	selfClosing: true,
	attributes: {
		value: { type: Number, required: true },
		max: { type: Number, default: 100 },
		label: { type: String },
		color: { type: String, matches: ['info', 'success', 'warning', 'error'], default: 'info' }
	}
};

const datatableTag: Schema = {
	render: 'datatable',
	selfClosing: true,
	attributes: {
		data: { type: Array, required: true },
		cols: { type: Array },
		limit: { type: Number, default: 10 }
	}
};

const columnsTag: Schema = { render: 'columns', children: CONTAINER_CHILDREN };
const columnTag: Schema = {
	render: 'column',
	children: CONTAINER_CHILDREN,
	attributes: { width: { type: [Number, String] } }
};
const gridTag: Schema = {
	render: 'grid',
	children: CONTAINER_CHILDREN,
	attributes: { cols: { type: Number, default: 3 } }
};
const calloutTag: Schema = {
	render: 'callout',
	children: CONTAINER_CHILDREN,
	attributes: {
		type: { type: String, matches: ['info', 'success', 'warning', 'error'], default: 'info' }
	}
};
const cardTag: Schema = {
	render: 'card',
	children: CONTAINER_CHILDREN,
	attributes: { title: { type: String } }
};
const detailsTag: Schema = {
	render: 'details',
	children: CONTAINER_CHILDREN,
	attributes: {
		summary: { type: String, required: true },
		open: { type: Boolean, default: false }
	}
};
const tabTag: Schema = {
	render: 'tab',
	children: CONTAINER_CHILDREN,
	attributes: { label: { type: String, required: true } }
};
const tabsTag: Schema = { render: 'tabs', children: ['tag'] };

// Declarative only — current value is read/written live by FilterWidget.svelte via the
// notebook store (setNotebookFilterValue/getNotebookFilterValue), not through Markdoc
// variables, since Markdoc resolves its whole tree once per render rather than per keystroke.
const filterTag: Schema = {
	render: 'filter',
	selfClosing: true,
	attributes: {
		kind: {
			type: String,
			matches: ['dropdown', 'text-input', 'date-range', 'button-group'],
			default: 'dropdown'
		},
		param: { type: String, required: true },
		label: { type: String },
		options: { type: Array },
		optionsColumn: { type: String },
		default: { type: String, render: 'defaultValue' }
	}
};

const TAGS: Record<string, Schema> = {
	...Markdoc.tags,
	metric: metricTag,
	chart: chartTag,
	datatable: datatableTag,
	badge: badgeTag,
	progress: progressTag,
	columns: columnsTag,
	column: columnTag,
	grid: gridTag,
	callout: calloutTag,
	card: cardTag,
	details: detailsTag,
	tabs: tabsTag,
	tab: tabTag,
	filter: filterTag
};

// ── Render entrypoint ────────────────────────────────────────────────────────

export interface MarkdocRenderResult {
	tree: RenderableTreeNode[];
	errors: string[];
}

export function renderMarkdocCell(markdown: string, cells: Cell[]): MarkdocRenderResult {
	const config: Config = {
		variables: buildMarkdocVariables(cells),
		functions: FUNCTIONS,
		tags: TAGS
	};
	const ast = Markdoc.parse(markdown);
	const validationErrors = Markdoc.validate(ast, config)
		.filter((e) => e.error.level === 'critical' || e.error.level === 'error')
		.map((e) => e.error.message);
	const transformed = Markdoc.transform(ast, config);
	const tree = Array.isArray(transformed) ? transformed : [transformed];
	return { tree, errors: [...new Set(validationErrors)] };
}

/** Returns all top-level $outputName variable references found in a Markdoc string. */
export function extractMarkdocRefs(markdown: string): string[] {
	const names = new Set<string>();
	const ast = Markdoc.parse(markdown);
	const collect = (value: unknown): void => {
		for (const astVal of Markdoc.Ast.getAstValues(value)) {
			if (astVal.$$mdtype === 'Variable') {
				const path = (astVal as unknown as { path: string[] }).path;
				if (path[0]) names.add(path[0]);
			} else if (astVal.$$mdtype === 'Function') {
				collect((astVal as unknown as { parameters: Record<string, unknown> }).parameters);
			}
		}
	};
	for (const node of ast.walk()) collect(node.attributes);
	return [...names];
}

/** Returns the `param` attribute of every `{% filter %}` widget declared in a markdown string. */
export function extractFilterParams(markdown: string): string[] {
	const params = new Set<string>();
	const ast = Markdoc.parse(markdown);
	for (const node of ast.walk()) {
		if (
			node.tag === 'filter' &&
			typeof node.attributes.param === 'string' &&
			node.attributes.param
		) {
			params.add(node.attributes.param);
		}
	}
	return [...params];
}
