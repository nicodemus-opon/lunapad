import type { Editor, Extensions } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import DragHandle from '@tiptap/extension-drag-handle';
import type { Cell } from '$lib/stores/notebook.svelte';
import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
import { createMarkdocBlockExtension } from './markdoc-block-extension';
import { createMarkdocWidgetExtension } from './markdoc-widget-extension';
import { createMarkdocContainerExtension } from './markdoc-container-extension';
import { createMarkdocExpressionExtension } from './markdoc-expression-extension';
import { createSlashCommandExtension, type SlashCommandHandler } from './slash-command-extension';
import { ListKeymapExtension } from './list-keymap-extension';
import { rankRefEntries } from './mention-utils';

export interface MentionCommandHandler {
	onStart: (props: {
		items: Array<{
			id: string;
			label: string;
			meta?: string;
			group: 'notebook' | 'project' | 'other';
		}>;
		moreCount: number;
		query: string;
		command: (item: { id: string; label: string }) => void;
	}) => void;
	onUpdate: (props: {
		items: Array<{
			id: string;
			label: string;
			meta?: string;
			group: 'notebook' | 'project' | 'other';
		}>;
		moreCount: number;
		query: string;
		command: (item: { id: string; label: string }) => void;
	}) => void;
	onExit: () => void;
	onKeyDown?: (event: KeyboardEvent) => boolean;
}

export interface BubbleMenuGate {
	isSlashOpen: () => boolean;
	isMentionOpen?: () => boolean;
	isContextMenuOpen: () => boolean;
	onShow?: () => void;
	onHide?: () => void;
}

export interface NotionEditorExtensionOptions {
	getCells: () => Cell[];
	getNotebookId: () => string;
	refEntries?: () => MarkdownRefEntry[];
	slashHandler: SlashCommandHandler;
	mentionHandler?: MentionCommandHandler;
	insertQueryBlock?: (
		lang: 'sql' | 'prql' | 'python',
		editor: import('@tiptap/core').Editor
	) => void;
	insertPage?: (editor: import('@tiptap/core').Editor) => void;
	bubbleMenuElement: HTMLElement;
	bubbleMenuGate: BubbleMenuGate;
	dragHandleRender: () => HTMLElement;
}

export function expandExtensionNames(extensions: Extensions): string[] {
	const names: string[] = [];
	const walk = (exts: Extensions) => {
		for (const ext of exts) {
			if (!ext) continue;
			names.push(ext.name);
			const childExts = (
				ext.config.addExtensions as ((this: typeof ext) => Extensions) | undefined
			)?.call(ext);
			if (Array.isArray(childExts) && childExts.length) walk(childExts);
		}
	};
	walk(extensions);
	return names;
}

export function buildNotionEditorExtensions(opts: NotionEditorExtensionOptions): Extensions {
	const refEntries = opts.refEntries ?? (() => []);
	const gate = opts.bubbleMenuGate;
	const mentionHandler = opts.mentionHandler;
	const notebookCellNames = () =>
		new Set(
			opts
				.getCells()
				.map((c) => c.outputName)
				.filter(Boolean)
		);

	return [
		StarterKit.configure({
			heading: { levels: [1, 2, 3, 4, 5, 6] },
			dropcursor: { color: 'var(--ring)', width: 2 },
			link: false,
			underline: false,
			listKeymap: false
		}),
		ListKeymapExtension,
		Placeholder.configure({
			placeholder: "Type '/' for commands, or start writing…"
		}),
		Underline,
		Highlight,
		Link.configure({ openOnClick: false, autolink: true }),
		TaskList,
		TaskItem.configure({ nested: true }),
		Table.configure({ resizable: true }),
		TableRow,
		TableHeader,
		TableCell,
		Image.configure({ inline: false, allowBase64: true }),
		Mention.configure({
			HTMLAttributes: { class: 'mention' },
			suggestion: {
				char: '@',
				items: ({ query }) => {
					const { visible } = rankRefEntries(
						query,
						refEntries(),
						opts.getCells(),
						notebookCellNames()
					);
					return visible.map((r) => ({
						id: r.entry.cellName,
						label: r.entry.cellName,
						meta: r.meta,
						group: r.group
					}));
				},
				render: () => {
					if (!mentionHandler) {
						return {
							onStart: () => {},
							onUpdate: () => {},
							onKeyDown: () => false,
							onExit: () => {}
						};
					}
					let active = false;
					return {
						onStart: (props) => {
							active = true;
							const { visible, moreCount } = rankRefEntries(
								props.query,
								refEntries(),
								opts.getCells(),
								notebookCellNames()
							);
							mentionHandler.onStart({
								items: visible.map((r) => ({
									id: r.entry.cellName,
									label: r.entry.cellName,
									meta: r.meta,
									group: r.group
								})),
								moreCount,
								query: props.query,
								command: (item) => props.command(item)
							});
						},
						onUpdate: (props) => {
							const { visible, moreCount } = rankRefEntries(
								props.query,
								refEntries(),
								opts.getCells(),
								notebookCellNames()
							);
							mentionHandler.onUpdate({
								items: visible.map((r) => ({
									id: r.entry.cellName,
									label: r.entry.cellName,
									meta: r.meta,
									group: r.group
								})),
								moreCount,
								query: props.query,
								command: (item) => props.command(item)
							});
						},
						onKeyDown: (props) => {
							if (!active) return false;
							return mentionHandler.onKeyDown?.(props.event) ?? false;
						},
						onExit: () => {
							if (!active) return;
							active = false;
							mentionHandler.onExit();
						}
					};
				}
			}
		}),
		createMarkdocBlockExtension({
			getCells: opts.getCells,
			getNotebookId: opts.getNotebookId
		}),
		createMarkdocWidgetExtension({
			getCells: opts.getCells,
			getNotebookId: opts.getNotebookId
		}),
		createMarkdocContainerExtension({
			getCells: opts.getCells
		}),
		createMarkdocExpressionExtension({
			getCells: opts.getCells,
			getNotebookId: opts.getNotebookId
		}),
		createSlashCommandExtension(opts.slashHandler, {
			refEntries,
			insertQueryBlock: opts.insertQueryBlock,
			insertPage: opts.insertPage
		}),
		BubbleMenu.configure({
			element: opts.bubbleMenuElement,
			shouldShow: ({ editor, state, view, from, to }) => {
				if (!editor.isEditable) return false;
				if (!view.hasFocus()) return false;
				if (gate.isSlashOpen()) return false;
				if (gate.isMentionOpen?.()) return false;
				if (gate.isContextMenuOpen()) return false;
				if (from === to) return false;
				if (state.selection instanceof NodeSelection) return false;
				if (editor.isActive('codeBlock')) return false;
				const text = state.doc.textBetween(from, to, ' ');
				if (!text.trim()) return false;
				return true;
			},
			options: {
				onShow: () => gate.onShow?.(),
				onHide: () => gate.onHide?.(),
				placement: 'top',
				offset: 6
			}
		}),
		DragHandle.configure({
			render: opts.dragHandleRender,
			nested: true
		})
	];
}

export type { Editor };
