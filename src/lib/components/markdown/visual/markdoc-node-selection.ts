import type { NodeSelection as PMNodeSelection } from '@tiptap/pm/state';
import {
	parseVisualBlocks,
	parseBlockWidget,
	updateBlockWidgetSource,
	serializeMarkdocTag,
	markdocAttrsToJson,
	type VisualBlock
} from '$lib/services/markdoc-ast';
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
		const source = serializeMarkdocTag(tagName, attrs, { body: '' });
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
		const tagName = selected.tagName ?? 'callout';
		let attrs = { ...selected.attrs, ...patch.attrs };
		if (patch.source) {
			const block: VisualBlock = {
				id: 'patch',
				kind: 'container',
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
				tr.setNodeAttribute(pos, 'tagName', tagName);
				tr.setNodeAttribute(pos, 'attrsJson', markdocAttrsToJson(attrs));
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
