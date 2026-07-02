import { Node, mergeAttributes } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import type { Cell } from '$lib/stores/notebook.svelte';
import MarkdocBlockView from './MarkdocBlockView.svelte';

export interface MarkdocBlockExtensionContext {
	getCells: () => Cell[];
	getNotebookId: () => string;
}

export const MarkdocBlockExtension = Node.create({
	name: 'markdocBlock',
	group: 'block',
	atom: true,
	defining: true,
	isolating: true,

	addAttributes() {
		return {
			source: { default: '' }
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-markdoc-block]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-markdoc-block': 'true' })];
	},

	addNodeView() {
		const ctx = this.options.context as MarkdocBlockExtensionContext | undefined;
		return ({ node, editor, getPos }) => {
			const dom = document.createElement('div');
			dom.className = 'markdoc-block-node';
			dom.contentEditable = 'false';

			let component: ReturnType<typeof mount> | null = null;
			let currentSource = String(node.attrs.source ?? '');
			let isSelected = false;

			const render = () => {
				if (component) unmount(component);
				component = mount(MarkdocBlockView, {
					target: dom,
					props: {
						source: currentSource,
						cells: ctx?.getCells() ?? [],
						notebookId: ctx?.getNotebookId() ?? '',
						selected: isSelected,
						onSelect: () => {
							const pos = getPos();
							if (typeof pos === 'number') {
								editor.chain().focus().setNodeSelection(pos).run();
							}
						},
						onDelete: () => {
							editor.chain().focus().deleteSelection().run();
						}
					}
				});
			};

			render();

			return {
				dom,
				update(updatedNode) {
					if (updatedNode.type.name !== 'markdocBlock') return false;
					const next = String(updatedNode.attrs.source ?? '');
					if (next === currentSource) return true;
					currentSource = next;
					render();
					return true;
				},
				destroy() {
					if (component) unmount(component);
				},
				selectNode() {
					isSelected = true;
					dom.classList.add('ProseMirror-selectednode');
					render();
				},
				deselectNode() {
					isSelected = false;
					dom.classList.remove('ProseMirror-selectednode');
					render();
				},
				stopEvent() {
					return true;
				}
			};
		};
	}
});

export function createMarkdocBlockExtension(context: MarkdocBlockExtensionContext) {
	return MarkdocBlockExtension.configure({ context });
}
