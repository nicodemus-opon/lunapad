import type { Cell, Notebook } from '$lib/stores/notebook.svelte';

export interface NotebookBacklink {
	sourceNotebookId: string;
	sourceNotebookName: string;
	sourceCellId: string;
	label: string;
	snippet: string;
}

const MENTION_RE = /@([a-zA-Z_][\w]*)/g;

/** Find notebooks/cells that reference the given notebook name or cell output names. */
export function findNotebookBacklinks(
	targetNotebookId: string,
	notebooks: Notebook[]
): NotebookBacklink[] {
	const target = notebooks.find((n) => n.id === targetNotebookId);
	if (!target) return [];

	const needles = new Set<string>([target.name]);
	for (const cell of target.cells) {
		if (cell.outputName) needles.add(cell.outputName);
	}

	const links: NotebookBacklink[] = [];
	for (const nb of notebooks) {
		if (nb.id === targetNotebookId) continue;
		for (const cell of nb.cells) {
			if (cell.cellType !== 'markdown') continue;
			const md = cell.markdown ?? '';
			if (!md.trim()) continue;

			let matched = false;
			for (const needle of needles) {
				if (md.includes(`@${needle}`) || md.includes(needle)) {
					matched = true;
					break;
				}
			}
			if (!matched) continue;

			const mention = md.match(MENTION_RE)?.[0]?.slice(1) ?? target.name;
			links.push({
				sourceNotebookId: nb.id,
				sourceNotebookName: nb.name,
				sourceCellId: cell.id,
				label: mention,
				snippet: md.split('\n').find((l) => l.includes('@') || needles.has(l.trim()))?.slice(0, 120) ?? md.slice(0, 120)
			});
		}
	}
	return links;
}

/** Extract document title (first H1) and optional emoji icon from markdown cells. */
export function extractDocumentMeta(cells: Cell[]): { title: string | null; icon: string | null } {
	for (const cell of cells) {
		if (cell.cellType !== 'markdown') continue;
		const md = cell.markdown ?? '';
		const h1 = md.match(/^#\s+(.+)$/m);
		if (h1) {
			const raw = h1[1]?.trim() ?? '';
			const iconMatch = raw.match(/^(\p{Extended_Pictographic})\s+(.+)$/u);
			if (iconMatch) return { icon: iconMatch[1], title: iconMatch[2] };
			return { icon: null, title: raw };
		}
	}
	return { title: null, icon: null };
}
