import { Node, mergeAttributes } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import type { Cell } from '$lib/stores/notebook.svelte';
import { setCellDisplay } from '$lib/stores/notebook.svelte';
import QueryBlockNodeView from './QueryBlockNodeView.svelte';

export interface QueryBlockExtensionContext {
	getCells: () => Cell[];
	getNotebookId: () => string;
	reportView?: () => boolean;
	dark?: () => boolean;
	onDeleteCell?: (cellId: string) => void;
}

export const QueryBlockExtension = Node.create({
	name: 'queryBlock',
	group: 'block',
	atom: true,
	defining: true,
	isolating: true,
	selectable: true,
	draggable: true,

	addAttributes() {
		return {
			cellId: { default: '' },
			cellType: { default: 'query' },
			pinned: { default: false }
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-query-block]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-query-block': 'true' })];
	},

	addNodeView() {
		const ctx = this.options.context as QueryBlockExtensionContext | undefined;

		return ({ node, editor, getPos }) => {
			const dom = document.createElement('div');
			dom.className = 'query-block-node';
			dom.contentEditable = 'false';

			let cellId = String(node.attrs.cellId ?? '');
			let pinned = Boolean(node.attrs.pinned);
			let isSelected = false;
			let component: ReturnType<typeof mount> | null = null;

			const getCell = () => ctx?.getCells().find((c) => c.id === cellId) ?? null;

			const render = () => {
				if (component) unmount(component);
				component = mount(QueryBlockNodeView, {
					target: dom,
					props: {
						cellId,
						pinned,
						selected: isSelected,
						dark: ctx?.dark?.() ?? false,
						notebookId: ctx?.getNotebookId() ?? '',
						reportView: ctx?.reportView?.() ?? false,
						onFocus: () => {
							const pos = getPos();
							if (typeof pos === 'number') {
								editor.chain().focus().setNodeSelection(pos).run();
							}
						},
						onBlur: () => {},
						onTogglePin: () => {
							pinned = !pinned;
							const cell = getCell();
							if (cell) setCellDisplay(cellId, pinned ? 'full' : 'output');
							editor
								.chain()
								.command(({ tr }) => {
									const pos = getPos();
									if (typeof pos !== 'number') return false;
									tr.setNodeAttribute(pos, 'pinned', pinned);
									return true;
								})
								.run();
							render();
						},
						onDelete: () => {
							ctx?.onDeleteCell?.(cellId);
							editor.chain().focus().deleteSelection().run();
						}
					}
				});
			};

			render();

			return {
				dom,
				update(updatedNode) {
					if (updatedNode.type.name !== 'queryBlock') return false;
					cellId = String(updatedNode.attrs.cellId ?? cellId);
					pinned = Boolean(updatedNode.attrs.pinned);
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
				stopEvent(event) {
					const target = event.target as HTMLElement;
					if (
						target.closest(
							'.monaco-editor, .qb-gutter, button, select, input, textarea, a, .result-table, .chart-view'
						)
					) {
						return true;
					}
					return false;
				},
				ignoreMutation() {
					return true;
				}
			};
		};
	}
});

export function createQueryBlockExtension(context: QueryBlockExtensionContext) {
	return QueryBlockExtension.configure({ context });
}
