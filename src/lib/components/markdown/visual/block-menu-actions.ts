import type { Editor } from '@tiptap/core';
import { serializePmNodeToMarkdown, markdownToPmDocument } from '$lib/services/markdoc-pm';
import { buildNotebookOutline } from '$lib/services/notebook-outline';
import type { Cell } from '$lib/stores/notebook.svelte';

export interface BlockMenuAction {
	id: string;
	label: string;
	disabled?: boolean;
	danger?: boolean;
}

export interface BlockMenuGroup {
	label: string;
	items: BlockMenuAction[];
}

const TURN_INTO_LABELS: Record<string, string> = {
	'turn-paragraph': 'Paragraph',
	'turn-h1': 'Heading 1',
	'turn-h2': 'Heading 2',
	'turn-h3': 'Heading 3',
	'turn-bullet': 'Bullet list',
	'turn-numbered': 'Numbered list',
	'turn-task': 'To-do list',
	'turn-quote': 'Quote',
	'turn-code': 'Code block',
	'turn-callout': 'Callout',
	'turn-toggle': 'Toggle (collapsible)'
};

/** Builds the block menu's action groups for the node at `pos`. Turn-into actions are
 * disabled for atom nodes (query blocks, images, horizontal rules, …) since there's no
 * sensible way to convert them. "Copy link to heading" only appears for headings. */
export function buildBlockMenuGroups(editor: Editor, pos: number): BlockMenuGroup[] {
	const node = editor.state.doc.nodeAt(pos);
	const isAtom = node?.isAtom ?? false;
	const isHeading = node?.type.name === 'heading';

	return [
		{
			label: 'Insert',
			items: [
				{ id: 'add-above', label: 'Add block above' },
				{ id: 'add-below', label: 'Add block below' }
			]
		},
		{
			label: 'Turn into',
			items: Object.entries(TURN_INTO_LABELS).map(([id, label]) => ({
				id,
				label,
				disabled: isAtom
			}))
		},
		{
			label: 'Actions',
			items: [
				{ id: 'duplicate', label: 'Duplicate' },
				...(isHeading ? [{ id: 'copy-link', label: 'Copy link to heading' }] : []),
				{ id: 'delete', label: 'Delete', danger: true }
			]
		}
	];
}

export function insertBlockAbove(editor: Editor, pos: number): void {
	editor
		.chain()
		.focus()
		.insertContentAt(pos, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
		.setTextSelection(pos + 2)
		.run();
}

export function turnBlockInto(editor: Editor, pos: number, kind: string): void {
	const node = editor.state.doc.nodeAt(pos);
	if (!node || node.isAtom) return;
	const insidePos = Math.min(pos + 1, editor.state.doc.content.size);
	const chain = editor.chain().focus().setTextSelection(insidePos);
	switch (kind) {
		case 'turn-paragraph':
			chain.setParagraph();
			break;
		case 'turn-h1':
			chain.setNode('heading', { level: 1 });
			break;
		case 'turn-h2':
			chain.setNode('heading', { level: 2 });
			break;
		case 'turn-h3':
			chain.setNode('heading', { level: 3 });
			break;
		case 'turn-bullet':
			chain.toggleBulletList();
			break;
		case 'turn-numbered':
			chain.toggleOrderedList();
			break;
		case 'turn-task':
			chain.toggleTaskList();
			break;
		case 'turn-quote':
			chain.toggleBlockquote();
			break;
		case 'turn-code':
			chain.toggleCodeBlock();
			break;
		case 'turn-callout':
			wrapBlockInContainer(editor, pos, 'callout');
			return;
		case 'turn-toggle':
			wrapBlockInContainer(editor, pos, 'details');
			return;
		default:
			return;
	}
	chain.run();
}

/** Wraps the block's markdown content in a Markdoc container tag by round-tripping
 * through the same markdown parser the rest of the editor uses (rather than hand-building
 * PM nodes), so the result matches what typing the snippet directly would produce. */
function wrapBlockInContainer(editor: Editor, pos: number, tag: 'callout' | 'details'): void {
	const node = editor.state.doc.nodeAt(pos);
	if (!node || node.isAtom) return;
	const inner = serializePmNodeToMarkdown(node);
	const snippet =
		tag === 'callout'
			? `{% callout type="info" %}\n${inner}\n{% /callout %}`
			: `{% details summary="Details" %}\n${inner}\n{% /details %}`;
	const { doc } = markdownToPmDocument(snippet);
	const content = doc.content ?? [];
	if (!content.length) return;
	editor
		.chain()
		.focus()
		.deleteRange({ from: pos, to: pos + node.nodeSize })
		.insertContentAt(pos, content)
		.run();
}

export interface QueryBlockHooks {
	onDuplicateQueryBlock?: (cellId: string) => string | null;
	onDeleteQueryBlock?: (cellId: string) => void;
}

export function duplicateBlockAt(editor: Editor, pos: number, hooks?: QueryBlockHooks): void {
	const node = editor.state.doc.nodeAt(pos);
	if (!node) return;
	if (node.type.name === 'queryBlock' && hooks?.onDuplicateQueryBlock) {
		const cellId = String(node.attrs.cellId ?? '');
		const newCellId = hooks.onDuplicateQueryBlock(cellId);
		if (!newCellId) return;
		editor
			.chain()
			.focus()
			.insertContentAt(pos + node.nodeSize, {
				type: 'queryBlock',
				attrs: { ...node.attrs, cellId: newCellId }
			})
			.run();
		return;
	}
	editor
		.chain()
		.focus()
		.insertContentAt(pos + node.nodeSize, node.toJSON())
		.run();
}

export function deleteBlockAt(editor: Editor, pos: number, hooks?: QueryBlockHooks): void {
	const node = editor.state.doc.nodeAt(pos);
	if (!node) return;
	if (node.type.name === 'queryBlock' && hooks?.onDeleteQueryBlock) {
		hooks.onDeleteQueryBlock(String(node.attrs.cellId ?? ''));
		return;
	}
	editor
		.chain()
		.focus()
		.deleteRange({ from: pos, to: pos + node.nodeSize })
		.run();
}

/** Resolves the anchor id for the heading at `pos` by matching it against the notebook
 * outline (built the same way NotebookOutline.svelte does), rather than tracking a
 * PM→cell position mapping directly. */
export function copyHeadingLinkAt(editor: Editor, pos: number, cells: Cell[]): string | null {
	const node = editor.state.doc.nodeAt(pos);
	if (!node || node.type.name !== 'heading') return null;
	const label = node.textContent.trim();
	if (!label) return null;
	const outline = buildNotebookOutline(cells);
	const entry = outline.find((e) => e.kind === 'heading' && e.label === label);
	return entry?.anchorId ?? null;
}
