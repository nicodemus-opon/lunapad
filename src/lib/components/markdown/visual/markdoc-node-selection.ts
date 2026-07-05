import type { NodeSelection as PMNodeSelection } from '@tiptap/pm/state';
import {
	parseVisualBlocks,
	parseBlockWidget,
	updateBlockWidgetSource,
	serializeMarkdocTag,
	markdocAttrsToJson,
	type VisualBlock
} from '$lib/services/markdoc-ast';
import { markdownToPmDocument, serializePmNodeToMarkdown } from '$lib/services/markdoc-pm';
import { parseAttrsJson } from './widget-registry';

export type MarkdocSelectedNode =
	| {
			type: 'widget';
			tagName: string;
			attrs: Record<string, unknown>;
			source: string;
			pos: number;
	  }
	| {
			type: 'container';
			tagName: string;
			attrs: Record<string, unknown>;
			source: string;
			pos: number;
	  }
	| {
			type: 'block';
			source: string;
			pos: number;
	  };

export function syncMarkdocNodeSelection(
	editor: import('@tiptap/core').Editor,
	NodeSelection: typeof PMNodeSelection
): MarkdocSelectedNode | null {
	const sel = editor.state.selection;
	if (!(sel instanceof NodeSelection)) return null;

	const node = sel.node;
	const pos = sel.from;

	if (node.type.name === 'markdocBlock') {
		return {
			type: 'block',
			source: String(node.attrs.source ?? ''),
			pos
		};
	}

	if (node.type.name === 'markdocWidget') {
		const tagName = String(node.attrs.tagName ?? '');
		const attrs = parseAttrsJson(node.attrs.attrsJson);
		const source = serializeMarkdocTag(tagName, attrs, {
			selfClosing: Boolean(node.attrs.selfClosing)
		});
		return { type: 'widget', tagName, attrs, source, pos };
	}

	if (node.type.name === 'markdocContainer') {
		const tagName = String(node.attrs.tagName ?? '');
		const attrs = parseAttrsJson(node.attrs.attrsJson);
		const source = serializePmNodeToMarkdown(node);
		return { type: 'container', tagName, attrs, source, pos };
	}

	return null;
}

export function visualBlockFromSelection(info: MarkdocSelectedNode | null): VisualBlock | null {
	if (!info?.source) return null;
	const blocks = parseVisualBlocks(info.source);
	return blocks[0] ?? null;
}

export function patchMarkdocNodeSelection(
	editor: import('@tiptap/core').Editor,
	selected: MarkdocSelectedNode,
	selectedBlock: VisualBlock | null,
	patch: { attrs?: Record<string, unknown>; body?: string; source?: string }
): void {
	const pos = selected.pos;

	if (selected.type === 'widget') {
		const tagName = selected.tagName ?? 'metric';
		let attrs = { ...selected.attrs, ...patch.attrs };
		if (patch.source) {
			const block: VisualBlock = {
				id: 'patch',
				kind: 'widget',
				source: patch.source,
				tagName
			};
			const parsed = parseBlockWidget(block);
			if (parsed) attrs = { ...parsed.attrs, ...patch.attrs };
		}
		editor
			.chain()
			.focus()
			.command(({ tr }) => {
				tr.setNodeMarkup(pos, undefined, {
					tagName,
					attrsJson: markdocAttrsToJson(attrs),
					selfClosing: true
				});
				return true;
			})
			.run();
		return;
	}

	if (selected.type === 'container') {
		if (patch.source === undefined && patch.body === undefined) {
			const tagName = selected.tagName ?? 'callout';
			const attrs = { ...selected.attrs, ...patch.attrs };
			editor
				.chain()
				.focus()
				.command(({ tr }) => {
					tr.setNodeAttribute(pos, 'tagName', tagName);
					tr.setNodeAttribute(pos, 'attrsJson', markdocAttrsToJson(attrs));
					return true;
				})
				.run();
			return;
		}

		const currentBlock = selectedBlock ??
			parseVisualBlocks(selected.source)[0] ?? {
				id: 'patch',
				kind: 'container',
				source: selected.source,
				tagName: selected.tagName
			};
		const nextBlock =
			patch.source !== undefined
				? { ...currentBlock, source: patch.source }
				: updateBlockWidgetSource(currentBlock, patch);
		const pm = markdownToPmDocument(nextBlock.source);
		const replacement = pm.doc.content?.[0];
		if (!replacement || replacement.type !== 'markdocContainer') return;
		editor
			.chain()
			.focus()
			.command(({ tr }) => {
				const currentNode = tr.doc.nodeAt(pos);
				if (!currentNode) return false;
				tr.replaceWith(pos, pos + currentNode.nodeSize, editor.schema.nodeFromJSON(replacement));
				return true;
			})
			.run();
		return;
	}

	if (!selectedBlock) return;
	let next: VisualBlock;
	if (patch.source !== undefined) {
		next = { ...selectedBlock, source: patch.source };
	} else {
		next = updateBlockWidgetSource(selectedBlock, patch);
	}
	editor
		.chain()
		.focus()
		.command(({ tr }) => {
			tr.setNodeMarkup(pos, undefined, { source: next.source });
			return true;
		})
		.run();
}

export function nodeConfigTitle(info: MarkdocSelectedNode | null): string {
	if (!info) return 'Properties';
	if (info.type === 'block') return 'Block';
	if (info.type === 'widget' || info.type === 'container') {
		const name = info.tagName;
		return name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');
	}
	return 'Properties';
}
