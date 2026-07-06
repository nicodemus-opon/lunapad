import type { AIChatCell } from '$lib/types/ai-chat.js';

type DashboardRef = `$${string}`;
type DashboardScalar = string | number | boolean;
type DashboardValue = DashboardScalar | DashboardRef;
type DashboardCompareOp = 'gt' | 'gte' | 'lt' | 'lte' | 'equals';

export interface GeneratedDashboardDefinition {
	title?: string;
	statusBadge?: {
		value: DashboardValue;
		color?: 'info' | 'success' | 'warning' | 'error' | 'neutral';
	};
	blocks: GeneratedDashboardBlock[];
}

export type GeneratedDashboardBlock =
	| { type: 'text'; content: string }
	| {
			type: 'grid';
			cols?: number;
			gap?: 'compact' | 'default' | 'comfortable';
			items: GeneratedDashboardBlock[];
	  }
	| {
			type: 'columns';
			gap?: 'compact' | 'default' | 'comfortable';
			columns: Array<{ width?: number | string; blocks: GeneratedDashboardBlock[] }>;
	  }
	| {
			type: 'card';
			title?: string;
			accent?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
			blocks: GeneratedDashboardBlock[];
	  }
	| {
			type: 'metric';
			value: DashboardValue;
			label: string;
			format?: 'number' | 'currency' | 'compact' | 'percent';
			vs?: DashboardValue;
	  }
	| {
			type: 'chart';
			ref?: DashboardRef;
			chartType?:
				| 'table'
				| 'big-value'
				| 'delta'
				| 'value'
				| 'line'
				| 'bar'
				| 'bar-horizontal'
				| 'area'
				| 'scatter'
				| 'bubble'
				| 'pie'
				| 'histogram'
				| 'heatmap'
				| 'calendar-heatmap'
				| 'funnel'
				| 'box-plot'
				| 'sankey'
				| 'map'
				| 'choropleth'
				| 'custom'
				| 'sparkline';
			data?: DashboardRef;
			x?: string;
			y?: string;
			yColumns?: string[];
			yColumnsSecondary?: string[];
			colorColumn?: string;
			sizeColumn?: string;
			lat?: string;
			lon?: string;
			geoScope?: 'world' | 'usa-states';
			seriesMode?: 'auto' | 'grouped' | 'stacked';
			sortOrder?: 'none' | 'asc' | 'desc';
			histogramBins?: number;
			title?: string;
			code?: string;
			height?: number;
	  }
	| {
			type: 'datatable';
			data: DashboardRef;
			cols?: string[];
			limit?: number;
			pageSize?: number;
			headerInsights?: 'full' | 'compact';
			linkedFilter?: string;
			/** Group-by / pivot index columns — renders a summary/pivot table instead of raw rows. */
			index?: string[];
			pivotBy?: string;
			valueCol?: string;
			agg?: 'sum' | 'avg' | 'min' | 'max' | 'count';
			round?: number;
			valueFormatKind?:
				| 'boolean'
				| 'id'
				| 'email'
				| 'url'
				| 'datetime'
				| 'date'
				| 'percentage'
				| 'currency'
				| 'number'
				| 'category'
				| 'text';
			valueCurrencySymbol?: string;
	  }
	| {
			type: 'badge';
			value: DashboardValue;
			color?: 'info' | 'success' | 'warning' | 'error' | 'neutral';
	  }
	| {
			type: 'progress';
			value: DashboardValue;
			/** Defaults to 100 at render time when omitted. */
			max?: DashboardValue;
			label?: string;
			color?: 'info' | 'success' | 'warning' | 'error';
	  }
	| {
			type: 'callout';
			variant?: 'info' | 'success' | 'warning' | 'error';
			blocks: GeneratedDashboardBlock[];
	  }
	| {
			type: 'details';
			summary: string;
			open?: boolean;
			blocks: GeneratedDashboardBlock[];
	  }
	| {
			type: 'tabs';
			tabs: Array<{ label: string; blocks: GeneratedDashboardBlock[] }>;
	  }
	| {
			type: 'filter';
			/** 'multi' is a legacy alias normalized to 'multi-select'. */
			kind?:
				| 'dropdown'
				| 'searchable-dropdown'
				| 'multi-select'
				| 'multi'
				| 'text-input'
				| 'button-group'
				| 'date-range'
				| 'relative-date'
				| 'numeric-range';
			param: string;
			label: string;
			options?: string[];
			/** Derive options from this column of the filtered data instead of a static list. */
			optionsColumn?: string;
			default?: string;
			/** date-range only */
			startParam?: string;
			endParam?: string;
			/** numeric-range only */
			minParam?: string;
			maxParam?: string;
	  }
	| {
			type: 'mermaid';
			/** Static Mermaid source. May embed {% each %}/{% group %} loop tags for data-driven diagrams. */
			code?: string;
			/** Read the Mermaid source from a cell field, e.g. "$pipeline.diagram_text". */
			codeRef?: DashboardRef;
	  }
	| {
			/** Repeat a text template once per row of `data`. Template uses bare $column tokens. */
			type: 'each';
			data: DashboardRef;
			template: string;
	  }
	| {
			/** Group rows by a column and repeat the template once per group ($key + row $column tokens). */
			type: 'group';
			data: DashboardRef;
			by: string;
			order?: string[];
			template: string;
	  }
	| {
			type: 'conditional';
			test: {
				op: DashboardCompareOp;
				left: DashboardValue;
				right: DashboardValue;
			};
			then: GeneratedDashboardBlock[];
			else?: GeneratedDashboardBlock[];
	  };

export interface CompileDashboardOptions {
	knownCells?: AIChatCell[];
}

export interface CompileDashboardResult {
	markdown: string;
	errors: string[];
}

const CHART_TYPES = new Set([
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
	'custom',
	'sparkline'
]);

export const SUPPORTED_BLOCK_TYPES = [
	'text',
	'grid',
	'columns',
	'card',
	'metric',
	'chart',
	'datatable',
	'badge',
	'progress',
	'callout',
	'details',
	'tabs',
	'filter',
	'mermaid',
	'each',
	'group',
	'conditional'
] as const;

/** Must stay in sync with the filter tag's `kind.matches` list in markdoc-interp.ts
 *  (cross-checked by generated-dashboard.test.ts). */
export const FILTER_KINDS = new Set([
	'dropdown',
	'text-input',
	'date-range',
	'button-group',
	'multi-select',
	'relative-date',
	'numeric-range',
	'searchable-dropdown'
]);

function isRef(value: unknown): value is DashboardRef {
	return typeof value === 'string' && /^\$[A-Za-z_]\w*(?:\.[A-Za-z_][\w]*)*$/.test(value);
}

function refRoot(ref: string): string | null {
	const match = ref.match(/^\$([A-Za-z_]\w*)/);
	return match ? match[1] : null;
}

function scalarToAttr(value: DashboardValue): string {
	if (isRef(value)) return value;
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return String(value);
}

function stringListToAttr(values: string[]): string {
	return `[${values.map((v) => JSON.stringify(v)).join(',')}]`;
}

function renderTag(tag: string, attrs: Array<[string, string | null | undefined]>): string {
	const renderedAttrs = attrs
		.filter(([, value]) => value != null && value !== '')
		.map(([name, value]) => `${name}=${value}`)
		.join(' ');
	return renderedAttrs ? `{% ${tag} ${renderedAttrs} /%}` : `{% ${tag} /%}`;
}

function renderContainer(
	tag: string,
	inner: string,
	attrs: Array<[string, string | null | undefined]> = []
): string {
	const renderedAttrs = attrs
		.filter(([, value]) => value != null && value !== '')
		.map(([name, value]) => `${name}=${value}`)
		.join(' ');
	const open = renderedAttrs ? `{% ${tag} ${renderedAttrs} %}` : `{% ${tag} %}`;
	return `${open}\n${inner}\n{% /${tag} %}`;
}

function pushStringRefs(errors: string[], text: string, knownRoots: Set<string>): void {
	for (const match of text.matchAll(/\$([A-Za-z_]\w*)/g)) {
		const root = match[1];
		if (root === 'cell') {
			errors.push('Placeholder $cell ref is not allowed in generated dashboards.');
			continue;
		}
		if (root.startsWith('stg_')) {
			errors.push(`Reporting dashboard cannot reference staging cell "${root}".`);
			continue;
		}
		if (knownRoots.size > 0 && !knownRoots.has(root)) {
			errors.push(`Unknown dashboard ref "${root}".`);
		}
	}
}

function validateRef(
	errors: string[],
	value: DashboardValue | undefined,
	knownRoots: Set<string>,
	label: string
): void {
	if (value === undefined || !isRef(value)) return;
	const root = refRoot(value);
	if (!root) {
		errors.push(`Invalid ${label} ref "${value}".`);
		return;
	}
	if (root === 'cell') {
		errors.push(`Placeholder ${label} ref "${value}" is not allowed.`);
		return;
	}
	if (root.startsWith('stg_')) {
		errors.push(`Reporting dashboard cannot reference staging cell "${root}".`);
		return;
	}
	if (knownRoots.size > 0 && !knownRoots.has(root)) {
		errors.push(`Unknown ${label} ref "${value}".`);
	}
}

function renderBlocks(
	blocks: GeneratedDashboardBlock[],
	knownRoots: Set<string>,
	errors: string[]
): string {
	return blocks
		.map((block) => renderBlock(block, knownRoots, errors))
		.filter(Boolean)
		.join('\n\n');
}

function renderBlock(
	block: GeneratedDashboardBlock,
	knownRoots: Set<string>,
	errors: string[]
): string {
	switch (block.type) {
		case 'text':
			pushStringRefs(errors, block.content, knownRoots);
			return block.content.trim();
		case 'grid':
			if (!block.items.length) {
				errors.push('Grid block must contain at least one item.');
				return '';
			}
			return renderContainer(
				'grid',
				block.items
					.map((item) => renderBlock(item, knownRoots, errors))
					.filter(Boolean)
					.join('\n'),
				[
					['cols', block.cols ? String(block.cols) : null],
					['gap', block.gap ? JSON.stringify(block.gap) : null]
				]
			);
		case 'columns':
			if (!block.columns.length) {
				errors.push('Columns block must contain at least one column.');
				return '';
			}
			return renderContainer(
				'columns',
				block.columns
					.map((column) =>
						renderContainer('column', renderBlocks(column.blocks, knownRoots, errors), [
							[
								'width',
								column.width == null
									? null
									: typeof column.width === 'number'
										? String(column.width)
										: JSON.stringify(column.width)
							]
						])
					)
					.join('\n'),
				[['gap', block.gap ? JSON.stringify(block.gap) : null]]
			);
		case 'card':
			return renderContainer('card', renderBlocks(block.blocks, knownRoots, errors), [
				['title', block.title ? JSON.stringify(block.title) : null],
				['accent', block.accent ? JSON.stringify(block.accent) : null]
			]);
		case 'metric':
			validateRef(errors, block.value, knownRoots, 'metric value');
			validateRef(errors, block.vs, knownRoots, 'metric vs');
			return renderTag('metric', [
				['value', scalarToAttr(block.value)],
				['label', JSON.stringify(block.label)],
				['format', block.format ? JSON.stringify(block.format) : null],
				['vs', block.vs !== undefined ? scalarToAttr(block.vs) : null]
			]);
		case 'chart':
			if (block.chartType && !CHART_TYPES.has(block.chartType)) {
				errors.push(`Unsupported chart type "${block.chartType}".`);
				return '';
			}
			if (!block.ref && !block.data) {
				errors.push('Chart block requires either ref or data.');
				return '';
			}
			validateRef(errors, block.ref, knownRoots, 'chart ref');
			validateRef(errors, block.data, knownRoots, 'chart data');
			return renderTag('chart', [
				['ref', block.ref ?? null],
				['type', block.chartType ? JSON.stringify(block.chartType) : null],
				['data', block.data ?? null],
				['x', block.x ? JSON.stringify(block.x) : null],
				['y', block.y ? JSON.stringify(block.y) : null],
				['yColumns', block.yColumns?.length ? stringListToAttr(block.yColumns) : null],
				[
					'yColumnsSecondary',
					block.yColumnsSecondary?.length ? stringListToAttr(block.yColumnsSecondary) : null
				],
				['colorColumn', block.colorColumn ? JSON.stringify(block.colorColumn) : null],
				['sizeColumn', block.sizeColumn ? JSON.stringify(block.sizeColumn) : null],
				['lat', block.lat ? JSON.stringify(block.lat) : null],
				['lon', block.lon ? JSON.stringify(block.lon) : null],
				['geoScope', block.geoScope ? JSON.stringify(block.geoScope) : null],
				['seriesMode', block.seriesMode ? JSON.stringify(block.seriesMode) : null],
				['sortOrder', block.sortOrder ? JSON.stringify(block.sortOrder) : null],
				['histogramBins', block.histogramBins != null ? String(block.histogramBins) : null],
				['title', block.title ? JSON.stringify(block.title) : null],
				['code', block.code ? JSON.stringify(block.code) : null],
				['height', block.height != null ? String(block.height) : null]
			]);
		case 'datatable':
			validateRef(errors, block.data, knownRoots, 'datatable data');
			return renderTag('datatable', [
				['data', block.data],
				['cols', block.cols?.length ? stringListToAttr(block.cols) : null],
				['limit', block.limit != null ? String(block.limit) : null],
				['pageSize', block.pageSize != null ? String(block.pageSize) : null],
				['headerInsights', block.headerInsights ? JSON.stringify(block.headerInsights) : null],
				['linkedFilter', block.linkedFilter ? JSON.stringify(block.linkedFilter) : null],
				['index', block.index?.length ? stringListToAttr(block.index) : null],
				['pivotBy', block.pivotBy ? JSON.stringify(block.pivotBy) : null],
				['valueCol', block.valueCol ? JSON.stringify(block.valueCol) : null],
				['agg', block.agg ? JSON.stringify(block.agg) : null],
				['round', block.round != null ? String(block.round) : null],
				['valueFormatKind', block.valueFormatKind ? JSON.stringify(block.valueFormatKind) : null],
				[
					'valueCurrencySymbol',
					block.valueCurrencySymbol ? JSON.stringify(block.valueCurrencySymbol) : null
				]
			]);
		case 'badge':
			validateRef(errors, block.value, knownRoots, 'badge value');
			return renderTag('badge', [
				['value', scalarToAttr(block.value)],
				['color', block.color ? JSON.stringify(block.color) : null]
			]);
		case 'progress':
			validateRef(errors, block.value, knownRoots, 'progress value');
			validateRef(errors, block.max, knownRoots, 'progress max');
			return renderTag('progress', [
				['value', scalarToAttr(block.value)],
				['max', block.max !== undefined ? scalarToAttr(block.max) : null],
				['label', block.label ? JSON.stringify(block.label) : null],
				['color', block.color ? JSON.stringify(block.color) : null]
			]);
		case 'callout':
			return renderContainer('callout', renderBlocks(block.blocks, knownRoots, errors), [
				['type', block.variant ? JSON.stringify(block.variant) : null]
			]);
		case 'details':
			return renderContainer('details', renderBlocks(block.blocks, knownRoots, errors), [
				['summary', JSON.stringify(block.summary)],
				['open', block.open ? 'true' : null]
			]);
		case 'tabs':
			if (!block.tabs.length) {
				errors.push('Tabs block must contain at least one tab.');
				return '';
			}
			return renderContainer(
				'tabs',
				block.tabs
					.map((tab) =>
						renderContainer('tab', renderBlocks(tab.blocks, knownRoots, errors), [
							['label', JSON.stringify(tab.label)]
						])
					)
					.join('\n'),
				[]
			);
		case 'filter': {
			// 'multi' is a legacy alias older prompts taught — the runtime tag only accepts 'multi-select'.
			const kind = block.kind === 'multi' ? 'multi-select' : (block.kind ?? 'dropdown');
			if (!FILTER_KINDS.has(kind)) {
				errors.push(
					`Unsupported filter kind "${block.kind}". Supported: ${[...FILTER_KINDS].join(', ')}.`
				);
				return '';
			}
			return renderTag('filter', [
				['kind', JSON.stringify(kind)],
				['param', JSON.stringify(block.param)],
				['label', JSON.stringify(block.label)],
				['options', block.options?.length ? stringListToAttr(block.options) : null],
				['optionsColumn', block.optionsColumn ? JSON.stringify(block.optionsColumn) : null],
				['default', block.default ? JSON.stringify(block.default) : null],
				['startParam', block.startParam ? JSON.stringify(block.startParam) : null],
				['endParam', block.endParam ? JSON.stringify(block.endParam) : null],
				['minParam', block.minParam ? JSON.stringify(block.minParam) : null],
				['maxParam', block.maxParam ? JSON.stringify(block.maxParam) : null]
			]);
		}
		case 'mermaid':
			if (block.codeRef) {
				validateRef(errors, block.codeRef, knownRoots, 'mermaid codeRef');
				return renderContainer('mermaid', '', [['code', block.codeRef]]);
			}
			if (!block.code?.trim()) {
				errors.push('Mermaid block requires code or codeRef.');
				return '';
			}
			return renderContainer('mermaid', block.code.trim());
		case 'each':
			validateRef(errors, block.data, knownRoots, 'each data');
			if (!block.template?.trim()) {
				errors.push('Each block requires a non-empty template.');
				return '';
			}
			// Template body uses loop-scoped bare $column tokens — not validated against cell refs.
			return renderContainer('each', block.template.trim(), [['data', block.data]]);
		case 'group':
			validateRef(errors, block.data, knownRoots, 'group data');
			if (!block.by?.trim()) {
				errors.push('Group block requires a "by" column.');
				return '';
			}
			if (!block.template?.trim()) {
				errors.push('Group block requires a non-empty template.');
				return '';
			}
			return renderContainer('group', block.template.trim(), [
				['data', block.data],
				['by', JSON.stringify(block.by)],
				['order', block.order?.length ? stringListToAttr(block.order) : null]
			]);
		case 'conditional':
			validateRef(errors, block.test.left, knownRoots, 'conditional left');
			validateRef(errors, block.test.right, knownRoots, 'conditional right');
			return [
				`{% if ${block.test.op}(${scalarToAttr(block.test.left)}, ${scalarToAttr(block.test.right)}) %}`,
				renderBlocks(block.then, knownRoots, errors),
				block.else?.length ? '{% else /%}\n' + renderBlocks(block.else, knownRoots, errors) : '',
				'{% /if %}'
			]
				.filter(Boolean)
				.join('\n');
		default: {
			// Unknown types must surface as errors — silently dropping a block means the
			// model believes the content was written when it wasn't.
			const unknownType = (block as { type?: unknown }).type;
			errors.push(
				`Unsupported block type "${String(unknownType)}". Supported types: ${SUPPORTED_BLOCK_TYPES.join(', ')}.`
			);
			return '';
		}
	}
}

export function compileGeneratedDashboard(
	definition: GeneratedDashboardDefinition,
	options: CompileDashboardOptions = {}
): CompileDashboardResult {
	const knownRoots = new Set((options.knownCells ?? []).map((cell) => cell.outputName));
	const errors: string[] = [];

	if (!Array.isArray(definition.blocks) || definition.blocks.length === 0) {
		errors.push('Generated dashboard must contain at least one block.');
	}

	if (definition.statusBadge) {
		validateRef(errors, definition.statusBadge.value, knownRoots, 'status badge value');
	}

	const parts: string[] = [];
	if (definition.title?.trim()) parts.push(`## ${definition.title.trim()}`);
	if (definition.statusBadge) {
		parts.push(
			renderTag('badge', [
				['value', scalarToAttr(definition.statusBadge.value)],
				[
					'color',
					definition.statusBadge.color ? JSON.stringify(definition.statusBadge.color) : null
				]
			])
		);
	}
	if (definition.blocks?.length) {
		parts.push(renderBlocks(definition.blocks, knownRoots, errors));
	}

	return {
		markdown: parts.filter(Boolean).join('\n\n').trim(),
		errors: [...new Set(errors)]
	};
}

export function buildGeneratedDashboardPromptBlock(): string {
	return `For dashboard/report markdown cells, prefer a typed dashboard payload over raw Markdoc.

Use create_cell/update_cell with:
"cellType":"markdown",
"dashboard":{
  "title":"Executive Summary",
  "statusBadge":{"value":"Live","color":"success"},
  "blocks":[
    {"type":"grid","cols":3,"items":[
      {"type":"metric","value":"$monthly_revenue.total_revenue","label":"Revenue","format":"currency"},
      {"type":"metric","value":"$orders.count","label":"Orders"},
      {"type":"progress","value":"$quota_attainment.attainment_pct","max":100,"label":"Quota %","color":"success"}
    ]},
    {"type":"tabs","tabs":[
      {"label":"Trend","blocks":[{"type":"chart","ref":"$monthly_revenue","chartType":"line"}]},
      {"label":"Breakdown","blocks":[{"type":"datatable","data":"$top_products.rows","cols":["product","total_revenue"],"limit":10}]}
    ]}
  ]
}

Block grammar — every supported type with its fields ("?" = optional; [blocks] = nested block array, containers nest arbitrarily, e.g. grid inside tabs inside card):
- {"type":"text","content":"markdown prose; may embed $ref live values"}
- {"type":"grid","cols":3?,"gap":"compact|default|comfortable"?,"items":[blocks]}
- {"type":"columns","gap":?,"columns":[{"width":2 or "300px"?,"blocks":[blocks]}]}
- {"type":"card","title":?,"accent":"neutral|info|success|warning|error"?,"blocks":[blocks]}
- {"type":"metric","value":"$m.field","label":"...","format":"number|currency|compact|percent"?,"vs":"$prev.field"?}
- {"type":"chart","ref":"$cellName"? (inherits that cell's configured chart),"chartType":?,"data":"$m.rows"?,"x":?,"y":?,"yColumns":[..]?,"colorColumn":?,"seriesMode":"auto|grouped|stacked"?,"sortOrder":?,"title":?,"height":?}
- {"type":"datatable","data":"$m.rows","cols":[..]?,"limit":?,"pageSize":?,"headerInsights":"full|compact"?,"linkedFilter":?, pivot/summary: "index":["col"]?,"pivotBy":?,"valueCol":?,"agg":"sum|avg|min|max|count"?,"round":?,"valueFormatKind":"currency|percentage|number|date|..."?,"valueCurrencySymbol":?}
- {"type":"badge","value":"$m.status","color":"info|success|warning|error|neutral"?}
- {"type":"progress","value":"$m.done","max":100? (default 100),"label":?,"color":?}
- {"type":"callout","variant":"info|success|warning|error"?,"blocks":[blocks]}
- {"type":"details","summary":"...","open":false?,"blocks":[blocks]}
- {"type":"tabs","tabs":[{"label":"...","blocks":[blocks]}]}
- {"type":"filter","kind":"dropdown|searchable-dropdown|multi-select|text-input|button-group|date-range|relative-date|numeric-range"?,"param":"name","label":"...","options":[..]?,"optionsColumn":? (derive options from data),"default":?, date-range: "startParam"/"endParam", numeric-range: "minParam"/"maxParam"}
- {"type":"mermaid","code":"flowchart LR\\n..."} or {"type":"mermaid","codeRef":"$m.diagram_text"} — code may embed {% each %}/{% group %} loop tags for data-driven diagrams
- {"type":"each","data":"$m.rows","template":"one line per row using bare $column tokens"}
- {"type":"group","data":"$m.rows","by":"column","order":["A","B"]?,"template":"per-group template; $key + $column tokens"}
- {"type":"conditional","test":{"op":"gt|gte|lt|lte|equals","left":"$m.count","right":0},"then":[blocks],"else":[blocks]?}

Rules:
- Always reference existing SQL/Python result cells via $outputName or $outputName.field.
- Never use $cell placeholders.
- Never reference stg_ cells in dashboards.
- If you send "dashboard", do not also hand-author raw Markdoc in "markdown".
- Unknown block types are compile errors — use only the grammar above.`;
}
