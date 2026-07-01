import type { Cell } from '$lib/stores/notebook.svelte';

export interface MetricCatalogEntry {
	outputName: string;
	field: string;
	label: string;
	kind: 'numeric' | 'date' | 'text' | 'other';
	ref: string;
}

function columnKind(sample: unknown): MetricCatalogEntry['kind'] {
	if (sample === null || sample === undefined) return 'other';
	if (typeof sample === 'number') return 'numeric';
	if (typeof sample === 'boolean') return 'other';
	const s = String(sample);
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date';
	return 'text';
}

/** Build a flat catalog of named cell fields for sidebar insertion. */
export function buildMetricCatalog(cells: Cell[]): MetricCatalogEntry[] {
	const out: MetricCatalogEntry[] = [];
	for (const cell of cells) {
		if (cell.cellType !== 'query' || !cell.outputName) continue;
		const rows = cell.result?.rows ?? [];
		const columns = cell.result?.columns ?? [];
		for (const col of columns) {
			const sample = rows[0]?.[col];
			const kind = columnKind(sample);
			if (kind === 'text' && typeof sample === 'string' && sample.length > 40) continue;
			out.push({
				outputName: cell.outputName,
				field: col,
				label: `${cell.outputName}.${col}`,
				kind,
				ref: `$${cell.outputName}.${col}`
			});
		}
	}
	return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function filterCatalog(
	entries: MetricCatalogEntry[],
	query: string,
	kind?: MetricCatalogEntry['kind']
): MetricCatalogEntry[] {
	const q = query.trim().toLowerCase();
	return entries.filter((e) => {
		if (kind && e.kind !== kind) return false;
		if (!q) return true;
		return e.label.toLowerCase().includes(q);
	});
}
