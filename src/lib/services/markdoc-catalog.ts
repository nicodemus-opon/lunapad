import { CHART_TYPES, CUSTOM_MARKDOC_TAGS } from '$lib/services/markdoc-interp';
import { WIDGET_SNIPPETS } from '$lib/services/markdown-format';

export interface MarkdownRefColumn {
	name: string;
	type?: string;
}

export interface MarkdownRefEntry {
	cellName: string;
	columns: MarkdownRefColumn[];
}

export interface MarkdocAttrCatalog {
	detail?: string;
	enum?: readonly string[];
	required?: boolean;
}

export interface MarkdocTagCatalogEntry {
	detail: string;
	snippet: string;
	selfClosing?: boolean;
	attributes?: Record<string, MarkdocAttrCatalog>;
}

export interface MarkdocFunctionCatalogEntry {
	signature: string;
	detail: string;
	snippet: string;
}

/** Pseudo-fields available on every $cell variable. */
export const MARKDOC_REF_PSEUDO_FIELDS = [
	{ name: 'rows', detail: 'Full result rows array' },
	{ name: 'count', detail: 'Row count' },
	{ name: 'rowCount', detail: 'Row count (alias)' },
	{ name: 'columns', detail: 'Comma-separated column names' }
] as const;

const chartTypeEnum = [...CHART_TYPES, 'sparkline'] as const;

export const MARKDOC_TAG_CATALOG: Record<string, MarkdocTagCatalogEntry> = {
	metric: {
		detail: 'KPI metric widget',
		snippet: 'metric value=${1:\\$cell.value} label="${2:Label}" vs=${3:\\$prev.value} /%}',
		selfClosing: true,
		attributes: {
			value: { detail: 'Primary value ($cell.field or number)', required: true },
			label: { detail: 'Display label' },
			vs: { detail: 'Comparison value for trend arrow' },
			format: { detail: 'Number format', enum: ['number', 'currency', 'compact', 'percent'] }
		}
	},
	chart: {
		detail: 'Chart from cell data',
		snippet: `chart type="\${1|${chartTypeEnum.join(',')}|}" data=\${2:\\$cell.rows} x="\${3:col_x}" y="\${4:col_y}" /%}`,
		selfClosing: true,
		attributes: {
			ref: { detail: 'Inherit chart config from a query cell ($cell)' },
			type: { detail: 'Chart type', enum: chartTypeEnum },
			data: { detail: 'Row data ($cell.rows)' },
			x: { detail: 'X-axis column' },
			y: { detail: 'Y-axis column' },
			yColumns: { detail: 'Multi-series Y columns' },
			yColumnsSecondary: { detail: 'Secondary Y-axis columns' },
			colorColumn: { detail: 'Color grouping column' },
			sizeColumn: { detail: 'Bubble size column' },
			seriesMode: { detail: 'Bar series mode', enum: ['auto', 'grouped', 'stacked'] },
			sortOrder: { detail: 'Sort order', enum: ['none', 'asc', 'desc'] },
			histogramBins: { detail: 'Histogram bin count' },
			title: { detail: 'Chart title' },
			code: { detail: 'Custom Plotly code (type=custom)' },
			height: { detail: 'Chart height in px' }
		}
	},
	datatable: {
		detail: 'Table from cell data',
		snippet: WIDGET_SNIPPETS.datatable,
		selfClosing: true,
		attributes: {
			data: { detail: 'Row data ($cell.rows)', required: true },
			cols: { detail: 'Columns to show' },
			limit: { detail: 'Max rows' }
		}
	},
	badge: {
		detail: 'Colored status badge',
		snippet: 'badge value=${1:\\$cell.status} color="${2|info,success,warning,error,neutral|}" /%}',
		selfClosing: true,
		attributes: {
			value: { detail: 'Badge text ($cell.field)', required: true },
			color: { detail: 'Badge color', enum: ['info', 'success', 'warning', 'error', 'neutral'] }
		}
	},
	progress: {
		detail: 'Progress bar',
		snippet: 'progress value=${1:\\$cell.completed} max=${2:\\$cell.total} label="${3:Label}" /%}',
		selfClosing: true,
		attributes: {
			value: { detail: 'Current value', required: true },
			max: { detail: 'Maximum value' },
			label: { detail: 'Label text' },
			color: { detail: 'Bar color', enum: ['info', 'success', 'warning', 'error'] }
		}
	},
	columns: {
		detail: 'Multi-column layout',
		snippet: WIDGET_SNIPPETS.columns,
		attributes: {}
	},
	column: {
		detail: 'Single column inside {% columns %}',
		snippet: 'column %}\n${1:Content.}\n{% /column %}',
		attributes: {
			width: { detail: 'Column width (number or CSS)' }
		}
	},
	grid: {
		detail: 'Responsive grid layout',
		snippet: 'grid cols=${1:3} %}\n${2:Content.}\n{% /grid %}',
		attributes: {
			cols: { detail: 'Number of columns' }
		}
	},
	callout: {
		detail: 'Info / warning box',
		snippet: WIDGET_SNIPPETS.callout,
		attributes: {
			type: { detail: 'Callout style', enum: ['info', 'success', 'warning', 'error'] }
		}
	},
	card: {
		detail: 'Bordered card',
		snippet: WIDGET_SNIPPETS.card,
		attributes: {
			title: { detail: 'Card title' }
		}
	},
	details: {
		detail: 'Collapsible section',
		snippet: WIDGET_SNIPPETS.details,
		attributes: {
			summary: { detail: 'Summary label', required: true },
			open: { detail: 'Start expanded' }
		}
	},
	tabs: {
		detail: 'Tabbed sections',
		snippet: WIDGET_SNIPPETS.tabs,
		attributes: {}
	},
	tab: {
		detail: 'Single tab inside {% tabs %}',
		snippet: 'tab label="${1:Tab 1}" %}\n${2:Content.}\n{% /tab %}',
		attributes: {
			label: { detail: 'Tab label', required: true }
		}
	},
	filter: {
		detail: 'Interactive filter widget',
		snippet: WIDGET_SNIPPETS.filter,
		selfClosing: true,
		attributes: {
			kind: {
				detail: 'Filter control type',
				enum: ['dropdown', 'text-input', 'date-range', 'button-group']
			},
			param: { detail: 'Parameter name for ${param} substitution', required: true },
			label: { detail: 'Display label' },
			options: { detail: 'Static option list' },
			optionsColumn: { detail: 'Column to derive options from' },
			default: { detail: 'Default value' }
		}
	},
	mermaid: {
		detail: 'Mermaid diagram (any diagram type)',
		snippet: WIDGET_SNIPPETS.mermaid,
		attributes: {
			code: { detail: 'Diagram source from $cell.field' }
		}
	},
	group: {
		detail: 'Group rows for dynamic Mermaid/templates',
		snippet:
			'group data=${1:\\$cell.rows} by="${2:column}" order=[${3:"A","B"}] %}\n${4:Template body}\n{% /group %}',
		attributes: {
			data: { detail: 'Row array ($cell.rows)', required: true },
			by: { detail: 'Grouping column', required: true },
			order: { detail: 'Lane/column order' }
		}
	},
	each: {
		detail: 'Iterate items inside {% group %}',
		snippet: 'each data=${1:\\$items} %}\n${2:Template body}\n{% /each %}',
		attributes: {
			data: { detail: 'Items array ($items)', required: true }
		}
	},
	if: {
		detail: 'Conditional block',
		snippet:
			'if gt(${1:\\$cell.count}, 0) %}\n${2:Content.}\n{% else /%}\n${3:Fallback.}\n{% /if %}',
		attributes: {}
	},
	else: {
		detail: 'Else branch (must be self-closing)',
		snippet: 'else /%}',
		selfClosing: true,
		attributes: {}
	}
};

export const MARKDOC_FUNCTIONS: Record<string, MarkdocFunctionCatalogEntry> = {
	currency: {
		signature: 'currency(value)',
		detail: 'Format as USD currency',
		snippet: 'currency(${1:\\$cell.value})'
	},
	compact: {
		signature: 'compact(value)',
		detail: 'Compact number (1.5M)',
		snippet: 'compact(${1:\\$cell.value})'
	},
	percent: {
		signature: 'percent(value, decimals?)',
		detail: 'Append % (value already 0–100 scale)',
		snippet: 'percent(${1:\\$cell.pct}, ${2:1})'
	},
	sign: {
		signature: 'sign(value)',
		detail: 'Signed number with +/- prefix',
		snippet: 'sign(${1:\\$cell.delta})'
	},
	formatDate: {
		signature: 'formatDate(value, pattern?)',
		detail: 'Format date (MMM, YYYY, DD tokens)',
		snippet: 'formatDate(${1:\\$cell.date}, "${2:MMM YYYY}")'
	},
	gt: {
		signature: 'gt(a, b)',
		detail: 'Greater than (for {% if %})',
		snippet: 'gt(${1:\\$a}, ${2:0})'
	},
	gte: {
		signature: 'gte(a, b)',
		detail: 'Greater than or equal',
		snippet: 'gte(${1:\\$a}, ${2:0})'
	},
	lt: {
		signature: 'lt(a, b)',
		detail: 'Less than',
		snippet: 'lt(${1:\\$a}, ${2:0})'
	},
	lte: {
		signature: 'lte(a, b)',
		detail: 'Less than or equal',
		snippet: 'lte(${1:\\$a}, ${2:0})'
	}
};

export function getMarkdocTagNames(): string[] {
	return Object.keys(MARKDOC_TAG_CATALOG);
}

export function isSelfClosingTag(tagName: string): boolean {
	return MARKDOC_TAG_CATALOG[tagName]?.selfClosing === true;
}

/** Ensures every custom runtime tag has a catalog entry (for tests). */
export function assertCatalogCompleteness(): void {
	for (const tag of CUSTOM_MARKDOC_TAGS) {
		if (!MARKDOC_TAG_CATALOG[tag]) {
			throw new Error(`Missing catalog entry for custom tag: ${tag}`);
		}
	}
}
