import { Node, mergeAttributes } from '@tiptap/core';

export const NotebookPageExtension = Node.create({
	name: 'notebookPage',
	group: 'block',
	atom: true,
	defining: true,

	addAttributes() {
		return {
			title: { default: 'Untitled' },
			pageId: { default: null }
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-notebook-page]' }];
	},

	renderHTML({ HTMLAttributes, node }) {
		return [
			'div',
			mergeAttributes(HTMLAttributes, {
				'data-notebook-page': 'true',
				contenteditable: 'false',
				style:
					'display:flex;align-items:center;gap:0.4rem;padding:0.35rem 0.6rem;' +
					'border:1px solid var(--border, #333);border-radius:0.375rem;' +
					'font-weight:600;font-size:1.1rem;margin:0.25rem 0;cursor:default;'
			}),
			['span', {}, '\u{1F4C4}'],
			['span', {}, String(node.attrs.title ?? 'Untitled')]
		];
	}
});

export function createNotebookPageExtension() {
	return NotebookPageExtension;
}
