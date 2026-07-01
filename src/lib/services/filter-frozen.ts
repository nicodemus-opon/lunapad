import type { CellDisplay } from '$lib/stores/notebook.svelte';
import type { PublicShareCell } from '$lib/server/shared-reports';
import { extractBareMarkdocRefRoots, extractMarkdocRefs } from './markdoc-interp';

/** Output names referenced from markdown cells (`$name` widgets or bare roots). */
export function getMarkdocReferencedOutputNames(
	cells: { cellType: string; markdown?: string }[]
): Set<string> {
	const refs = new Set<string>();
	for (const cell of cells) {
		if (cell.cellType !== 'markdown' || !cell.markdown?.trim()) continue;
		for (const ref of extractMarkdocRefs(cell.markdown)) refs.add(ref);
		for (const ref of extractBareMarkdocRefRoots(cell.markdown)) refs.add(ref);
	}
	return refs;
}

type ReportVisibilityCell = {
	cellType: string;
	display?: CellDisplay;
	outputName: string;
	hideInReport?: boolean;
};

/** Whether a cell should be omitted from in-app report view and published reports. */
export function shouldHideCellInReportView(
	cell: ReportVisibilityCell,
	cells: { cellType: string; markdown?: string }[]
): boolean {
	if (cell.display === 'collapsed') return true;
	if (cell.hideInReport) return true;
	if (cell.cellType !== 'query' || !cell.outputName) return false;
	return getMarkdocReferencedOutputNames(cells).has(cell.outputName);
}

/** Client-side row filter for frozen DuckDB results when filter param matches a column name. */
export function filterFrozenRows(
	rows: Record<string, unknown>[],
	columns: string[],
	filters: Record<string, string>
): { rows: Record<string, unknown>[]; columns: string[] } {
	let filtered = rows;
	for (const [param, value] of Object.entries(filters)) {
		if (!value || !columns.includes(param)) continue;
		const parts = value.includes(',')
			? value
					.split(',')
					.map((p) => p.trim())
					.filter(Boolean)
			: [value];
		filtered = filtered.filter((row) => {
			const cell = String(row[param] ?? '');
			return parts.length > 1 ? parts.includes(cell) : cell === parts[0];
		});
	}
	return { rows: filtered, columns };
}

export function shouldHideQueryCell(cell: PublicShareCell): boolean {
	if (cell.cellType !== 'query') return false;
	if (cell.display === 'collapsed') return true;
	if (cell.publishRole === 'data') return true;
	return false;
}
