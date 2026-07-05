import { Extension } from '@tiptap/core';
import { PluginKey, TextSelection } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import {
	buildContextualMarkdocSnippet,
	getUsableMarkdocRefEntry
} from '$lib/services/markdoc-contextual-snippets';
import { SLASH_COMMANDS, type SlashCommand } from '$lib/services/markdown-format';
import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
import { markdownToPmDocument } from '$lib/services/markdoc-pm';

export const slashCommandPluginKey = new PluginKey('slashCommand');
const ENTER_EXITS_TO_FOLLOWING_PARAGRAPH = new Set(['heading', 'blockquote']);

/** Remove the "/" trigger left behind when the slash menu is dismissed without
 * picking a command. Deletes only the single trigger character at range.from
 * (preserving any query text the user typed), so it never eats real content.
 * Deferred to the next tick so we don't dispatch inside the suggestion apply. */
function removeAbandonedSlash(
	editor: import('@tiptap/core').Editor,
	range: { from: number }
): void {
	setTimeout(() => {
		if (editor.isDestroyed) return;
		const from = range.from;
		const to = from + 1;
		if (to > editor.state.doc.content.size) return;
		if (editor.state.doc.textBetween(from, to) !== '/') return;
		editor
			.chain()
			.command(({ tr }) => {
				tr.delete(from, to);
				return true;
			})
			.run();
	}, 0);
}

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
	refEntries?: () => MarkdownRefEntry[];
	insertQueryBlock?: (
		lang: 'sql' | 'prql' | 'python',
		editor: import('@tiptap/core').Editor
	) => void;
	insertPage?: (editor: import('@tiptap/core').Editor) => void;
}

export function contextualSnippet(item: SlashCommand, entries: MarkdownRefEntry[]): string {
	return buildContextualMarkdocSnippet(item.id, entries) || item.snippet;
}

function filterCommands(query: string, entries: MarkdownRefEntry[] = []): SlashCommand[] {
	const q = query.toLowerCase().trim();
	const hasUsableRef = Boolean(getUsableMarkdocRefEntry(entries));
	const availableCommands = hasUsableRef
		? SLASH_COMMANDS
		: SLASH_COMMANDS.filter((cmd) => cmd.group !== 'report');
	if (!q) return availableCommands.slice(0, 32);

	const scored = availableCommands.map((cmd) => {
		let score = 0;
		if (cmd.id.toLowerCase() === q) score += 100;
		else if (cmd.label.toLowerCase().startsWith(q)) score += 60;
		else if (cmd.id.toLowerCase().startsWith(q)) score += 50;
		else if (cmd.label.toLowerCase().includes(q)) score += 30;
		else if (cmd.description.toLowerCase().includes(q)) score += 15;
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

	return scored.slice(0, 32).map((x) => x.cmd);
}

/** Build TipTap-ready nodes from a markdoc snippet (same path as loading markdown). */
export function pmContentFromSnippet(snippet: string) {
	return markdownToPmDocument(snippet.trim()).doc.content ?? [];
}

function insertWidgetFromSnippet(editor: import('@tiptap/core').Editor, snippet: string): void {
	const content = pmContentFromSnippet(snippet);
	if (!content.length) {
		editor
			.chain()
			.focus()
			.insertContent({ type: 'markdocBlock', attrs: { source: snippet.trim() } })
			.run();
		return;
	}
	editor.chain().focus().insertContent(content).run();
}

function insertSlashItem(
	editor: import('@tiptap/core').Editor,
	item: SlashCommand,
	opts?: Pick<SlashCommandExtensionOptions, 'insertQueryBlock' | 'insertPage' | 'refEntries'>
): void {
	const { id, group } = item;
	const snippet = contextualSnippet(item, opts?.refEntries?.() ?? []);

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
	editor
		.chain()
		.focus()
		.insertContent({ type: 'markdocBlock', attrs: { source: trimmed } })
		.run();
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
		const refEntries = this.options.refEntries;
		const slashOpts = { insertQueryBlock, insertPage, refEntries };
		// Guards the onExit cleanup: when a command runs it already deleteRange()s the
		// trigger, so onExit must NOT delete again (that would eat real content).
		let commandExecuted = false;
		const suggestion: Omit<SuggestionOptions<SlashCommand>, 'editor'> = {
			char: '/',
			pluginKey: slashCommandPluginKey,
			allow: ({ state, range }) => {
				const $from = state.doc.resolve(range.from);
				const isParagraph = $from.parent.type.name === 'paragraph';
				const isStart =
					$from.parent.textContent.slice(0, range.from - $from.start()).trim() === '/';
				return isParagraph || isStart;
			},
			items: ({ query }) => filterCommands(query, refEntries?.() ?? []),
			command: ({ editor, range, props }) => {
				commandExecuted = true;
				editor.chain().focus().deleteRange(range).run();
				insertSlashItem(editor, props, slashOpts);
			},
			render: () => {
				let active = false;
				return {
					onStart: (props) => {
						active = true;
						commandExecuted = false;
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
					onExit: (props) => {
						if (!active) return;
						active = false;
						// Dismissed (Escape / click-away / caret moved) without picking a
						// command: the "/" trigger was never consumed by deleteRange, so it
						// lingers in the doc — glued to prose ("…month./") or as a lone
						// paragraph from the drag-gutter "+" affordance. Both leak into the
						// serialized markdown. Remove the abandoned trigger char (keeping any
						// filter text the user typed). Defer so we don't mutate mid-apply.
						if (!commandExecuted) removeAbandonedSlash(props.editor, props.range);
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
	opts?: Pick<SlashCommandExtensionOptions, 'insertQueryBlock' | 'insertPage' | 'refEntries'>
) {
	return SlashCommandExtension.configure({ handler, ...opts });
}
