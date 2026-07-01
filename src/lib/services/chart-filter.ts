/** Map a Plotly click payload to a filter value string. */
export function plotlyClickToFilterValue(point: {
	x?: unknown;
	y?: unknown;
	label?: unknown;
	customdata?: unknown;
}): string | null {
	const candidates = [point.x, point.label, point.customdata];
	for (const c of candidates) {
		if (c === null || c === undefined) continue;
		if (typeof c === 'string' && c.trim()) return c;
		if (typeof c === 'number' && !Number.isNaN(c)) return String(c);
		if (c instanceof Date) return c.toISOString().slice(0, 10);
	}
	return null;
}

export interface ChartFilterBinding {
	param: string;
	column: string;
}

/** Resolve filter param/column from chart markdoc attrs. */
export function resolveChartFilterBinding(attrs: {
	filterParam?: string;
	filterColumn?: string;
	xColumn?: string;
}): ChartFilterBinding | null {
	const param = attrs.filterParam?.trim();
	if (!param) return null;
	const column = attrs.filterColumn?.trim() || attrs.xColumn?.trim() || param;
	return { param, column };
}

/** Toggle filter: same value clears selection. */
export function toggleFilterValue(current: string, next: string): string {
	if (!next) return '';
	return current === next ? '' : next;
}
