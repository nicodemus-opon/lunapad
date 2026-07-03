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

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-notebook-page': 'true' })];
	}
});

export function createNotebookPageExtension() {
	return NotebookPageExtension;
}
