import type { Cell, CellType } from '$lib/stores/notebook.svelte';
import {
	getMarkdocPmSchema,
	markdownToPmDocument,
	pmDocumentToMarkdown,
	type PMDocJSON,
	type PMNodeJSON
} from './markdoc-pm';
import { serializeMarkdocTag } from './markdoc-ast';

export type NotebookPmBlock =
	| { kind: 'markdown'; markdown: string; cellId?: string }
	| { kind: 'query'; cellId: string; cellType: CellType }
	| { kind: 'page'; title: string; pageId?: string };

const EXECUTABLE_CELL_TYPES = new Set<CellType>(['query', 'python', 'plot', 'udf']);

function isExecutableCell(cell: Cell): boolean {
	if (cell.promotedModelPath) return false;
	return EXECUTABLE_CELL_TYPES.has(cell.cellType);
}

/** Convert notebook cells (document order) → single ProseMirror/TipTap document. */
export function cellsToPmDocument(cells: Cell[]): PMDocJSON {
	const content: PMNodeJSON[] = [];

	for (const cell of cells) {
		if (cell.promotedModelPath) {
			content.push({
				type: 'markdocBlock',
				attrs: {
					source: serializeMarkdocTag('model', { ref: cell.promotedModelPath }, { selfClosing: true })
				}
			});
			continue;
		}

		if (cell.cellType === 'markdown') {
			const md = cell.markdown ?? '';
			if (!md.trim()) {
				content.push({ type: 'paragraph' });
				continue;
			}
			const pm = markdownToPmDocument(md);
			content.push(...(pm.doc.content ?? []));
			continue;
		}

		if (isExecutableCell(cell)) {
			content.push({
				type: 'queryBlock',
				attrs: {
					cellId: cell.id,
					cellType: cell.cellType,
					pinned: cell.display === 'full'
				}
			});
		}
	}

	if (!content.length) {
		content.push({ type: 'paragraph' });
	}

	// Notion-style: always keep an editable line at the very bottom so the caret has
	// somewhere to land when the document ends with an atom block (queryBlock, page,
	// or a Markdoc atom). Without this there is no prose line to click into or to
	// type "/" in. This trailing line is a view affordance only — pmDocumentToBlocks
	// strips boundary empty paragraphs so it never persists as a spurious cell.
	const ATOM_TYPES = new Set([
		'queryBlock',
		'notebookPage',
		'markdocBlock',
		'markdocWidget',
		'markdocContainer',
		'horizontalRule',
		'image'
	]);
	const last = content[content.length - 1];
	if (last && ATOM_TYPES.has(last.type)) {
		content.push({ type: 'paragraph' });
	}

	// Symmetric leading affordance: if the document *starts* with an atom block
	// (e.g. a fresh notebook whose first cell is a query block), there is no prose
	// line above it, so the caret has nowhere to land and the user cannot add a
	// title/intro above the first block. Prepend an editable paragraph. Like the
	// trailing line, pmDocumentToBlocks strips boundary empty paragraphs so it
	// never persists as a spurious leading cell.
	const first = content[0];
	if (first && ATOM_TYPES.has(first.type)) {
		content.unshift({ type: 'paragraph' });
	}

	return { type: 'doc', content };
}

/** Split a PM document into ordered notebook blocks (markdown runs + query blocks + pages). */
export function pmDocumentToBlocks(doc: PMDocJSON): NotebookPmBlock[] {
	const blocks: NotebookPmBlock[] = [];
	let narrative: PMNodeJSON[] = [];
	let narrativeCellId: string | undefined;

	const flushNarrative = () => {
		if (!narrative.length) return;
		const md = pmDocumentToMarkdown({ frontmatter: '', doc: { type: 'doc', content: narrative } });
		blocks.push({ kind: 'markdown', markdown: md, cellId: narrativeCellId });
		narrative = [];
		narrativeCellId = undefined;
	};

	for (const node of doc.content ?? []) {
		if (node.type === 'queryBlock') {
			flushNarrative();
			const cellId = String(node.attrs?.cellId ?? '');
			const cellType = (node.attrs?.cellType ?? 'query') as CellType;
			if (cellId) blocks.push({ kind: 'query', cellId, cellType });
			continue;
		}
		if (node.type === 'notebookPage') {
			flushNarrative();
			const title = String(node.attrs?.title ?? 'Untitled');
			const pageId = node.attrs?.pageId ? String(node.attrs.pageId) : undefined;
			blocks.push({ kind: 'page', title, pageId });
			narrative.push({
				type: 'heading',
				attrs: { level: 1, ...(pageId ? { pageId } : {}) },
				content: [{ type: 'text', text: title }]
			});
			continue;
		}
		if (node.type === 'heading' && Number(node.attrs?.level ?? 0) === 1) {
			flushNarrative();
			const title =
				(node.content ?? [])
					.map((c) => c.text ?? '')
					.join('')
					.trim() || 'Untitled';
			blocks.push({ kind: 'page', title, pageId: node.attrs?.pageId ? String(node.attrs.pageId) : undefined });
			narrative.push(node);
			continue;
		}
		narrative.push(node);
	}

	flushNarrative();

	// Drop leading/trailing empty markdown runs. These are almost always the
	// view-only affordance line(s) (see cellsToPmDocument), not content the user
	// authored; persisting them as empty cells would grow the notebook on every sync.
	const isAffordanceMd = (b: NotebookPmBlock | undefined) => {
		if (!b || b.kind !== 'markdown') return false;
		const t = b.markdown.trim();
		// Leading/trailing view affordance lines, or a lone "/" left when a slash
		// menu was opened then dismissed without picking a command.
		return !t || t === '/';
	};
	while (isAffordanceMd(blocks[0])) blocks.shift();
	while (isAffordanceMd(blocks[blocks.length - 1])) blocks.pop();

	return blocks;
}

/** Extract H1 page titles from a notebook document (for sidebar navigation). */
export function extractPagesFromPmDocument(doc: PMDocJSON): { id: string; title: string }[] {
	const pages: { id: string; title: string }[] = [];
	for (const node of doc.content ?? []) {
		if (node.type === 'notebookPage') {
			pages.push({
				id: String(node.attrs?.pageId ?? `page-${pages.length}`),
				title: String(node.attrs?.title ?? 'Untitled')
			});
		} else if (node.type === 'heading' && Number(node.attrs?.level ?? 0) === 1) {
			const title =
				(node.content ?? [])
					.map((c) => c.text ?? '')
					.join('')
					.trim() || 'Untitled';
			pages.push({
				id: String(node.attrs?.pageId ?? `page-${pages.length}`),
				title
			});
		}
	}
	return pages;
}

/** Register queryBlock + notebookPage on the shared Markdoc PM schema (for JSON round-trip). */
export function ensureNotebookPmNodes(): void {
	getMarkdocPmSchema();
}
