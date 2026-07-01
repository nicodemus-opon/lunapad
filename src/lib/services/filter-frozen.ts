import type { PublicShareCell } from '$lib/server/shared-reports';

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
