import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import type { Cell } from '$lib/stores/notebook.svelte';
import { renderMarkdocCell } from '$lib/services/markdoc-interp';
import MarkdocExpressionChip from './MarkdocExpressionChip.svelte';
import { reactiveProps } from './reactive-props.svelte';

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

	// Typing an inline `{% … %}` expression converts it into a live chip on the
	// fly (the inverse of clicking a chip to edit its source). Fires when the
	// closing `%}` is typed. Block tags like `{% if … %}` are left as text.
	addInputRules() {
		return [
			nodeInputRule({
				// Negative lookahead swallows its own leading whitespace so `\s*`
				// backtracking can't sneak a block tag (`{% if … %}`) past it.
				find: /\{%\s*(?!\s*(?:if|else|table|partial|slot)\b)[^%]+?\s*%\}$/,
				type: this.type,
				getAttributes: (match) => ({ source: match[0] })
			})
		];
	},

	addNodeView() {
		return ({ node, editor, getPos }) => {
			const dom = document.createElement('span');
			dom.className = 'md-expr-host';
			dom.contentEditable = 'false';

			const props = reactiveProps({
				source: String(node.attrs.source ?? ''),
				selected: false,
				onPatch: (nextSource: string) => {
					const pos = getPos();
					if (typeof pos !== 'number') return;
					props.source = nextSource;
					editor
						.chain()
						.focus()
						.command(({ tr }) => {
							tr.setNodeMarkup(pos, undefined, { source: nextSource });
							return true;
						})
						.run();
				},
				onSelect: () => {
					const pos = getPos();
					if (typeof pos === 'number') {
						editor.chain().focus().setNodeSelection(pos).run();
					}
				}
			});

			const component = mount(MarkdocExpressionChip, { target: dom, props });

			return {
				dom,
				update(updatedNode) {
					if (updatedNode.type.name !== 'markdocExpression') return false;
					props.source = String(updatedNode.attrs.source ?? props.source);
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
					const target = event.target as HTMLElement;
					if (target.closest('input, textarea, button')) return true;
					if (target.closest('.md-expr')) return true;
					return false;
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
