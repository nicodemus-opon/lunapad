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
			items: GeneratedDashboardBlock[];
	  }
	| {
			type: 'columns';
			columns: Array<{ blocks: GeneratedDashboardBlock[] }>;
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
	  }
	| {
			type: 'badge';
			value: DashboardValue;
			color?: 'info' | 'success' | 'warning' | 'error' | 'neutral';
	  }
	| {
			type: 'progress';
			value: DashboardValue;
			max: DashboardValue;
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
			kind?: 'dropdown' | 'multi' | 'relative-date';
			param: string;
			label: string;
			options?: string[];
	  }
	| {
			type: 'mermaid';
			code: string;
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
				[['cols', block.cols ? String(block.cols) : null]]
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
						renderContainer('column', renderBlocks(column.blocks, knownRoots, errors))
					)
					.join('\n'),
				[]
			);
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
				['limit', block.limit != null ? String(block.limit) : null]
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
				['max', scalarToAttr(block.max)],
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
		case 'filter':
			return renderTag('filter', [
				['kind', JSON.stringify(block.kind ?? 'dropdown')],
				['param', JSON.stringify(block.param)],
				['label', JSON.stringify(block.label)],
				['options', block.options?.length ? stringListToAttr(block.options) : null]
			]);
		case 'mermaid':
			return renderContainer('mermaid', block.code.trim());
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

Rules:
- Use only these block types: text, grid, columns, metric, chart, datatable, badge, progress, callout, details, tabs, filter, mermaid, conditional.
- Always reference existing SQL/Python result cells via $outputName or $outputName.field.
- Never use $cell placeholders.
- Never reference stg_ cells in dashboards.
- If you send "dashboard", do not also hand-author raw Markdoc in "markdown".`;
}
