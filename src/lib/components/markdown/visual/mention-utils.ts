import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
import type { Cell } from '$lib/stores/notebook.svelte';

export interface RankedRefEntry {
	entry: MarkdownRefEntry;
	score: number;
	meta: string;
	group: 'notebook' | 'project' | 'other';
}

const PREVIEW_LIMIT = 8;

function cellMeta(cell: Cell | undefined): string {
	if (!cell) return '';
	const parts: string[] = [];
	if (cell.language) parts.push(cell.language);
	if (cell.errors?.length) parts.push('error');
	else if (cell.result?.rows) parts.push(`${cell.result.rows.length} rows`);
	else if (cell.status === 'running') parts.push('running');
	return parts.join(' · ');
}

export function rankRefEntries(
	query: string,
	entries: MarkdownRefEntry[],
	cells: Cell[],
	currentNotebookCellNames?: Set<string>
): { visible: RankedRefEntry[]; moreCount: number } {
	const q = query.trim().toLowerCase();
	const cellByName = new Map(cells.map((c) => [c.outputName, c]));

	const scored = entries
		.map((entry): RankedRefEntry | null => {
			const name = entry.cellName;
			const lower = name.toLowerCase();
			if (q && !lower.includes(q)) return null;

			let score = 0;
			if (!q) score += 1;
			if (lower === q) score += 100;
			else if (lower.startsWith(q)) score += 60;
			else if (lower.includes(q)) score += 30;

			const cell = cellByName.get(name);
			if (cell?.result?.rows?.length) score += 15;
			if (cell?.errors?.length) score -= 5;
			if (currentNotebookCellNames?.has(name)) score += 25;

			const group: RankedRefEntry['group'] = currentNotebookCellNames?.has(name)
				? 'notebook'
				: 'project';

			return {
				entry,
				score,
				meta: cellMeta(cell),
				group
			};
		})
		.filter((x): x is RankedRefEntry => x !== null)
		.sort((a, b) => b.score - a.score || a.entry.cellName.localeCompare(b.entry.cellName));

	const visible = scored.slice(0, PREVIEW_LIMIT);
	const moreCount = Math.max(0, scored.length - PREVIEW_LIMIT);

	return { visible, moreCount };
}

export const MENTION_GROUP_LABEL: Record<RankedRefEntry['group'], string> = {
	notebook: 'This notebook',
	project: 'Project models',
	other: 'More results'
};

export interface MentionItem {
	id: string;
	label: string;
	meta?: string;
	group: RankedRefEntry['group'];
}
