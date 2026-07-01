export function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
	const escape = (v: unknown): string => {
		if (v === null || v === undefined) return '';
		const s = String(v);
		if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
		return s;
	};
	const header = columns.map(escape).join(',');
	const body = rows.map((row) => columns.map((col) => escape(row[col])).join(','));
	return [header, ...body].join('\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain'): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export function downloadCsv(
	filename: string,
	columns: string[],
	rows: Record<string, unknown>[]
): void {
	downloadTextFile(filename, rowsToCsv(columns, rows), 'text/csv;charset=utf-8');
}

export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
