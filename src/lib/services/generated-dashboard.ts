import type { AIChatCell } from '$lib/types/ai-chat.js';
import type {
	ThresholdOp,
	ConditionalTone,
	ConditionalIcon
} from './report-table-conditional-format';
import { DASHBOARD_ICON_NAMES, isDashboardIconName } from './dashboard-icons';

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
	| { type: 'divider' }
	| {
			type: 'grid';
			cols?: number;
			gap?: 'compact' | 'default' | 'comfortable';
			/** Alternating row tint — for stacked layout="row" metric lists (stat rails). */
			striped?: boolean;
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
			/** Lucide icon name from the dashboard icon allowlist — rendered in the title row. */
			icon?: string;
			/** Grid column span (1-4) when this card sits inside a grid. */
			span?: number;
			blocks: GeneratedDashboardBlock[];
	  }
	| {
			type: 'metric';
			value: DashboardValue;
			label: string;
			format?: 'number' | 'currency' | 'compact' | 'percent' | 'date';
			vs?: DashboardValue;
			/** hero = unboxed display numeral (one per dashboard); compact = small support stat. */
			size?: 'hero' | 'default' | 'compact';
			/** row = icon · label · dotted leader · value line item (stat-rail rows). */
			layout?: 'tile' | 'row';
			/** Lucide icon name from the dashboard icon allowlist. */
			icon?: string;
			/** Repeat `icon` this many times — isotype/pictogram display (max 60). */
			iconCount?: number;
			/** With iconCount: total icons drawn; iconCount are filled, the rest muted (waffle). */
			iconTotal?: number;
			/** Semantic tone for the value/icon. Theme palette only. */
			accent?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
			/** Grid column span (1-4) when this metric sits inside a grid. */
			span?: number;
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
			/** Highlight cells based on their value — one entry per column, same rule shapes as the
			 * Conditional Format UI (VisualBlockInspector). */
			conditionalFormats?: Array<{
				column: string;
				rules: Array<
					| {
							type: 'threshold';
							op: ThresholdOp;
							value?: string | number | boolean | null;
							value2?: string | number | boolean | null;
							tone?: ConditionalTone;
							icon?: ConditionalIcon;
					  }
					| {
							type: 'colorScale';
							minColor?: ConditionalTone;
							midColor?: ConditionalTone;
							maxColor?: ConditionalTone;
							min?: number | null;
							max?: number | null;
							mid?: number | null;
					  }
					| { type: 'dataBar'; tone?: ConditionalTone; min?: number | null; max?: number | null }
					| {
							type: 'iconSet';
							negativeTone?: ConditionalTone;
							positiveTone?: ConditionalTone;
							neutralTone?: ConditionalTone;
					  }
				>;
			}>;
	  }
	| {
			type: 'badge';
			value: DashboardValue;
			color?: 'info' | 'success' | 'warning' | 'error' | 'neutral';
			/** Grid column span (1-4) when this badge sits inside a grid. */
			span?: number;
	  }
	| {
			type: 'progress';
			value: DashboardValue;
			/** Defaults to 100 at render time when omitted. */
			max?: DashboardValue;
			label?: string;
			color?: 'info' | 'success' | 'warning' | 'error';
			/** Grid column span (1-4) when this progress bar sits inside a grid. */
			span?: number;
	  }
	| {
			type: 'callout';
			variant?: 'info' | 'success' | 'warning' | 'error';
			title?: string;
			/** Lucide icon name from the allowlist — overrides the variant's default icon. */
			icon?: string;
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
	  }
	| { type: 'toc' }
	| {
			type: 'math';
			latex: string;
			/** Centered display block vs inline. */
			display?: boolean;
	  }
	| {
			type: 'video';
			src: string;
			poster?: string;
			loop?: boolean;
			muted?: boolean;
	  }
	| {
			type: 'embed';
			url: string;
			aspect?: '16:9' | '4:3' | '1:1';
	  }
	| {
			type: 'bookmark';
			url: string;
			title?: string;
			description?: string;
	  };

export interface CompileDashboardOptions {
	knownCells?: AIChatCell[];
}

export interface CompileDashboardResult {
	markdown: string;
	errors: string[];
}

export const CHART_TYPES = new Set([
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
	'divider',
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
	'conditional',
	'toc',
	'math',
	'video',
	'embed',
	'bookmark'
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
		if (!knownRoots.has(root)) {
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
	if (!knownRoots.has(root)) {
		errors.push(`Unknown ${label} ref "${value}".`);
	}
}

function validateIcon(errors: string[], icon: string | undefined, blockLabel: string): boolean {
	if (icon === undefined) return true;
	if (!isDashboardIconName(icon)) {
		errors.push(
			`Unknown ${blockLabel} icon "${icon}". Supported icons: ${DASHBOARD_ICON_NAMES.join(', ')}.`
		);
		return false;
	}
	return true;
}

function validateSpan(
	errors: string[],
	span: number | undefined,
	blockLabel: string,
	gridCols?: number
): boolean {
	if (span === undefined) return true;
	if (!Number.isInteger(span) || span < 1 || span > 4) {
		errors.push(`${blockLabel} span must be an integer between 1 and 4 (got ${span}).`);
		return false;
	}
	if (gridCols !== undefined && span > gridCols) {
		errors.push(`${blockLabel} span=${span} exceeds its grid's cols=${gridCols}.`);
		return false;
	}
	return true;
}

export const PICTOGRAM_MAX_ICONS = 60;

function renderBlocks(
	blocks: GeneratedDashboardBlock[],
	knownRoots: Set<string>,
	errors: string[]
): string {
	if (!Array.isArray(blocks)) {
		errors.push('Expected an array of blocks but got something else.');
		return '';
	}
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
		case 'divider':
			return '---';
		case 'grid': {
			if (!Array.isArray(block.items) || !block.items.length) {
				errors.push('Grid block must contain at least one item (an array of blocks).');
				return '';
			}
			for (const item of block.items) {
				if (
					item.type === 'chart' ||
					item.type === 'datatable' ||
					item.type === 'mermaid' ||
					item.type === 'columns' ||
					item.type === 'tabs'
				) {
					errors.push(
						`Grid items must be small tiles (metric/badge/progress/card) — put "${item.type}" content in an asymmetric columns block (e.g. width 2 next to width 1) or a top-level block instead.`
					);
				}
			}
			if (block.cols !== undefined && block.cols > 4) {
				errors.push(
					`Grid cols must be 4 or fewer (got ${block.cols}) — split into multiple sections instead of a wide grid.`
				);
			}
			// cols=1 grids are vertical stat rails (layout="row" metric lists) — those read
			// well up to ~8 rows; multi-column grids stay capped at cols×3 tiles.
			const gridItemCap = (block.cols ?? 3) === 1 ? 8 : (block.cols ?? 3) * 3;
			if (block.items.length > gridItemCap) {
				errors.push(
					`Grid has ${block.items.length} items, too many for cols=${block.cols ?? 3} — split into another section or use a datatable.`
				);
			}
			const gridCols = Math.min(block.cols ?? 3, 4);
			for (const item of block.items) {
				if ('span' in item && item.span !== undefined) {
					validateSpan(errors, item.span, `${item.type} in grid`, gridCols);
				}
			}
			return renderContainer(
				'grid',
				block.items
					.map((item) => renderBlock(item, knownRoots, errors))
					.filter(Boolean)
					.join('\n'),
				[
					['cols', block.cols ? String(block.cols) : null],
					['gap', block.gap ? JSON.stringify(block.gap) : null],
					['striped', block.striped ? 'true' : null]
				]
			);
		}
		case 'columns':
			if (!Array.isArray(block.columns) || !block.columns.length) {
				errors.push('Columns block must contain at least one column (an array).');
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
			validateIcon(errors, block.icon, 'card');
			validateSpan(errors, block.span, 'card');
			return renderContainer('card', renderBlocks(block.blocks, knownRoots, errors), [
				['title', block.title ? JSON.stringify(block.title) : null],
				['accent', block.accent ? JSON.stringify(block.accent) : null],
				['icon', block.icon ? JSON.stringify(block.icon) : null],
				['span', block.span != null ? String(block.span) : null]
			]);
		case 'metric': {
			validateRef(errors, block.value, knownRoots, 'metric value');
			validateRef(errors, block.vs, knownRoots, 'metric vs');
			validateIcon(errors, block.icon, 'metric');
			validateSpan(errors, block.span, 'metric');
			if (block.iconCount !== undefined) {
				if (!block.icon) {
					errors.push('Metric iconCount requires an icon.');
				}
				if (
					!Number.isInteger(block.iconCount) ||
					block.iconCount < 1 ||
					block.iconCount > PICTOGRAM_MAX_ICONS
				) {
					errors.push(
						`Metric iconCount must be an integer between 1 and ${PICTOGRAM_MAX_ICONS} (got ${block.iconCount}) — pictograms are for small, countable quantities; use a plain metric for large numbers.`
					);
				}
			}
			if (block.iconTotal !== undefined) {
				if (block.iconCount === undefined) {
					errors.push('Metric iconTotal requires iconCount (the filled portion).');
				} else if (
					!Number.isInteger(block.iconTotal) ||
					block.iconTotal < block.iconCount ||
					block.iconTotal > PICTOGRAM_MAX_ICONS
				) {
					errors.push(
						`Metric iconTotal must be an integer ≥ iconCount and ≤ ${PICTOGRAM_MAX_ICONS} (got ${block.iconTotal}).`
					);
				}
			}
			return renderTag('metric', [
				['value', scalarToAttr(block.value)],
				['label', JSON.stringify(block.label)],
				['format', block.format ? JSON.stringify(block.format) : null],
				['vs', block.vs !== undefined ? scalarToAttr(block.vs) : null],
				['size', block.size && block.size !== 'default' ? JSON.stringify(block.size) : null],
				['layout', block.layout && block.layout !== 'tile' ? JSON.stringify(block.layout) : null],
				['icon', block.icon ? JSON.stringify(block.icon) : null],
				['iconCount', block.iconCount != null ? String(block.iconCount) : null],
				['iconTotal', block.iconTotal != null ? String(block.iconTotal) : null],
				['accent', block.accent ? JSON.stringify(block.accent) : null],
				['span', block.span != null ? String(block.span) : null]
			]);
		}
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
				],
				[
					'conditionalFormats',
					block.conditionalFormats?.length
						? JSON.stringify(
								block.conditionalFormats.map((cf) => ({
									column: cf.column,
									rules: cf.rules.map((r, i) => ({ id: `${cf.column}-${i}`, ...r }))
								}))
							)
						: null
				]
			]);
		case 'badge':
			validateRef(errors, block.value, knownRoots, 'badge value');
			validateSpan(errors, block.span, 'badge');
			return renderTag('badge', [
				['value', scalarToAttr(block.value)],
				['color', block.color ? JSON.stringify(block.color) : null],
				['span', block.span != null ? String(block.span) : null]
			]);
		case 'progress':
			validateRef(errors, block.value, knownRoots, 'progress value');
			validateRef(errors, block.max, knownRoots, 'progress max');
			validateSpan(errors, block.span, 'progress');
			return renderTag('progress', [
				['value', scalarToAttr(block.value)],
				['max', block.max !== undefined ? scalarToAttr(block.max) : null],
				['label', block.label ? JSON.stringify(block.label) : null],
				['color', block.color ? JSON.stringify(block.color) : null],
				['span', block.span != null ? String(block.span) : null]
			]);
		case 'callout':
			validateIcon(errors, block.icon, 'callout');
			return renderContainer('callout', renderBlocks(block.blocks, knownRoots, errors), [
				['type', block.variant ? JSON.stringify(block.variant) : null],
				['title', block.title ? JSON.stringify(block.title) : null],
				['icon', block.icon ? JSON.stringify(block.icon) : null]
			]);
		case 'details':
			return renderContainer('details', renderBlocks(block.blocks, knownRoots, errors), [
				['summary', JSON.stringify(block.summary)],
				['open', block.open ? 'true' : null]
			]);
		case 'tabs':
			if (!Array.isArray(block.tabs) || !block.tabs.length) {
				errors.push('Tabs block must contain at least one tab (an array).');
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
		case 'toc':
			return renderTag('toc', []);
		case 'math':
			return renderTag('math', [
				['latex', JSON.stringify(block.latex)],
				['display', block.display ? 'true' : null]
			]);
		case 'video':
			return renderTag('video', [
				['src', JSON.stringify(block.src)],
				['poster', block.poster ? JSON.stringify(block.poster) : null],
				['loop', block.loop ? 'true' : null],
				['muted', block.muted ? 'true' : null]
			]);
		case 'embed':
			return renderTag('embed', [
				['url', JSON.stringify(block.url)],
				['aspect', block.aspect ? JSON.stringify(block.aspect) : null]
			]);
		case 'bookmark':
			return renderTag('bookmark', [
				['url', JSON.stringify(block.url)],
				['title', block.title ? JSON.stringify(block.title) : null],
				['description', block.description ? JSON.stringify(block.description) : null]
			]);
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

// 'markdown' is a natural, common model guess for the prose block type (arguably more intuitive
// than 'text', since the block literally holds Markdoc/markdown prose) — found live against a
// real model failing its very first patch on exactly this, via the parallel typed-block compiler
// in notebook-blueprint.ts. Normalize recursively (at any nesting depth) rather than rejecting,
// same alias pattern as filter's legacy 'multi' -> 'multi-select'.
function normalizeBlockTypeAliases(block: GeneratedDashboardBlock): GeneratedDashboardBlock {
	const normalized =
		(block as { type?: unknown }).type === 'markdown'
			? ({ ...(block as object), type: 'text' } as GeneratedDashboardBlock)
			: block;
	switch (normalized.type) {
		case 'grid':
			return { ...normalized, items: normalized.items.map(normalizeBlockTypeAliases) };
		case 'columns':
			return {
				...normalized,
				columns: normalized.columns.map((column) => ({
					...column,
					blocks: column.blocks.map(normalizeBlockTypeAliases)
				}))
			};
		case 'card':
		case 'callout':
		case 'details':
			return { ...normalized, blocks: normalized.blocks.map(normalizeBlockTypeAliases) };
		case 'tabs':
			return {
				...normalized,
				tabs: normalized.tabs.map((tab) => ({
					...tab,
					blocks: tab.blocks.map(normalizeBlockTypeAliases)
				}))
			};
		default:
			return normalized;
	}
}

export function compileGeneratedDashboard(
	rawDefinition: GeneratedDashboardDefinition,
	options: CompileDashboardOptions = {}
): CompileDashboardResult {
	const definition: GeneratedDashboardDefinition = {
		...rawDefinition,
		blocks: Array.isArray(rawDefinition.blocks)
			? rawDefinition.blocks.map(normalizeBlockTypeAliases)
			: rawDefinition.blocks
	};
	const knownRoots = new Set((options.knownCells ?? []).map((cell) => cell.outputName));
	const errors: string[] = [];

	if (!Array.isArray(definition.blocks) || definition.blocks.length === 0) {
		errors.push('Generated dashboard must contain at least one block.');
	}

	if (definition.statusBadge) {
		validateRef(errors, definition.statusBadge.value, knownRoots, 'status badge value');
	}

	if (
		!definition.title?.trim() &&
		Array.isArray(definition.blocks) &&
		definition.blocks.length >= 4
	) {
		const hasHeading = definition.blocks.some(
			(block) => block.type === 'text' && /^#{1,6}\s/m.test(block.content)
		);
		if (!hasHeading) {
			errors.push(
				'Dashboard has 4+ top-level blocks but no title and no heading — add a title or a "## Section" heading in a text block so the report has structure.'
			);
		}
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
	return `A "dashboard" typed payload is for a SINGLE markdown cell that needs a dense KPI-tile
summary, a status callout, or an interactive filter — NOT the primary way to build a report.
Prefer curating the notebook itself (reorder/hide existing query cells, insert short narrative
markdown cells between them — see the workflow) so Report view shows real cells with their own
charts. Reach for this payload only when content doesn't map to an existing cell.

DESIGN PRINCIPLES — a dashboard is an infographic, not a form dump:
- Exactly ONE hero number per dashboard ("size":"hero") — the figure the whole report is about.
  Demote its neighbors to "size":"compact". A wall of equal tiles reads as generated, not designed.
- Section with "## CAPS HEADERS" in text blocks (they render as ruled, tracked section headers)
  and "---" dividers. "### small kicker" renders as a quiet caps eyebrow — use one above the title.
- Icons only where they sharpen meaning (≤3-4 per dashboard, never decoratively on every tile).
- Asymmetry beats symmetry: a 2:1 columns split (wide chart beside a stacked rail of compact
  metrics) reads as designed; a uniform 3-grid reads as default output.
- "> quoted lines" render as serif-italic captions — use for source notes and asides.

LAYOUT PATTERNS (compose these, don't invent):
- Masthead: text block "### quarterly revenue review\\n# Churn Ate Q3\\nOne-line stance." then {"type":"divider"}.
- Hero + stat rail: {"type":"columns","columns":[{"width":2,"blocks":[hero metric, chart]},{"blocks":[{"type":"grid","cols":1,"gap":"compact","striped":true,"items":[3-6 {"layout":"row","icon":..} metrics]}]}]}
- Hero pair: two hero metrics side-by-side in 2 columns (e.g. "+20 JOBS" vs "-2,000 JOBS").
- Pictogram stat: {"type":"metric","icon":"Users","iconCount":3,"iconTotal":10,"value":3,"label":"of 10 regions at quota"} — filled-vs-muted icon row (waffle). Only for small countable quantities (≤60 icons).
- Breakdown panel: {"type":"card","title":"WHERE REVENUE WENT","accent":"info","blocks":[pie chart, compact metric row]}.

Worked example (masthead → hero+rail → evidence → caveat):
"cellType":"markdown",
"dashboard":{
  "title":"Q3 Revenue Slipped 8% on Churn in the SMB Segment",
  "blocks":[
    {"type":"text","content":"### q3 2026 revenue review\\nSMB churn drove the shortfall — enterprise held steady. Two levers below."},
    {"type":"columns","columns":[
      {"width":2,"blocks":[
        {"type":"metric","value":"$monthly_revenue.total_revenue","label":"Q3 Revenue","format":"currency","vs":"$monthly_revenue.prior_total","size":"hero"},
        {"type":"chart","ref":"$monthly_revenue","chartType":"line"}
      ]},
      {"blocks":[{"type":"grid","cols":1,"gap":"compact","striped":true,"items":[
        {"type":"metric","value":"$orders.count","label":"Orders","layout":"row","icon":"ShoppingCart"},
        {"type":"metric","value":"$churned.count","label":"Churned SMB accts","layout":"row","icon":"Users","accent":"error"},
        {"type":"metric","value":"$quota_attainment.attainment_pct","label":"Quota %","format":"percent","layout":"row","icon":"Target"}
      ]}]}
    ]},
    {"type":"text","content":"## WHERE THE SHORTFALL CAME FROM"},
    {"type":"columns","columns":[
      {"width":2,"blocks":[{"type":"chart","data":"$segment_revenue.rows","chartType":"bar-horizontal","x":"segment","y":"delta"}]},
      {"blocks":[{"type":"datatable","data":"$top_products.rows","cols":["product","total_revenue"],"limit":10}]}
    ]},
    {"type":"callout","variant":"warning","title":"Data quality","icon":"Database","blocks":[{"type":"text","content":"12% of $orders.rows are missing customer_id — likely guest checkout, excluded from the churn calc."}]}
  ]
}
Note the shape: a title stating the actual finding (not a generic "Executive Summary" label), a
kicker line, one hero number with a compact icon stat rail beside it (not a wall of equal tiles),
a ruled CAPS section header before the evidence, and a callout used for a genuine caveat.

Block grammar — every supported type with its fields ("?" = optional; [blocks] = nested block array, containers nest arbitrarily, e.g. grid inside tabs inside card):
- {"type":"text","content":"markdown prose; may embed $ref live values"}
- {"type":"divider"} — horizontal rule to visually separate sections
- {"type":"grid","cols":3?,"gap":"compact|default|comfortable"?,"striped":true? (alternating row bands — for cols=1 stat rails),"items":[blocks]}
- {"type":"columns","gap":?,"columns":[{"width":2 or "300px"?,"blocks":[blocks]}]}
- {"type":"card","title":?,"accent":"neutral|info|success|warning|error"?,"icon":"IconName"?,"span":2? (grid col span 1-4),"blocks":[blocks]}
- {"type":"metric","value":"$m.field","label":"...","format":"number|currency|compact|percent|date"?,"vs":"$prev.field"?,"size":"hero|default|compact"?,"layout":"row"? (icon·label·leader·value line item),"icon":"IconName"?,"iconCount":n? (pictogram: repeat icon n times, needs icon),"iconTotal":n? (waffle: iconCount filled of iconTotal),"accent":"info|success|warning|error|neutral"?,"span":2?}
- {"type":"chart","ref":"$cellName"? (inherits that cell's configured chart),"chartType":?,"data":"$m.rows"?,"x":?,"y":?,"yColumns":[..]?,"colorColumn":?,"seriesMode":"auto|grouped|stacked"?,"sortOrder":?,"title":?,"height":?}
- {"type":"datatable","data":"$m.rows","cols":[..]?,"limit":?,"pageSize":?,"headerInsights":"full|compact"?,"linkedFilter":?, pivot/summary: "index":["col"]?,"pivotBy":?,"valueCol":?,"agg":"sum|avg|min|max|count"?,"round":?,"valueFormatKind":"currency|percentage|number|date|..."?,"valueCurrencySymbol":?, "conditionalFormats":[{"column":"col","rules":[{"type":"threshold","op":"<|<=|=|!=|>=|>","value":100,"tone":"positive|negative|warning|info|neutral"}]}]? (highlight cells by value — also supports rule types "colorScale"{minColor,midColor,maxColor,min,mid,max}, "dataBar"{tone,min,max}, "iconSet"{negativeTone,positiveTone,neutralTone})}
- {"type":"badge","value":"$m.status","color":"info|success|warning|error|neutral"?,"span":2?}
- {"type":"progress","value":"$m.done","max":100? (default 100),"label":?,"color":?,"span":2?}
- {"type":"callout","variant":"info|success|warning|error"?,"title":? (optional heading above the body),"icon":"IconName"? (overrides the variant default),"blocks":[blocks]}
- {"type":"details","summary":"...","open":false?,"blocks":[blocks]}
- {"type":"tabs","tabs":[{"label":"...","blocks":[blocks]}]}
- {"type":"filter","kind":"dropdown|searchable-dropdown|multi-select|text-input|button-group|date-range|relative-date|numeric-range"?,"param":"name","label":"...","options":[..]?,"optionsColumn":? (derive options from data),"default":?, date-range: "startParam"/"endParam", numeric-range: "minParam"/"maxParam"}
- {"type":"mermaid","code":"flowchart LR\\n..."} or {"type":"mermaid","codeRef":"$m.diagram_text"} — code may embed {% each %}/{% group %} loop tags for data-driven diagrams
- {"type":"each","data":"$m.rows","template":"one line per row using bare $column tokens"}
- {"type":"group","data":"$m.rows","by":"column","order":["A","B"]?,"template":"per-group template; $key + $column tokens"}
- {"type":"conditional","test":{"op":"gt|gte|lt|lte|equals","left":"$m.count","right":0},"then":[blocks],"else":[blocks]?}
- {"type":"toc"} — table of contents from this notebook's headings
- {"type":"math","latex":"E = mc^2","display":true?} — KaTeX equation
- {"type":"video","src":"https://...","poster":?,"loop":?,"muted":?}
- {"type":"embed","url":"https://...","aspect":"16:9|4:3|1:1"?} — YouTube/Vimeo/Loom, or a link-card fallback for other hosts
- {"type":"bookmark","url":"https://...","title":?,"description":?} — link preview card

Rules:
- Always reference existing SQL/Python result cells via $outputName or $outputName.field.
- Never use $cell placeholders.
- Never reference stg_ cells in dashboards.
- If you send "dashboard", do not also hand-author raw Markdoc in "markdown".
- Unknown block types are compile errors — use only the grammar above.
- grid items must be small tiles only (metric/badge/progress/card) — a chart/datatable/mermaid/
  columns/tabs inside a grid item is a compile error; put wide content in an asymmetric columns
  block instead. grid cols must be ≤4, and item count should fit cols×3 or fewer.
- A dashboard with 4+ top-level blocks needs a "title" or a "## Heading" inside a text block —
  a flat wall of blocks with no heading is a compile error.
- "icon" must be one of: ${DASHBOARD_ICON_NAMES.join(', ')}. Unknown names are compile errors.
- "iconCount"/"iconTotal" cap at 60 — pictograms are for countable quantities, not large numbers.
- "span" must be 1-4 and fit within the parent grid's cols.
- One "size":"hero" metric per dashboard; use "compact" for its supporting stats.`;
}
