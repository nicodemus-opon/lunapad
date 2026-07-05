// Named import of `Tag` breaks under Vite's SSR module runner (@markdoc/markdoc is CJS) —
// go through the default export instead, which works in both SSR and client bundles.
import Markdoc from '@markdoc/markdoc';
const { Tag } = Markdoc;
import type { Config, ConfigFunction, RenderableTreeNode, Schema } from '@markdoc/markdoc';
import { CUSTOM_MARKDOC_TAGS as CUSTOM_MARKDOC_TAG_REGISTRY } from './markdoc-tag-registry';

/** Markdoc config extended with the original markdown string for raw mermaid slicing. */
interface MarkdocConfig extends Config {
	source?: string;
}

/** Minimal shape for pre-transform AST nodes walked by the template expander. */
interface AstLike {
	type: string;
	tag?: string;
	attributes?: Record<string, unknown>;
	children?: AstLike[];
}
import type { Cell } from '$lib/stores/notebook.svelte';
import type { ChartConfig } from '$lib/types/gui-pipeline';

// Markdoc cells: the sole markdown rendering pipeline for the app (notebook
// markdown cells, AI chat messages, shared reports) — every markdown string
// is parsed/transformed here, whether or not it uses any of the syntax below.
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

export function buildMarkdocVariables(cells: Cell[]): Record<string, unknown> {
	const vars: Record<string, unknown> = {};
	for (const cell of cells) {
		if ((cell.cellType !== 'query' && cell.cellType !== 'python') || !cell.result) continue;
		const { rows, columns, totalRowCount, truncated } = cell.result;
		const count = totalRowCount ?? rows.length;
		vars[cell.outputName] = {
			count,
			rowCount: count,
			columns: columns.join(', '),
			rows,
			chartConfig: cell.resultChartConfig ?? null,
			...rows[0]
		};
	}
	return vars;
}

/** AI often emits explicit first-row indexing (`$cell.rows.0.metric` or `$cell.rows[0].metric`)
 * even though Markdoc exposes first-row fields directly as `$cell.metric`. Normalize those
 * patterns up-front so validation/rendering accept the intended ref shape. */
export function normalizeMarkdocFirstRowRefs(markdown: string): string {
	return markdown
		.replace(/\$([A-Za-z_]\w*)\.rows\.0\.([A-Za-z_]\w*)/g, '$$$1.$2')
		.replace(/\$([A-Za-z_]\w*)\.rows\[\s*0\s*\]\.([A-Za-z_]\w*)/g, '$$$1.$2');
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

export const CHART_TYPES = [
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
	'map',
	'choropleth',
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
		lat: { type: String },
		lon: { type: String },
		geoScope: { type: String, matches: ['world', 'usa-states'] },
		seriesMode: { type: String, matches: ['auto', 'grouped', 'stacked'] },
		sortOrder: { type: String, matches: ['none', 'asc', 'desc'] },
		histogramBins: { type: Number },
		title: { type: String },
		code: { type: String },
		height: { type: Number, default: 280 },
		filterParam: { type: String },
		filterColumn: { type: String },
		drillCell: { type: String }
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
			lat?: string;
			lon?: string;
			geoScope?: string;
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
		if (attrs.lat) merged.latColumn = attrs.lat;
		if (attrs.lon) merged.lonColumn = attrs.lon;
		if (attrs.geoScope) merged.geoScope = attrs.geoScope;
		if (attrs.seriesMode) merged.seriesMode = attrs.seriesMode;
		if (attrs.sortOrder) merged.sortOrder = attrs.sortOrder;
		if (attrs.histogramBins) merged.histogramBins = attrs.histogramBins;
		if (attrs.title) merged.title = attrs.title;
		if (attrs.code) merged.code = attrs.code;
		if (attrs.filterParam) merged.filterParam = attrs.filterParam;
		if (attrs.filterColumn) merged.filterColumn = attrs.filterColumn;
		if (attrs.drillCell) merged.drillCell = attrs.drillCell;

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
		limit: { type: Number, default: 10 },
		linkedFilter: { type: String },
		pageSize: { type: Number },
		headerInsights: { type: String, matches: ['full', 'compact'], default: 'compact' },
		index: { type: Array },
		pivotBy: { type: String },
		valueCol: { type: String },
		agg: { type: String, matches: ['sum', 'avg', 'min', 'max', 'count'], default: 'sum' },
		round: { type: Number },
		valueFormatKind: {
			type: String,
			matches: [
				'boolean',
				'id',
				'email',
				'url',
				'datetime',
				'date',
				'percentage',
				'currency',
				'number',
				'category',
				'text'
			]
		},
		valueCurrencySymbol: { type: String },
		conditionalFormats: { type: Array }
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

// ── Source-based template expansion ({% group %}/{% each %}) ─────────────────
// Expand loops by slicing the original markdown source and interpolating $fields.
// This preserves whitespace/indentation for any Mermaid (or other) diagram type —
// no per-diagram normalizers required.

function slugMermaidId(value: unknown): string {
	return (
		String(value ?? '')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_|_$/g, '') || 'item'
	);
}

function interpolateBareVars(text: string, scope: Record<string, unknown>): string {
	return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
		const v = scope[name];
		return v == null ? '' : String(v);
	});
}

function resolveScopeVar(scope: Record<string, unknown>, path: string[]): string {
	let val: unknown = scope;
	for (const key of path) {
		if (val == null || typeof val !== 'object') return '';
		val = (val as Record<string, unknown>)[key];
	}
	return val == null ? '' : String(val);
}

function renderTextContent(content: unknown, scope: Record<string, unknown>): string {
	if (
		content &&
		typeof content === 'object' &&
		(content as { $$mdtype?: string }).$$mdtype === 'Variable'
	) {
		return resolveScopeVar(scope, (content as { path: string[] }).path);
	}
	return interpolateBareVars(String(content ?? ''), scope);
}

function mergeVariables(
	config: MarkdocConfig,
	scope: Record<string, unknown>
): Record<string, unknown> {
	return { ...(config.variables ?? {}), ...scope };
}

function resolveAstValue(value: unknown, variables: Record<string, unknown>): unknown {
	if (value == null) return value;
	if (typeof value === 'object' && (value as { $$mdtype?: string }).$$mdtype === 'Variable') {
		const path = (value as { path: string[] }).path;
		let cur: unknown = variables;
		for (const key of path) {
			if (cur == null || typeof cur !== 'object') return undefined;
			cur = (cur as Record<string, unknown>)[key];
		}
		return cur;
	}
	if (Array.isArray(value)) return value.map((v) => resolveAstValue(v, variables));
	return value;
}

/** Find a {% tag %}…{% /tag %} block, respecting nested tags of the same name. */
function findTagBlock(source: string, tagName: string, fromIndex = 0): SourceTagBlock | null {
	const openRe = new RegExp(`\\{%\\s*${tagName}\\b([^%]*)%\\}`, 'g');
	openRe.lastIndex = fromIndex;
	const open = openRe.exec(source);
	if (!open) return null;

	const start = open.index;
	const attrStr = open[1];
	const bodyStart = start + open[0].length;
	const tagRe = new RegExp(`\\{%\\s*(/?)${tagName}\\b[^%]*%\\}`, 'g');
	tagRe.lastIndex = bodyStart;
	let depth = 1;
	while (depth > 0) {
		const m = tagRe.exec(source);
		if (!m) return null;
		if (m[1] === '/') depth--;
		else depth++;
		if (depth === 0) {
			const end = m.index + m[0].length;
			return {
				attrStr,
				body: source.slice(bodyStart, m.index),
				full: source.slice(start, end),
				start,
				end
			};
		}
	}
	return null;
}

interface SourceTagBlock {
	attrStr: string;
	body: string;
	full: string;
	start: number;
	end: number;
}

type LoopTagName = 'each' | 'group';

function getTagBlockFromNode(
	source: string,
	node: AstLike,
	tagName: LoopTagName
): Pick<SourceTagBlock, 'attrStr' | 'body'> | null {
	const lines = (node as { lines?: number[] }).lines;
	if (lines && lines.length >= 4) {
		const srcLines = source.split('\n');
		const openLine = srcLines[lines[0]] ?? '';
		const attrMatch = openLine.match(new RegExp(`\\{%\\s*${tagName}\\b([^%]*)%\\}`));
		if (!attrMatch) return null;
		return { attrStr: attrMatch[1], body: srcLines.slice(lines[1], lines[2]).join('\n') };
	}
	const line = (node as { location?: { start?: { line?: number } } }).location?.start?.line;
	if (line == null) return null;
	const srcLines = source.split('\n');
	let offset = 0;
	for (let i = 0; i < line && i < srcLines.length; i++) offset += srcLines[i].length + 1;
	const block = findTagBlock(source, tagName, offset);
	return block ? { attrStr: block.attrStr, body: block.body } : null;
}

function resolveParsedLoopAttrs(
	tagName: LoopTagName,
	attrStr: string,
	config: MarkdocConfig,
	scope: Record<string, unknown>
): Record<string, unknown> {
	const ast = Markdoc.parse(`{% ${tagName}${attrStr} %}x{% /${tagName} %}`);
	const variables = mergeVariables(config, scope);
	for (const node of ast.walk()) {
		if (node.type !== 'tag' || node.tag !== tagName) continue;
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(node.attributes)) {
			out[key] = resolveAstValue(val, variables);
		}
		if (
			tagName === 'each' &&
			Array.isArray(out.data) &&
			out.data.length === 0 &&
			Array.isArray(scope.items) &&
			scope.items.length > 0
		) {
			out.data = scope.items;
		}
		return out;
	}
	return {};
}

/** Drop a trailing source line that was only indentation for a removed {% tag %} line. */
function stripTagLineTail(text: string): string {
	return text.replace(/\n[ \t]+$/u, '\n');
}

/** Concatenate expanded fragments without gluing lines (diagram-agnostic). */
function stitchParts(...parts: string[]): string {
	let out = '';
	for (const part of parts) {
		if (!part) continue;
		if (out) {
			// Trim trailing spaces from a line where a {% tag %} was removed, then hard-break.
			out = out.replace(/[ \t]+$/u, '');
			if (!out.endsWith('\n')) out += '\n';
		}
		out += part;
	}
	return out;
}

/** Join repeated loop iterations; insert newlines when the template omits them. */
function joinExpandedChunks(chunks: string[]): string {
	if (chunks.length === 0) return '';
	let out = chunks[0];
	for (let i = 1; i < chunks.length; i++) {
		const next = chunks[i];
		if (!out.endsWith('\n') && !next.startsWith('\n')) out += '\n';
		out += next;
	}
	return out;
}

function expandEachBlock(
	attrStr: string,
	body: string,
	config: MarkdocConfig,
	scope: Record<string, unknown>
): string {
	const attrs = resolveParsedLoopAttrs('each', attrStr, config, scope);
	const arr = Array.isArray(attrs.data) ? (attrs.data as Record<string, unknown>[]) : [];
	const chunks = arr.map((item) => expandLoopsInSource(body, config, { ...scope, ...item }));
	return joinExpandedChunks(chunks);
}

function expandGroupBlock(
	attrStr: string,
	body: string,
	config: MarkdocConfig,
	scope: Record<string, unknown>
): string {
	const attrs = resolveParsedLoopAttrs('group', attrStr, config, scope) as {
		data?: Record<string, unknown>[];
		by?: string;
		order?: string[];
	};
	const { data = [], by = '', order } = attrs;
	const map = new Map<string, Record<string, unknown>[]>();
	for (const row of data) {
		const k = String(row[by] ?? '');
		if (!map.has(k)) map.set(k, []);
		map.get(k)!.push(row);
	}
	const keys = order
		? [...order.filter((k) => map.has(k)), ...[...map.keys()].filter((k) => !order.includes(k))]
		: [...map.keys()];
	const chunks = keys.map((key) => {
		const loopScope = {
			...scope,
			key,
			keyId: slugMermaidId(key),
			items: map.get(key) ?? []
		};
		return expandLoopsInSource(body, config, loopScope);
	});
	return joinExpandedChunks(chunks);
}

/** Expand {% group %}/{% each %} in a source fragment; interpolate bare $field tokens. */
export function expandLoopsInSource(
	template: string,
	config: MarkdocConfig,
	scope: Record<string, unknown>
): string {
	const group = findTagBlock(template, 'group');
	if (group) {
		const before = stripTagLineTail(
			expandLoopsInSource(template.slice(0, group.start), config, scope)
		);
		const after = expandLoopsInSource(template.slice(group.end), config, scope);
		const middle = expandGroupBlock(group.attrStr, group.body, config, scope);
		return stitchParts(before, middle, after);
	}

	const each = findTagBlock(template, 'each');
	if (each) {
		const before = stripTagLineTail(
			expandLoopsInSource(template.slice(0, each.start), config, scope)
		);
		const after = expandLoopsInSource(template.slice(each.end), config, scope);
		const middle = expandEachBlock(each.attrStr, each.body, config, scope);
		return stitchParts(before, middle, after);
	}

	return interpolateBareVars(template, mergeVariables(config, scope));
}

/** Expand only explicit loop blocks in a full markdown document.
 *
 * `expandLoopsInSource` intentionally interpolates bare `$field` tokens at its leaf,
 * which is correct inside loop bodies but too aggressive for an entire report. This
 * wrapper preserves ordinary prose/widgets and only replaces `{% group %}` /
 * `{% each %}` regions with their rendered markdown. That makes loop authoring
 * tolerant of blank lines because Markdoc sees the expanded markdown, not the fragile
 * nested template tags.
 */
function expandLoopBlocksInDocument(
	template: string,
	config: MarkdocConfig,
	scope: Record<string, unknown>
): string {
	const group = findTagBlock(template, 'group');
	if (group) {
		const before = expandLoopBlocksInDocument(template.slice(0, group.start), config, scope);
		const middle = expandGroupBlock(group.attrStr, group.body, config, scope);
		const after = expandLoopBlocksInDocument(template.slice(group.end), config, scope);
		return stitchParts(before, middle, after);
	}

	const each = findTagBlock(template, 'each');
	if (each) {
		const before = expandLoopBlocksInDocument(template.slice(0, each.start), config, scope);
		const middle = expandEachBlock(each.attrStr, each.body, config, scope);
		const after = expandLoopBlocksInDocument(template.slice(each.end), config, scope);
		return stitchParts(before, middle, after);
	}

	return template;
}

function expandEachFromNode(
	node: AstLike,
	config: MarkdocConfig,
	scope: Record<string, unknown>
): string {
	if (config.source) {
		const block = getTagBlockFromNode(config.source, node, 'each');
		if (block) return expandEachBlock(block.attrStr, block.body, config, scope);
	}
	return expandEachBlock(
		'',
		renderTemplateNodesFallback(node.children ?? [], config, scope),
		config,
		scope
	);
}

function expandGroupFromNode(
	node: AstLike,
	config: MarkdocConfig,
	scope: Record<string, unknown>
): string {
	if (config.source) {
		const block = getTagBlockFromNode(config.source, node, 'group');
		if (block) return expandGroupBlock(block.attrStr, block.body, config, scope);
	}
	return expandGroupBlock(
		'',
		renderTemplateNodesFallback(node.children ?? [], config, scope),
		config,
		scope
	);
}

/** AST fallback when source slices are unavailable (e.g. tests without config.source). */
function renderTemplateNodesFallback(
	nodes: AstLike[],
	config: MarkdocConfig,
	scope: Record<string, unknown>
): string {
	const parts: string[] = [];
	for (const node of nodes) {
		switch (node.type) {
			case 'text':
				parts.push(renderTextContent(node.attributes?.content, scope));
				break;
			case 'softbreak':
			case 'hardbreak':
				parts.push('\n');
				break;
			case 'tag':
				if (node.tag === 'each') parts.push(expandEachFromNode(node, config, scope));
				else if (node.tag === 'group') parts.push(expandGroupFromNode(node, config, scope));
				else if (node.children?.length) {
					parts.push(renderTemplateNodesFallback(node.children, config, scope));
				}
				break;
			default:
				if (node.children?.length) {
					parts.push(renderTemplateNodesFallback(node.children, config, scope));
				}
		}
	}
	return parts.join('');
}

function nodeHasLoopTags(nodes: AstLike[]): boolean {
	for (const node of nodes) {
		if (node.type === 'tag' && (node.tag === 'each' || node.tag === 'group')) return true;
		if (node.children?.length && nodeHasLoopTags(node.children)) return true;
	}
	return false;
}

function sourceHasLoopTags(source: string): boolean {
	return /\{%\s*(each|group)\b/.test(source);
}

function sliceMermaidBody(source: string, lines: number[]): string {
	const srcLines = source.split('\n');
	if (lines.length >= 4) {
		const fromLines = srcLines.slice(lines[1], lines[2]).join('\n');
		if (fromLines.trim()) return fromLines;
	}
	if (lines.length === 2) {
		const openLine = srcLines[lines[0]] ?? '';
		const openMatch = openLine.match(/\{%\s*mermaid(?:\s+[^%]*)?\s*%\}(.*)/);
		const inlineStart = openMatch?.[1] ?? '';
		const middle = srcLines.slice(lines[0] + 1, lines[1]);
		const parts = inlineStart ? [inlineStart, ...middle] : middle;
		const fromLines = parts.join('\n');
		if (fromLines.trim()) return fromLines;
	}
	return '';
}

function sourceOffsetAtLine(source: string, line: number): number {
	const lines = source.split('\n');
	let offset = 0;
	for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1;
	return offset;
}

function nodeSourceOffset(source: string, node: AstLike): number {
	const line = (node as { location?: { start?: { line?: number } } }).location?.start?.line;
	return line == null ? 0 : sourceOffsetAtLine(source, line);
}

function offsetInsideBlock(offset: number, block: SourceTagBlock): boolean {
	return offset >= block.start && offset < block.end;
}

function isInsideMermaidBlock(source: string, node: AstLike): boolean {
	const offset = nodeSourceOffset(source, node);
	let from = 0;
	while (true) {
		const block = findTagBlock(source, 'mermaid', from);
		if (!block) return false;
		if (offsetInsideBlock(offset, block)) return true;
		from = block.end;
	}
}

/** Resolve mermaid body from source; Markdoc `node.lines` is often `[open, close]` only. */
function trimMermaidBody(body: string): string {
	let out = body;
	if (out.startsWith('\n')) out = out.slice(1);
	if (out.endsWith('\n')) out = out.slice(0, -1);
	return out;
}

function resolveMermaidBody(source: string, node: AstLike): string {
	const offset = nodeSourceOffset(source, node);
	const atNode = findTagBlock(source, 'mermaid', offset);
	if (atNode?.body.trim()) return trimMermaidBody(atNode.body);
	const first = findTagBlock(source, 'mermaid');
	if (first?.body.trim()) return trimMermaidBody(first.body);
	const lines = (node as { lines?: number[] }).lines;
	if (lines?.length) {
		const fromLines = sliceMermaidBody(source, lines);
		if (fromLines.trim()) return trimMermaidBody(fromLines);
	}
	return '';
}

/**
 * Split diagram rows accidentally glued to prose (e.g. sankey title + CSV row on one line).
 * Generic for any comma-separated numeric weight rows after 2+ spaces.
 */
export function normalizeMermaidCode(code: string): string {
	if (!code.trim()) return code;
	return code.replace(/^(.+?)( {2,})([A-Za-z][^\n,]{0,120}, [^\n,]{0,120}, \d+)\s*$/gm, '$1\n$3');
}

const eachTag: Schema = {
	render: 'md-each',
	children: ['inline', 'text', 'tag'],
	attributes: {
		data: { type: Array, required: true }
	},
	transform(node, config) {
		const cfg = config as MarkdocConfig;
		const astNode = node as unknown as AstLike;
		// Inside {% mermaid %}, expansion is deferred to the mermaid transform (source-based).
		if (cfg.source && isInsideMermaidBlock(cfg.source, astNode)) {
			const block = getTagBlockFromNode(cfg.source, astNode, 'each');
			if (block) return new Tag('md-each', {}, [block.body]);
		}
		const text = expandEachFromNode(astNode, cfg, {});
		return new Tag('md-each', {}, [text]);
	}
};

const groupTag: Schema = {
	render: 'md-group',
	children: ['inline', 'text', 'tag'],
	attributes: {
		data: { type: Array, required: true },
		by: { type: String, required: true },
		order: { type: Array }
	},
	transform(node, config) {
		const cfg = config as MarkdocConfig;
		const astNode = node as unknown as AstLike;
		if (cfg.source && isInsideMermaidBlock(cfg.source, astNode)) {
			const block = getTagBlockFromNode(cfg.source, astNode, 'group');
			if (block) return new Tag('md-group', {}, [block.body]);
		}
		const text = expandGroupFromNode(astNode, cfg, {});
		return new Tag('md-group', {}, [text]);
	}
};

// Declarative only — current value is read/written live by FilterWidget.svelte via the
// notebook store (setNotebookFilterValue/getNotebookFilterValue), not through Markdoc
// variables, since Markdoc resolves its whole tree once per render rather than per keystroke.
const filterTag: Schema = {
	render: 'filter',
	selfClosing: true,
	attributes: {
		kind: {
			type: String,
			matches: [
				'dropdown',
				'text-input',
				'date-range',
				'button-group',
				'multi-select',
				'relative-date',
				'numeric-range',
				'searchable-dropdown'
			],
			default: 'dropdown'
		},
		param: { type: String, required: true },
		label: { type: String },
		options: { type: Array },
		optionsColumn: { type: String },
		default: { type: String, render: 'defaultValue' },
		startParam: { type: String },
		endParam: { type: String },
		minParam: { type: String },
		maxParam: { type: String }
	}
};

function extractNodeText(nodes: RenderableTreeNode[]): string {
	return nodes
		.map((n) => {
			if (typeof n === 'string') return n;
			if (n && typeof n === 'object' && 'children' in n) {
				return extractNodeText((n as { children: RenderableTreeNode[] }).children);
			}
			return '';
		})
		.join('');
}

const mermaidTag: Schema = {
	render: 'mermaid',
	selfClosing: false,
	children: ['inline', 'text', 'tag'],
	attributes: {
		// code attr: pass a cell variable string directly, e.g. code=$cell.diagram_text
		code: { type: String, required: false }
	},
	transform(node, config) {
		const cfg = config as MarkdocConfig;
		const attrs = node.transformAttributes(config) as { code?: string };
		if (attrs.code) {
			return new Tag('mermaid', { code: normalizeMermaidCode(attrs.code) }, []);
		}
		const children = node.children as AstLike[];
		let code: string;
		if (cfg.source) {
			const body = resolveMermaidBody(cfg.source, node as unknown as AstLike);
			if (body && (nodeHasLoopTags(children) || sourceHasLoopTags(body))) {
				code = expandLoopsInSource(body, cfg, {});
			} else if (body) {
				code = body;
			} else if (nodeHasLoopTags(children)) {
				code = renderTemplateNodesFallback(children, cfg, {});
			} else {
				code = extractNodeText(node.transformChildren(config));
			}
		} else if (nodeHasLoopTags(children)) {
			code = renderTemplateNodesFallback(children, cfg, {});
		} else {
			code = extractNodeText(node.transformChildren(config));
		}
		return new Tag('mermaid', { code: normalizeMermaidCode(code) }, []);
	}
};

/** Custom widget tags (excludes built-in Markdoc tags like `if`). */
export const CUSTOM_MARKDOC_TAGS = CUSTOM_MARKDOC_TAG_REGISTRY;

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
	filter: filterTag,
	mermaid: mermaidTag,
	each: eachTag,
	group: groupTag
};

// ── Render entrypoint ────────────────────────────────────────────────────────

export interface MarkdocRenderResult {
	tree: RenderableTreeNode[];
	errors: string[];
}

export interface MarkdocDiagnostic {
	message: string;
	line: number;
	column: number;
	endLine?: number;
	endColumn?: number;
}

function buildMarkdocConfig(markdown: string, cells: Cell[]): MarkdocConfig {
	return {
		variables: {
			...buildMarkdocVariables(cells),
			key: '',
			keyId: '',
			items: []
		},
		functions: FUNCTIONS,
		tags: TAGS,
		source: markdown
	};
}

/** Validate markdown and return positioned diagnostics for Monaco markers. */
export function validateMarkdocMarkdown(markdown: string, cells: Cell[]): MarkdocDiagnostic[] {
	if (!markdown.includes('{%') && !markdown.includes('$')) return [];
	const normalizedMarkdown = normalizeMarkdocFirstRowRefs(markdown);

	const config = buildMarkdocConfig(normalizedMarkdown, cells);
	const effectiveMarkdown = sourceHasLoopTags(normalizedMarkdown)
		? expandLoopBlocksInDocument(normalizedMarkdown, config, {})
		: normalizedMarkdown;
	const ast = Markdoc.parse(effectiveMarkdown);
	const diagnostics: MarkdocDiagnostic[] = [];

	for (const raw of Markdoc.validate(ast, config)) {
		const entry = raw as {
			error: { level: string; message: string };
			lines?: number[];
			location?: { start?: { line?: number }; end?: { line?: number } };
		};
		if (entry.error.level !== 'critical' && entry.error.level !== 'error') continue;
		const startLine = (entry.location?.start?.line ?? entry.lines?.[0] ?? 0) + 1;
		const endLine = (entry.location?.end?.line ?? entry.lines?.[1] ?? entry.lines?.[0] ?? 0) + 1;
		diagnostics.push({
			message: entry.error.message,
			line: startLine,
			column: 1,
			endLine,
			endColumn: Number.MAX_SAFE_INTEGER
		});
	}

	// Flag undefined top-level $cell refs (inline prose + tag attributes)
	const knownCells = new Set(Object.keys(buildMarkdocVariables(cells)));
	const refNames = new Set([
		...extractMarkdocRefs(effectiveMarkdown),
		...extractBareMarkdocRefRoots(effectiveMarkdown)
	]);
	for (const refName of refNames) {
		if (knownCells.has(refName) || refName === 'key' || refName === 'keyId' || refName === 'items')
			continue;
		const re = new RegExp(`\\$${refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
		const match = re.exec(effectiveMarkdown);
		if (!match) continue;
		const before = effectiveMarkdown.slice(0, match.index);
		const line = before.split('\n').length;
		const column = match.index - before.lastIndexOf('\n');
		diagnostics.push({
			message: `Undefined variable: '${refName}' — run upstream cell or check outputName`,
			line,
			column,
			endLine: line,
			endColumn: column + match[0].length
		});
	}

	return diagnostics;
}

export function renderMarkdocCell(markdown: string, cells: Cell[]): MarkdocRenderResult {
	const normalizedMarkdown = normalizeMarkdocFirstRowRefs(markdown);
	const initialConfig = buildMarkdocConfig(normalizedMarkdown, cells);
	const effectiveMarkdown = sourceHasLoopTags(normalizedMarkdown)
		? expandLoopBlocksInDocument(normalizedMarkdown, initialConfig, {})
		: normalizedMarkdown;
	const ast = Markdoc.parse(effectiveMarkdown);
	const config = buildMarkdocConfig(effectiveMarkdown, cells);
	const validationErrors = Markdoc.validate(ast, config)
		.filter((e) => e.error.level === 'critical' || e.error.level === 'error')
		.map((e) => e.error.message);
	const transformed = Markdoc.transform(ast, config);
	const tree = Array.isArray(transformed) ? transformed : [transformed];
	return { tree, errors: [...new Set(validationErrors)] };
}

/** Returns top-level $outputName roots referenced in markdown (tags + inline prose). */
export function extractBareMarkdocRefRoots(markdown: string): string[] {
	const names = new Set<string>();
	for (const m of markdown.matchAll(/\$([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)?/g)) {
		names.add(m[1]);
	}
	return [...names];
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
