import { Node, mergeAttributes } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import type { Cell } from '$lib/stores/notebook.svelte';
import { parseAttrsJson } from './widget-registry';
import InlineWidgetNodeView from './InlineWidgetNodeView.svelte';

export interface MarkdocWidgetExtensionContext {
	getCells: () => Cell[];
	getNotebookId: () => string;
}

export const MarkdocWidgetExtension = Node.create({
	name: 'markdocWidget',
	group: 'block',
	atom: true,
	defining: true,
	isolating: true,

	addAttributes() {
		return {
			tagName: { default: 'metric' },
			attrsJson: { default: '{}' },
			selfClosing: { default: true }
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-markdoc-widget]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-markdoc-widget': 'true' })];
	},

	addNodeView() {
		const ctx = this.options.context as MarkdocWidgetExtensionContext | undefined;
		return ({ node, editor, getPos }) => {
			const dom = document.createElement('div');
			dom.className = 'markdoc-widget-node';
			dom.contentEditable = 'false';

			let component: ReturnType<typeof mount> | null = null;
			let tagName = String(node.attrs.tagName ?? 'metric');
			let attrsJson = String(node.attrs.attrsJson ?? '{}');
			let selfClosing = Boolean(node.attrs.selfClosing);
			let isSelected = false;

			const render = () => {
				if (component) unmount(component);
				component = mount(InlineWidgetNodeView, {
					target: dom,
					props: {
						tagName,
						attrs: parseAttrsJson(attrsJson),
						selfClosing,
						cells: ctx?.getCells() ?? [],
						notebookId: ctx?.getNotebookId() ?? '',
						selected: isSelected,
						onSelect: () => {
							const pos = getPos();
							if (typeof pos === 'number') {
								editor.chain().focus().setNodeSelection(pos).run();
							}
						},
						onOpenInspector: () => {
							const pos = getPos();
							if (typeof pos === 'number') {
								editor.chain().focus().setNodeSelection(pos).run();
							}
						},
						onDelete: () => {
							editor.chain().focus().deleteSelection().run();
						},
						onPatch: (patch: {
							tagName?: string;
							attrs?: Record<string, unknown>;
							body?: string;
							source?: string;
							attrsJson?: string;
						}) => {
							const pos = getPos();
							if (typeof pos !== 'number') return;
							if (patch.tagName) tagName = patch.tagName;
							if (patch.attrsJson !== undefined) attrsJson = patch.attrsJson;
							else if (patch.attrs)
								attrsJson = JSON.stringify({
									...parseAttrsJson(attrsJson),
									...patch.attrs
								});
							editor
								.chain()
								.focus()
								.command(({ tr }) => {
									tr.setNodeMarkup(pos, undefined, {
										tagName,
										attrsJson,
										selfClosing
									});
									return true;
								})
								.run();
							render();
						}
					}
				});
			};

			render();

			return {
				dom,
				update(updatedNode) {
					if (updatedNode.type.name !== 'markdocWidget') return false;
					tagName = String(updatedNode.attrs.tagName ?? tagName);
					attrsJson = String(updatedNode.attrs.attrsJson ?? attrsJson);
					selfClosing = Boolean(updatedNode.attrs.selfClosing);
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
					// Allow interactive widget controls (filters, charts, tabs, etc.)
					if (
						target.closest(
							'.md-filter, .md-chart, .md-datatable, .md-tabs, .md-details, .md-metric-copy, select, input, button, textarea, a'
						)
					) {
						return true;
					}
					if (target.closest('.iw-chrome')) return true;
					return false;
				},
				// The widget DOM is fully owned by the mounted Svelte component (it
				// re-renders when cell data changes). Tell ProseMirror to ignore all
				// mutations inside it so its DOMObserver doesn't reparse/re-render and
				// spin an infinite loop.
				ignoreMutation() {
					return true;
				}
			};
		};
	}
});

export function createMarkdocWidgetExtension(context: MarkdocWidgetExtensionContext) {
	return MarkdocWidgetExtension.configure({ context });
}
