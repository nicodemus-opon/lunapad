import { Extension } from '@tiptap/core';
import { PluginKey, TextSelection } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { SLASH_COMMANDS, type SlashCommand } from '$lib/services/markdown-format';
import { parseVisualBlocks, parseBlockWidget } from '$lib/services/markdoc-ast';
import { isMarkdocContainerTag } from './widget-registry';

export const slashCommandPluginKey = new PluginKey('slashCommand');
const ENTER_EXITS_TO_FOLLOWING_PARAGRAPH = new Set(['heading', 'blockquote']);

export interface SlashCommandHandler {
	onStart: (props: { items: SlashCommand[]; command: (item: SlashCommand) => void }) => void;
	onUpdate: (props: { items: SlashCommand[]; command: (item: SlashCommand) => void }) => void;
	onExit: () => void;
	/** Handle navigation/selection keys while the menu is open. Return true when the
	 * key was consumed so ProseMirror does not also act on it (e.g. Enter splitting
	 * the block, arrows moving the caret). */
	onKeyDown?: (event: KeyboardEvent) => boolean;
}

export interface SlashCommandExtensionOptions {
	handler: SlashCommandHandler;
	insertQueryBlock?: (
		lang: 'sql' | 'prql' | 'python',
		editor: import('@tiptap/core').Editor
	) => void;
	insertPage?: (editor: import('@tiptap/core').Editor) => void;
}

function filterCommands(query: string): SlashCommand[] {
	const q = query.toLowerCase().trim();
	const scored = SLASH_COMMANDS.map((cmd) => {
		let score = 0;
		if (!q) score = 1;
		if (cmd.id.toLowerCase() === q) score += 100;
		else if (cmd.label.toLowerCase().startsWith(q)) score += 60;
		else if (cmd.id.toLowerCase().startsWith(q)) score += 50;
		else if (cmd.label.toLowerCase().includes(q)) score += 30;
		else if (cmd.description.toLowerCase().includes(q)) score += 15;
		else if (!q) score += 1;
		else if (
			!cmd.id.toLowerCase().includes(q) &&
			!cmd.label.toLowerCase().includes(q) &&
			!cmd.description.toLowerCase().includes(q)
		) {
			return null;
		}
		return { cmd, score };
	})
		.filter((x): x is { cmd: SlashCommand; score: number } => x !== null)
		.sort((a, b) => b.score - a.score || a.cmd.label.localeCompare(b.cmd.label));

	return scored.slice(0, 16).map((x) => x.cmd);
}

function insertWidgetFromSnippet(editor: import('@tiptap/core').Editor, snippet: string): void {
	const trimmed = snippet.trim();
	const blocks = parseVisualBlocks(trimmed);
	const block = blocks[0];
	if (!block) {
		editor.chain().focus().insertContent({ type: 'markdocBlock', attrs: { source: trimmed } }).run();
		return;
	}
	const parsed = parseBlockWidget(block);
	if (!parsed) {
		editor.chain().focus().insertContent({ type: 'markdocBlock', attrs: { source: trimmed } }).run();
		return;
	}
	if (parsed.selfClosing || !isMarkdocContainerTag(parsed.tagName)) {
		editor
			.chain()
			.focus()
			.insertContent({
				type: 'markdocWidget',
				attrs: {
					tagName: parsed.tagName,
					attrsJson: JSON.stringify(parsed.attrs),
					selfClosing: parsed.selfClosing
				}
			})
			.run();
		return;
	}
	const bodyText = (parsed.bodySource ?? '').trim();
	const innerContent = bodyText
		? [{ type: 'paragraph', content: [{ type: 'text', text: bodyText }] }]
		: [{ type: 'paragraph' }];
	editor
		.chain()
		.focus()
		.insertContent({
			type: 'markdocContainer',
			attrs: {
				tagName: parsed.tagName,
				attrsJson: JSON.stringify(parsed.attrs)
			},
			content: innerContent
		})
		.run();
}

function insertSlashItem(
	editor: import('@tiptap/core').Editor,
	item: SlashCommand,
	opts?: Pick<SlashCommandExtensionOptions, 'insertQueryBlock' | 'insertPage'>
): void {
	const { snippet, id, group } = item;

	if (id === 'sql' || id === 'prql' || id === 'python') {
		opts?.insertQueryBlock?.(id, editor);
		return;
	}
	if (id === 'page') {
		opts?.insertPage?.(editor);
		return;
	}

	if (group === 'heading') {
		const level = id === 'h1' ? 1 : id === 'h2' ? 2 : 3;
		editor.chain().focus().setNode('heading', { level }).run();
		return;
	}
	if (id === 'divider') {
		editor.chain().focus().setHorizontalRule().run();
		return;
	}
	if (id === 'quote') {
		editor.chain().focus().setBlockquote().run();
		return;
	}
	if (id === 'code') {
		editor.chain().focus().setCodeBlock().run();
		return;
	}
	if (id === 'task') {
		editor.chain().focus().toggleTaskList().run();
		return;
	}
	if (id === 'table') {
		editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
		return;
	}
	if (id === 'image') {
		const url = prompt('Image URL');
		if (url) editor.chain().focus().setImage({ src: url }).run();
		return;
	}
	if (id === 'bullet') {
		editor.chain().focus().toggleBulletList().run();
		return;
	}
	if (id === 'numbered') {
		editor.chain().focus().toggleOrderedList().run();
		return;
	}
	if (id === 'emoji') {
		editor.chain().focus().insertContent(snippet).run();
		return;
	}

	// Markdoc widget snippets
	const trimmed = snippet.trim();
	if (group === 'widget' || trimmed.startsWith('{%')) {
		insertWidgetFromSnippet(editor, snippet);
		return;
	}
	editor.chain().focus().insertContent({ type: 'markdocBlock', attrs: { source: trimmed } }).run();
}

function moveToFollowingEmptyParagraph(editor: import('@tiptap/core').Editor): boolean {
	const { state, view } = editor;
	const { selection } = state;
	if (!selection.empty) return false;

	const { $from } = selection;
	if ($from.depth < 1) return false;
	if ($from.parentOffset !== $from.parent.content.size) return false;

	const topDepth = 1;
	const topNode = $from.node(topDepth);
	if (!ENTER_EXITS_TO_FOLLOWING_PARAGRAPH.has(topNode.type.name)) return false;

	// Only exit when there is no remaining text/content between the caret and the
	// end of the top-level block. This keeps nested/multi-paragraph blocks from
	// jumping out too early.
	if (state.doc.textBetween($from.pos, $from.end(topDepth), '\n', '\n').length > 0) {
		return false;
	}

	const paragraph = state.schema.nodes.paragraph;
	if (!paragraph) return false;

	const afterBlock = $from.after(topDepth);
	const next = state.doc.nodeAt(afterBlock);
	let tr = state.tr;

	if (!next || next.type.name !== 'paragraph' || next.content.size > 0) {
		tr = tr.insert(afterBlock, paragraph.create());
	}

	tr = tr.setSelection(TextSelection.create(tr.doc, afterBlock + 1)).scrollIntoView();
	view.dispatch(tr);
	return true;
}

function splitNonEmptyListItem(editor: import('@tiptap/core').Editor): boolean {
	const { state } = editor;
	const { selection } = state;
	if (!selection.empty) return false;

	const { $from } = selection;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		const node = $from.node(depth);
		if (node.type.name !== 'listItem' && node.type.name !== 'taskItem') continue;
		if (!node.textContent.trim()) return false;
		return editor.commands.splitListItem(node.type.name);
	}
	return false;
}

export const SlashCommandExtension = Extension.create<SlashCommandExtensionOptions>({
	name: 'slashCommand',
	priority: 1000,

	addOptions() {
		return {
			handler: {
				onStart: () => {},
				onUpdate: () => {},
				onExit: () => {}
			},
			insertQueryBlock: undefined,
			insertPage: undefined
		};
	},

	addKeyboardShortcuts() {
		return {
			Enter: () => {
				return splitNonEmptyListItem(this.editor) || moveToFollowingEmptyParagraph(this.editor);
			}
		};
	},

	addProseMirrorPlugins() {
		const handler = this.options.handler;
		const insertQueryBlock = this.options.insertQueryBlock;
		const insertPage = this.options.insertPage;
		const slashOpts = { insertQueryBlock, insertPage };
		const suggestion: Omit<SuggestionOptions<SlashCommand>, 'editor'> = {
			char: '/',
			pluginKey: slashCommandPluginKey,
			allow: ({ state, range }) => {
				const $from = state.doc.resolve(range.from);
				const isParagraph = $from.parent.type.name === 'paragraph';
				const isStart = $from.parent.textContent.slice(0, range.from - $from.start()).trim() === '/';
				return isParagraph || isStart;
			},
			items: ({ query }) => filterCommands(query),
			command: ({ editor, range, props }) => {
				editor.chain().focus().deleteRange(range).run();
				insertSlashItem(editor, props, slashOpts);
			},
			render: () => {
				let active = false;
				return {
					onStart: (props) => {
						active = true;
						handler.onStart({
							items: props.items,
							command: (item) => props.command(item)
						});
					},
					onUpdate: (props) => {
						handler.onUpdate({
							items: props.items,
							command: (item) => props.command(item)
						});
					},
					onKeyDown: (props) => {
						if (!active) return false;
						return handler.onKeyDown?.(props.event) ?? false;
					},
					onExit: () => {
						if (!active) return;
						active = false;
						handler.onExit();
					}
				};
			}
		};

		return [Suggestion({ editor: this.editor, ...suggestion })];
	}
});

export function createSlashCommandExtension(
	handler: SlashCommandHandler,
	opts?: Pick<SlashCommandExtensionOptions, 'insertQueryBlock' | 'insertPage'>
) {
	return SlashCommandExtension.configure({ handler, ...opts });
}
