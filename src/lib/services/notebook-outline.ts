import type { Cell } from '$lib/stores/notebook.svelte';

export type OutlineLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type OutlineEntry = {
	id: string;
	cellId: string;
	kind: 'heading' | 'cell';
	level: OutlineLevel;
	label: string;
	anchorId?: string;
};

const ATX_HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

/** Slugify heading text for anchor ids (shared by outline + Markdoc renderer). */
export function slugifyHeading(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

export function headingAnchorId(cellId: string, label: string): string {
	const slug = slugifyHeading(label);
	return slug ? `${cellId}--${slug}` : `${cellId}--heading`;
}

/** Allocate a unique anchor id for a heading label within one cell (matches outline dedupe). */
export function resolveHeadingAnchorId(
	cellId: string,
	label: string,
	usedSlugs: Set<string>
): string {
	const base = headingAnchorId(cellId, label);
	let id = base;
	let n = 2;
	while (usedSlugs.has(id)) {
		id = `${base}-${n++}`;
	}
	usedSlugs.add(id);
	return id;
}

function parseMarkdownHeadings(cellId: string, markdown: string): OutlineEntry[] {
	const entries: OutlineEntry[] = [];
	const usedSlugs = new Set<string>();
	let match: RegExpExecArray | null;
	ATX_HEADING_RE.lastIndex = 0;
	while ((match = ATX_HEADING_RE.exec(markdown)) !== null) {
		const level = Math.min(6, match[1].length) as OutlineLevel;
		const label = match[2].trim();
		if (!label) continue;
		const id = resolveHeadingAnchorId(cellId, label, usedSlugs);
		entries.push({ id, cellId, kind: 'heading', level, label, anchorId: id });
	}
	return entries;
}

function isNamedExecutableCell(cell: Cell): boolean {
	if (cell.promotedModelPath) return false;
	if (cell.controlConfig) return Boolean(cell.outputName.trim());
	if (cell.cellType === 'query' || cell.cellType === 'python' || cell.cellType === 'plot') {
		return Boolean(cell.outputName.trim());
	}
	if (cell.cellType === 'udf') {
		return Boolean(cell.outputName.trim());
	}
	return false;
}

function cellOutlineLabel(cell: Cell): string | null {
	if (cell.promotedModelPath) return null;
	if (cell.cellType === 'markdown') return null;
	const name = cell.outputName.trim();
	return name || null;
}

/**
 * Build a semantic outline from notebook cells: markdown ATX headings plus named cells.
 */
export function buildNotebookOutline(cells: Cell[]): OutlineEntry[] {
	const outline: OutlineEntry[] = [];
	const usedIds = new Set<string>();

	for (const cell of cells) {
		if (cell.promotedModelPath) continue;

		if (cell.cellType === 'markdown') {
			const headings = parseMarkdownHeadings(cell.id, cell.markdown);
			for (const h of headings) {
				if (!usedIds.has(h.id)) {
					usedIds.add(h.id);
					outline.push(h);
				}
			}
			continue;
		}

		const label = cellOutlineLabel(cell);
		if (!label) continue;

		// Skip if this cell's only label duplicates a heading already emitted for same cell
		const hasHeading = outline.some((e) => e.cellId === cell.id && e.kind === 'heading');
		if (hasHeading && cell.cellType !== 'query' && cell.cellType !== 'python') continue;

		const id = resolveHeadingAnchorId(cell.id, label, usedIds);
		outline.push({
			id,
			cellId: cell.id,
			kind: 'cell',
			level: 1,
			label,
			anchorId: id
		});
	}

	return outline;
}

/** Extract plain text from Markdoc render tree children for heading slug ids. */
export function textFromMarkdocChildren(children: unknown[]): string {
	let text = '';
	for (const child of children) {
		if (typeof child === 'string') {
			text += child;
		} else if (child && typeof child === 'object' && 'children' in child) {
			const nested = (child as { children?: unknown[] }).children;
			if (Array.isArray(nested)) text += textFromMarkdocChildren(nested);
		}
	}
	return text;
}
