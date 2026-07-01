import Markdoc from '@markdoc/markdoc';

export type FilterWidgetKind =
	| 'dropdown'
	| 'text-input'
	| 'date-range'
	| 'button-group'
	| 'multi-select'
	| 'relative-date'
	| 'numeric-range'
	| 'searchable-dropdown';

export interface ReportFilterDef {
	kind: FilterWidgetKind;
	param: string;
	label?: string;
	options?: unknown[];
	optionsColumn?: string;
	defaultValue?: string;
	startParam?: string;
	endParam?: string;
	minParam?: string;
	maxParam?: string;
}

function readFilterAttrs(attrs: Record<string, unknown>): ReportFilterDef | null {
	const param = typeof attrs.param === 'string' ? attrs.param : '';
	if (!param) return null;
	const kind = (typeof attrs.kind === 'string' ? attrs.kind : 'dropdown') as FilterWidgetKind;
	return {
		kind,
		param,
		label: typeof attrs.label === 'string' ? attrs.label : undefined,
		options: Array.isArray(attrs.options) ? attrs.options : undefined,
		optionsColumn: typeof attrs.optionsColumn === 'string' ? attrs.optionsColumn : undefined,
		defaultValue:
			typeof attrs.defaultValue === 'string'
				? attrs.defaultValue
				: typeof attrs.default === 'string'
					? attrs.default
					: undefined,
		startParam: typeof attrs.startParam === 'string' ? attrs.startParam : undefined,
		endParam: typeof attrs.endParam === 'string' ? attrs.endParam : undefined,
		minParam: typeof attrs.minParam === 'string' ? attrs.minParam : undefined,
		maxParam: typeof attrs.maxParam === 'string' ? attrs.maxParam : undefined
	};
}

/** Collect unique filter widgets from one or more markdown strings (document order). */
export function extractReportFilters(markdowns: string[]): ReportFilterDef[] {
	const seen = new Set<string>();
	const out: ReportFilterDef[] = [];
	for (const md of markdowns) {
		if (!md?.trim()) continue;
		const ast = Markdoc.parse(md);
		for (const node of ast.walk()) {
			if (node.tag !== 'filter') continue;
			const def = readFilterAttrs(node.attributes as Record<string, unknown>);
			if (!def || seen.has(def.param)) continue;
			seen.add(def.param);
			out.push(def);
		}
	}
	return out;
}

/** Active filter chips for report chrome (non-empty values only). */
export function activeFilterChips(
	filters: Record<string, string>,
	labelByParam: Map<string, string>
): { param: string; label: string; value: string }[] {
	return Object.entries(filters)
		.filter(([, v]) => v !== '')
		.map(([param, value]) => ({
			param,
			label: labelByParam.get(param) ?? param,
			value
		}));
}
