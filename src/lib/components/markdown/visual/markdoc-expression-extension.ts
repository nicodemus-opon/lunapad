import { Node, mergeAttributes } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import type { Cell } from '$lib/stores/notebook.svelte';
import { renderMarkdocCell } from '$lib/services/markdoc-interp';
import MarkdocExpressionChip from './MarkdocExpressionChip.svelte';

export interface MarkdocExpressionExtensionContext {
	getCells: () => Cell[];
}

export const MarkdocExpressionExtension = Node.create({
	name: 'markdocExpression',
	group: 'inline',
	inline: true,
	atom: true,

	addAttributes() {
		return {
			source: { default: '' }
		};
	},

	parseHTML() {
		return [{ tag: 'span[data-markdoc-expression]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['span', mergeAttributes(HTMLAttributes, { 'data-markdoc-expression': 'true' })];
	},

	addNodeView() {
		const ctx = this.options.context as MarkdocExpressionExtensionContext | undefined;
		return ({ node }) => {
			const dom = document.createElement('span');
			dom.className = 'md-expr-host';
			dom.contentEditable = 'false';

			let component: ReturnType<typeof mount> | null = null;
			let source = String(node.attrs.source ?? '');

			const render = () => {
				if (component) unmount(component);
				component = mount(MarkdocExpressionChip, {
					target: dom,
					props: {
						source,
						cells: ctx?.getCells() ?? []
					}
				});
			};

			render();

			return {
				dom,
				update(updatedNode) {
					if (updatedNode.type.name !== 'markdocExpression') return false;
					source = String(updatedNode.attrs.source ?? source);
					render();
					return true;
				},
				destroy() {
					if (component) unmount(component);
				},
				stopEvent(event) {
					return (event.target as HTMLElement).closest('.md-expr') !== null;
				},
				// The chip DOM is fully owned by the mounted Svelte component and
				// re-renders when cell data changes; ignore its mutations so
				// ProseMirror's DOMObserver doesn't reparse and loop.
				ignoreMutation() {
					return true;
				}
			};
		};
	}
});

export function createMarkdocExpressionExtension(context: MarkdocExpressionExtensionContext) {
	return MarkdocExpressionExtension.configure({ context });
}

/** Resolve display text for a single inline {% %} expression. */
export function resolveMarkdocExpression(source: string, cells: Cell[]): string {
	const trimmed = source.trim();
	if (!trimmed.startsWith('{%') || !trimmed.endsWith('%}')) return trimmed;
	const inner = renderMarkdocCell(trimmed, cells);
	if (inner.errors.length) return inner.errors[0] ?? trimmed;
	const first = inner.tree[0];
	if (first == null || first === false) return '';
	if (typeof first === 'string' || typeof first === 'number') return String(first);
	return String(first);
}
