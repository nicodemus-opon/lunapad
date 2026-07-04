import { Node, mergeAttributes } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import type { Cell } from '$lib/stores/notebook.svelte';
import { parseAttrsJson } from './widget-registry';
import { markdocAttrsToJson } from '$lib/services/markdoc-ast';
import InlineWidgetNodeView from './InlineWidgetNodeView.svelte';
import { reactiveProps } from './reactive-props.svelte';

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

			// Mounted once with reactive props (mutated in place). Remounting on every
			// update/select destroys open dropdowns/filter controls mid-interaction.
			const props = reactiveProps({
				tagName: String(node.attrs.tagName ?? 'metric'),
				attrs: parseAttrsJson(String(node.attrs.attrsJson ?? '{}')),
				selfClosing: Boolean(node.attrs.selfClosing),
				cells: ctx?.getCells() ?? [],
				notebookId: ctx?.getNotebookId() ?? '',
				selected: false,
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
					if (patch.tagName) props.tagName = patch.tagName;
					let attrsJson: string;
					if (patch.attrsJson !== undefined) attrsJson = patch.attrsJson;
					else if (patch.attrs)
						attrsJson = markdocAttrsToJson({ ...props.attrs, ...patch.attrs });
					else attrsJson = markdocAttrsToJson(props.attrs);
					props.attrs = parseAttrsJson(attrsJson);
					editor
						.chain()
						.focus()
						.command(({ tr }) => {
							tr.setNodeMarkup(pos, undefined, {
								tagName: props.tagName,
								attrsJson,
								selfClosing: props.selfClosing
							});
							return true;
						})
						.run();
				}
			});

			const component = mount(InlineWidgetNodeView, { target: dom, props });

			return {
				dom,
				update(updatedNode) {
					if (updatedNode.type.name !== 'markdocWidget') return false;
					props.tagName = String(updatedNode.attrs.tagName ?? props.tagName);
					props.attrs = parseAttrsJson(String(updatedNode.attrs.attrsJson ?? '{}'));
					props.selfClosing = Boolean(updatedNode.attrs.selfClosing);
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
					const raw = event.target as globalThis.Node | null;
					let el = raw instanceof Element ? raw : raw instanceof Text ? raw.parentElement : null;
					if (el?.closest('.markdoc-widget-node')) return true;
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
