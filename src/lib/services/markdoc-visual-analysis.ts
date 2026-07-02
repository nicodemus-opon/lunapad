import type { Cell } from '$lib/stores/notebook.svelte';

export interface FilterUsage {
	param: string;
	cellId: string;
	outputName: string;
	cellType: Cell['cellType'];
}

export interface VisualRefOption {
	value: string;
	label: string;
	kind: 'cell' | 'rows' | 'column';
	cellName: string;
	column?: string;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findFilterUsages(cells: Cell[], param: string): FilterUsage[] {
	if (!param) return [];
	const re = new RegExp(`\\$\\{\\s*${escapeRegExp(param)}\\s*\\}`);
	return cells
		.filter((cell) => cell.cellType === 'query' && cell.outputName && re.test(cell.code ?? ''))
		.map((cell) => ({
			param,
			cellId: cell.id,
			outputName: cell.outputName,
			cellType: cell.cellType
		}));
}

export function buildVisualRefOptions(
	entries: Array<{ cellName: string; columns: Array<{ name: string }> }>
): VisualRefOption[] {
	const out: VisualRefOption[] = [];
	for (const entry of entries) {
		out.push({
			value: `$${entry.cellName}`,
			label: `$${entry.cellName} (cell)`,
			kind: 'cell',
			cellName: entry.cellName
		});
		out.push({
			value: `$${entry.cellName}.rows`,
			label: `$${entry.cellName}.rows`,
			kind: 'rows',
			cellName: entry.cellName
		});
		for (const col of entry.columns) {
			out.push({
				value: `$${entry.cellName}.${col.name}`,
				label: `$${entry.cellName}.${col.name}`,
				kind: 'column',
				cellName: entry.cellName,
				column: col.name
			});
		}
	}
	return out;
}

export function columnsForRef(
	entries: Array<{ cellName: string; columns: Array<{ name: string }> }>,
	refValue: unknown
): string[] {
	if (typeof refValue !== 'string') return [];
	const match = refValue.match(/^\$([A-Za-z_]\w*)/);
	if (!match) return [];
	const entry = entries.find((e) => e.cellName === match[1]);
	return entry?.columns.map((c) => c.name) ?? [];
}
