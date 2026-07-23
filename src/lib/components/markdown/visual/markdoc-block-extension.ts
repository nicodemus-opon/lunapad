import { Node, mergeAttributes } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import type { Cell } from '$lib/stores/notebook.svelte';
import MarkdocBlockView from './MarkdocBlockView.svelte';
import { reactiveProps } from './reactive-props.svelte';
import { eventTargetElement } from './nodeview-utils';

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
	selectable: true,

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

			// Mounted once with reactive props — no remount on update/select (a remount
			// destroys any open dropdowns/inputs inside the rendered Markdoc content).
			const props = reactiveProps({
				source: String(node.attrs.source ?? ''),
				cells: ctx?.getCells() ?? [],
				notebookId: ctx?.getNotebookId() ?? '',
				selected: false,
				onSelect: () => {
					const pos = getPos();
					if (typeof pos === 'number') {
						editor.chain().focus().setNodeSelection(pos).run();
					}
				},
				onDelete: () => {
					const pos = getPos();
					if (typeof pos !== 'number') return;
					editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
				},
				onSourceChange: (next: string) => {
					editor
						.chain()
						.command(({ tr }) => {
							const pos = getPos();
							if (typeof pos !== 'number') return false;
							tr.setNodeAttribute(pos, 'source', next);
							return true;
						})
						.run();
				}
			});

			const component = mount(MarkdocBlockView, { target: dom, props });

			return {
				dom,
				update(updatedNode) {
					if (updatedNode.type.name !== 'markdocBlock') return false;
					const next = String(updatedNode.attrs.source ?? '');
					if (next !== props.source) props.source = next;
					props.cells = ctx?.getCells() ?? [];
					return true;
				},
				destroy() {
					unmount(component);
				},
				selectNode() {
					props.selected = true;
					dom.classList.add('ProseMirror-selectednode');
				},
				deselectNode() {
					props.selected = false;
					dom.classList.remove('ProseMirror-selectednode');
				},
				stopEvent(event) {
					// contentEditable=false on `dom`, but fence sources mount a live Monaco
					// editor inside it — PM must stay hands-off events within the node so
					// typing/selection/clicks inside Monaco (or the mermaid mode bar) work.
					const el = eventTargetElement(event);
					return Boolean(el?.closest('.markdoc-block-node'));
				},
				ignoreMutation() {
					return true;
				}
			};
		};
	}
});

export function createMarkdocBlockExtension(context: MarkdocBlockExtensionContext) {
	return MarkdocBlockExtension.configure({ context });
}
