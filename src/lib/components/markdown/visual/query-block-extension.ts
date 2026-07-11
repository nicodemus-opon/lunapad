import { Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { mount, unmount } from 'svelte';
import type { Cell, CellDisplay } from '$lib/stores/notebook.svelte';
import { setCellDisplay } from '$lib/stores/notebook.svelte';
import QueryBlockNodeView from './QueryBlockNodeView.svelte';
import { reactiveProps } from './reactive-props.svelte';

/** Nearest element for a DOM event (handles text-node targets). */
function eventTargetElement(event: Event): Element | null {
	let node = event.target as globalThis.Node | null;
	while (node && node.nodeType !== globalThis.Node.ELEMENT_NODE) {
		node = node.parentNode;
	}
	return node as Element | null;
}

export interface QueryBlockExtensionContext {
	getCells: () => Cell[];
	getNotebookId: () => string;
	reportView?: () => boolean;
	dark?: () => boolean;
	onDeleteCell?: (cellId: string) => void;
}

/** A ProseMirror block move is delete+insert, which destroys and recreates the
 * node view — and with it the embedded Monaco editor (expensive, and it loses
 * scroll/undo state). `destroy()` parks the mounted view here for one tick; a
 * re-create for the same cell in the same editor within that tick (the insert
 * side of the move) adopts it instead of mounting fresh. */
interface ParkedQueryView {
	dom: HTMLDivElement;
	component: ReturnType<typeof mount>;
	props: QueryBlockProps;
	ref: { getPos: () => number | undefined };
	editor: unknown;
	teardown: ReturnType<typeof setTimeout>;
}

interface QueryBlockProps extends Record<string, unknown> {
	cellId: string;
	pinned: boolean;
	selected: boolean;
	dark: boolean;
	notebookId: string;
	reportView: boolean;
	onFocus: () => void;
	onBlur: () => void;
	onTogglePin: () => void;
	onSetDisplay: (display: CellDisplay) => void;
	onDelete: () => void;
}

const parkedQueryViews = new Map<string, ParkedQueryView>();

export const QueryBlockExtension = Node.create({
	name: 'queryBlock',
	group: 'block',
	atom: true,
	defining: true,
	isolating: true,
	selectable: true,
	// Dragging goes exclusively through the dedicated rail handle (drag-gutter.ts).
	// A native draggable="true" on the whole node hijacks in-block gestures (e.g.
	// dragging a table's column-resize handle) into a native HTML5 drag of the block.
	draggable: false,

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
			const cellId = String(node.attrs.cellId ?? '');
			const reportView = ctx?.reportView?.() ?? false;

			// `getPos`/callbacks must survive adoption after a move, so everything
			// position-dependent reads through this mutable ref. The SAME ref object
			// lives as long as the mounted component (the callbacks close over it),
			// so adoption reuses the parked one instead of this fresh one.
			let ref: { getPos: () => number | undefined } = { getPos };

			const getCell = (id: string) => ctx?.getCells().find((c) => c.id === id) ?? null;

			let dom: HTMLDivElement;
			let props: QueryBlockProps;
			let component: ReturnType<typeof mount>;

			const parked = parkedQueryViews.get(cellId);
			if (parked && parked.editor === editor && parked.props.reportView === reportView) {
				// Insert side of a move within the same tick: adopt the live view —
				// Monaco keeps its model, scroll, and undo stack.
				clearTimeout(parked.teardown);
				parkedQueryViews.delete(cellId);
				({ dom, props, component, ref } = parked);
				ref.getPos = getPos;
				props.pinned = Boolean(node.attrs.pinned);
				props.dark = ctx?.dark?.() ?? false;
				props.selected = false;
				dom.classList.remove('ProseMirror-selectednode');
			} else {
				dom = document.createElement('div');
				dom.className = 'query-block-node';
				dom.contentEditable = 'false';

				const syncPinnedAttr = (pinned: boolean) => {
					props.pinned = pinned;
					editor
						.chain()
						.command(({ tr }) => {
							const pos = ref.getPos();
							if (typeof pos !== 'number') return false;
							tr.setNodeAttribute(pos, 'pinned', pinned);
							return true;
						})
						.run();
				};

				// Mount ONCE with reactive props and mutate them in place. Remounting on
				// every update/select destroys the embedded Monaco editor and any open
				// dropdown the moment the user interacts with the block, which makes
				// cells impossible to type in.
				props = reactiveProps({
					cellId,
					pinned: Boolean(node.attrs.pinned),
					selected: false,
					dark: ctx?.dark?.() ?? false,
					notebookId: ctx?.getNotebookId() ?? '',
					reportView,
					onFocus: () => {
						// Mark the block as PM-selected WITHOUT calling editor focus():
						// focus() would steal DOM focus from the Monaco editor the user
						// just clicked, and with the node selected the next keystroke
						// would REPLACE the whole query block with typed text.
						const pos = ref.getPos();
						if (typeof pos !== 'number') return;
						const { state } = editor.view;
						if (state.selection instanceof NodeSelection && state.selection.from === pos) return;
						try {
							editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
						} catch {
							/* node no longer at pos — ignore */
						}
					},
					onBlur: () => {},
					onTogglePin: () => {
						const next = !props.pinned;
						syncPinnedAttr(next);
						const cell = getCell(props.cellId);
						if (cell) setCellDisplay(props.cellId, next ? 'full' : 'output');
					},
					onSetDisplay: (display: CellDisplay) => {
						setCellDisplay(props.cellId, display);
						if (display !== 'full') syncPinnedAttr(false);
					},
					onDelete: () => {
						const pos = ref.getPos();
						if (typeof pos === 'number') {
							const currentNode = editor.state.doc.nodeAt(pos);
							if (currentNode) {
								editor
									.chain()
									.focus()
									.command(({ tr }) => {
										tr.delete(pos, pos + currentNode.nodeSize);
										return true;
									})
									.run();
							}
						}
						ctx?.onDeleteCell?.(props.cellId);
					}
				}) as QueryBlockProps;

				component = mount(QueryBlockNodeView, { target: dom, props });
			}

			return {
				dom,
				update(updatedNode) {
					if (updatedNode.type.name !== 'queryBlock') return false;
					props.cellId = String(updatedNode.attrs.cellId ?? props.cellId);
					props.pinned = Boolean(updatedNode.attrs.pinned);
					props.dark = ctx?.dark?.() ?? false;
					return true;
				},
				destroy() {
					// Park for one tick instead of unmounting: if this destroy is the
					// delete side of a move, the matching insert adopts the view above.
					// A real delete (or editor teardown) unmounts on the next tick.
					const existing = parkedQueryViews.get(props.cellId);
					if (existing) {
						clearTimeout(existing.teardown);
						unmount(existing.component);
					}
					parkedQueryViews.set(props.cellId, {
						dom,
						component,
						props,
						ref,
						editor,
						teardown: setTimeout(() => {
							parkedQueryViews.delete(props.cellId);
							unmount(component);
						}, 0)
					});
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
					const el = eventTargetElement(event);
					// The query block is a non-editable atom — PM must not handle any
					// events inside it or chart/result/GUI controls stop responding.
					return Boolean(el?.closest('.query-block-node'));
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
