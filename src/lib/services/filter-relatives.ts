export type RelativeDatePreset = 'last7' | 'last30' | 'last90' | 'mtd' | 'ytd';

export const RELATIVE_DATE_PRESETS: { id: RelativeDatePreset; label: string }[] = [
	{ id: 'last7', label: 'Last 7 days' },
	{ id: 'last30', label: 'Last 30 days' },
	{ id: 'last90', label: 'Last 90 days' },
	{ id: 'mtd', label: 'Month to date' },
	{ id: 'ytd', label: 'Year to date' }
];

function toIsoDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Returns inclusive start/end as YYYY-MM-DD for SQL date filters. */
export function relativeDateRange(
	preset: RelativeDatePreset,
	now: Date = new Date()
): { start: string; end: string } {
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const start = new Date(end);

	switch (preset) {
		case 'last7':
			start.setDate(start.getDate() - 6);
			break;
		case 'last30':
			start.setDate(start.getDate() - 29);
			break;
		case 'last90':
			start.setDate(start.getDate() - 89);
			break;
		case 'mtd':
			start.setDate(1);
			break;
		case 'ytd':
			start.setMonth(0, 1);
			break;
	}

	return { start: toIsoDate(start), end: toIsoDate(end) };
}

/** Serialize relative-date filter state for date-range param or start/end pair. */
export function formatRelativeDateFilterValue(
	preset: RelativeDatePreset,
	startParam?: string,
	endParam?: string
): Record<string, string> {
	const { start, end } = relativeDateRange(preset);
	if (startParam && endParam) {
		return { [startParam]: start, [endParam]: end };
	}
	return { range: `${start},${end}` };
}
