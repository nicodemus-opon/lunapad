import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { buildMarkdocVariables, expandLoopsInSource } from '$lib/services/markdoc-interp';
import type { Cell } from '$lib/stores/notebook.svelte';
import { parseAttrsJson } from './widget-registry';

/** Extract diagram source from a {% mermaid %} PM container node, resolving bare
 * `$cell.field` refs and expanding `{% each %}`/`{% group %}` loops the same way
 * the source/report render path does (markdoc-interp.ts's mermaidTag.transform) —
 * otherwise the visual editor's live preview shows the literal template text. */
export function mermaidCodeFromContainerNode(
	node: ProseMirrorNode,
	attrsJson: string,
	cells: Cell[] = []
): string {
	const attrs = parseAttrsJson(attrsJson);
	const codeAttr = attrs.code;
	if (typeof codeAttr === 'string' && codeAttr.trim()) {
		if (/^\$[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(codeAttr.trim())) {
			const path = codeAttr.trim().slice(1).split('.');
			let cur: unknown = buildMarkdocVariables(cells);
			for (const key of path) {
				if (cur == null || typeof cur !== 'object') return '';
				cur = (cur as Record<string, unknown>)[key];
			}
			return cur != null && typeof cur !== 'object' ? String(cur) : '';
		}
		return codeAttr;
	}
	let text = '';
	node.forEach((child) => {
		if (child.type.name === 'codeBlock') text = child.textContent;
	});
	if (!text.trim()) return text;
	return expandLoopsInSource(text, { variables: buildMarkdocVariables(cells) }, {});
}

const MERMAID_FENCE_RE = /^```mermaid\s*\n([\s\S]*?)```\s*$/im;

export function isMermaidFenceSource(source: string): boolean {
	return MERMAID_FENCE_RE.test(source.trim());
}

export function mermaidCodeFromFenceSource(source: string): string {
	const m = source.trim().match(MERMAID_FENCE_RE);
	return m?.[1]?.trimEnd() ?? '';
}
