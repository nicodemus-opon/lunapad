<script lang="ts">
	import { onDestroy, untrack, mount, unmount } from 'svelte';
	import { browser } from '$app/environment';
	import SlashMenu from './SlashMenu.svelte';
	import MentionMenu from './MentionMenu.svelte';
	import type { MentionItem } from './mention-utils';
	import BubbleToolbar from './BubbleToolbar.svelte';
	import { cellsToPmDocument } from '$lib/services/notebook-pm';
	import type { PMDocJSON } from '$lib/services/markdoc-pm';
	import type { SlashCommand } from '$lib/services/markdown-format';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import {
		syncNotebookFromPmDocument,
		insertQueryBlockCell,
		removeQueryBlockCell,
		getNotebooks
	} from '$lib/stores/notebook.svelte';
	import { buildNotebookDocumentExtensions } from './notebook-document-extensions';
	import { clampMenuPosition, handleMenuKeyDown } from './menu-utils';

	type TipTapEditor = import('@tiptap/core').Editor;

	interface Props {
		notebookId: string;
		cells: Cell[];
		dark?: boolean;
		reportView?: boolean;
		refEntries?: MarkdownRefEntry[];
	}

	const {
		notebookId,
		cells,
		dark = false,
		reportView = false,
		refEntries = []
	}: Props = $props();

	let editorMount = $state<HTMLDivElement | null>(null);
	let editor = $state<TipTapEditor | null>(null);
	let lastEmitted: PMDocJSON | null = null;
	let emitTimer: ReturnType<typeof setTimeout> | null = null;
	let initError = $state<string | null>(null);

	let slashOpen = $state(false);
	let slashItems = $state<SlashCommand[]>([]);
	let slashSelected = $state(0);
	let slashCommandFn = $state<((item: SlashCommand) => void) | null>(null);
	let slashMenuPos = $state({ top: 0, left: 0 });

	let mentionOpen = $state(false);
	let mentionItems = $state<MentionItem[]>([]);
	let mentionMoreCount = $state(0);
	let mentionQuery = $state('');
	let mentionSelected = $state(0);
	let mentionCommandFn = $state<((item: { id: string; label: string }) => void) | null>(null);
	let mentionMenuPos = $state({ top: 0, left: 0 });

	let bubbleHost = $state<HTMLDivElement | null>(null);
	let bubbleVisible = $state(false);
	let bubbleToolbarMount: ReturnType<typeof mount> | null = null;

	const bubbleGate = {
		isSlashOpen: () => slashOpen,
		isMentionOpen: () => mentionOpen,
		isContextMenuOpen: () => false,
		onShow: () => {
			bubbleVisible = true;
		},
		onHide: () => {
			bubbleVisible = false;
		}
	};

	function findAnchorCellId(ed: TipTapEditor): string | null {
		const from = ed.state.selection.from;
		let lastId: string | null = null;
		ed.state.doc.forEach((node, offset) => {
			if (offset >= from) return false;
			if (node.type.name === 'queryBlock') {
				lastId = String(node.attrs.cellId ?? '');
			}
		});
		if (lastId) return lastId;
		return cells.length ? cells[cells.length - 1].id : null;
	}

	function insertQueryBlock(lang: 'sql' | 'prql' | 'python', ed: TipTapEditor) {
		// The slash trigger text ("/sql"...) was already removed by the suggestion
		// command. Insert the visual query block in the same editor flow, then sync
		// that exact document to the store so focus does not jump back to the old line.
		if (emitTimer) {
			clearTimeout(emitTimer);
			emitTimer = null;
		}
		const anchorId = findAnchorCellId(ed);
		const cellId = insertQueryBlockCell(anchorId, lang);
		ed
			.chain()
			.focus()
			.insertContent([
				{
					type: 'queryBlock',
					attrs: { cellId, cellType: lang === 'python' ? 'python' : 'query', pinned: false }
				},
				{ type: 'paragraph' }
			])
			.run();
		if (emitTimer) {
			clearTimeout(emitTimer);
			emitTimer = null;
		}
		emitNow(ed);
	}

	// The drag-gutter "+" (and empty-line trigger) opens the slash menu by dropping a
	// "/" paragraph. It must insert *after* the current block — never at the raw
	// selection — because when a queryBlock is node-selected (e.g. right after the
	// user clicked its Focus/gutter), a plain insertContent REPLACES that node, which
	// silently deletes the whole query cell. Resolve a position at the end of the
	// current top-level block instead.
	function addBlockBelow(ed: TipTapEditor) {
		const { state } = ed;
		const sel = state.selection;
		const nodeSel = (sel as unknown as { node?: unknown }).node;
		let insertPos: number;
		if (nodeSel) {
			// A whole top-level node is selected — go right after it.
			insertPos = sel.to;
		} else {
			const resolvedTo = sel.$to;
			insertPos = resolvedTo.depth >= 1 ? resolvedTo.after(1) : state.doc.content.size;
		}
		insertPos = Math.min(insertPos, state.doc.content.size);
		ed
			.chain()
			.insertContentAt(insertPos, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
			.setTextSelection(insertPos + 2)
			.focus()
			.run();
	}

	function insertPage(ed: TipTapEditor) {
		const pageId = `page-${Date.now().toString(36)}`;
		ed
			.chain()
			.focus()
			.insertContent({
				type: 'notebookPage',
				attrs: { title: 'Untitled', pageId }
			})
			.insertContent({ type: 'paragraph' })
			.run();
	}

	function emitNow(ed: TipTapEditor) {
		const doc = ed.getJSON() as PMDocJSON;
		syncNotebookFromPmDocument(notebookId, doc);
		// Align lastEmitted with the doc the reactive cells→document effect will
		// reconstruct (cellsToPmDocument), NOT the raw editor JSON. The markdown
		// round-trip is lossy, so the two rarely match byte-for-byte; using the raw
		// JSON made the effect think the store had diverged and call setContent() on
		// every keystroke — which resets the caret to the top and closes the slash /
		// mention menus mid-typing. Reconstructing here keeps self-originated edits
		// from triggering a spurious re-render.
		const cellsNow = getNotebooks().find((n) => n.id === notebookId)?.cells ?? [];
		lastEmitted = cellsToPmDocument(cellsNow);
	}

	function scheduleEmit(ed: TipTapEditor) {
		if (emitTimer) clearTimeout(emitTimer);
		emitTimer = setTimeout(() => emitNow(ed), 150);
	}

	function positionSlashMenu(ed: TipTapEditor) {
		const coords = ed.view.coordsAtPos(ed.state.selection.from);
		slashMenuPos = clampMenuPosition(
			{ top: coords.top, left: coords.left, bottom: coords.bottom },
			{ width: 288, height: 320 }
		);
	}

	function positionMentionMenu(ed: TipTapEditor) {
		const coords = ed.view.coordsAtPos(ed.state.selection.from);
		mentionMenuPos = clampMenuPosition(
			{ top: coords.top, left: coords.left, bottom: coords.bottom },
			{ width: 288, height: 320 }
		);
	}

	let booting = false;
	let destroyed = false;

	async function bootEditor() {
		if (!browser || !editorMount || destroyed || editor || booting) return;
		if (!bubbleHost) return;
		booting = true;
		try {
			const { Editor } = await import('@tiptap/core');
			if (destroyed || !editorMount || !bubbleHost) return;

			const dragGutter = document.createElement('div');
			dragGutter.className = 'notion-drag-gutter';
			dragGutter.innerHTML = `
				<button type="button" class="notion-plus-btn" title="Add block below" aria-label="Add block">
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
				</button>
				<div class="notion-drag-handle" data-drag-handle draggable="true" title="Drag to reorder">
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
				</div>
			`;

			const pmDoc = cellsToPmDocument(cells);
			lastEmitted = pmDoc;

			const ed = new Editor({
				element: editorMount,
				extensions: buildNotebookDocumentExtensions({
					getCells: () => cells,
					getNotebookId: () => notebookId,
					refEntries: () => refEntries,
					bubbleMenuElement: bubbleHost,
					bubbleMenuGate: bubbleGate,
					dragHandleRender: () => dragGutter,
					insertQueryBlock: (lang, e) => insertQueryBlock(lang, e),
					insertPage,
					slashHandler: {
						onStart: ({ items, command }) => {
							slashItems = items;
							slashSelected = 0;
							slashCommandFn = command;
							slashOpen = true;
							positionSlashMenu(ed);
						},
						onUpdate: ({ items, command }) => {
							slashItems = items;
							slashSelected = Math.min(slashSelected, Math.max(0, items.length - 1));
							slashCommandFn = command;
							positionSlashMenu(ed);
						},
						onExit: () => {
							slashOpen = false;
							slashCommandFn = null;
						},
						onKeyDown: (e) => handleSlashKeydown(e)
					},
					mentionHandler: {
						onStart: ({ items, moreCount, query, command }) => {
							mentionItems = items;
							mentionMoreCount = moreCount;
							mentionQuery = query;
							mentionSelected = 0;
							mentionCommandFn = command;
							mentionOpen = true;
							positionMentionMenu(ed);
						},
						onUpdate: ({ items, moreCount, query, command }) => {
							mentionItems = items;
							mentionMoreCount = moreCount;
							mentionQuery = query;
							mentionSelected = Math.min(mentionSelected, Math.max(0, items.length - 1));
							mentionCommandFn = command;
							positionMentionMenu(ed);
						},
						onExit: () => {
							mentionOpen = false;
							mentionCommandFn = null;
						},
						onKeyDown: (e) => handleMentionKeydown(e)
					},
					queryBlock: {
						getCells: () => cells,
						getNotebookId: () => notebookId,
						reportView: () => reportView,
						dark: () => dark,
						onDeleteCell: (cellId) => removeQueryBlockCell(cellId)
					}
				}),
				content: pmDoc,
				editorProps: {
					attributes: {
						class:
							'notion-surface notebook-document-surface markdown-surface prose markdown-body min-h-28 w-full px-0 pt-1 pb-24 focus:outline-none'
					}
				},
				onUpdate: ({ editor: e }) => scheduleEmit(e)
			});

			dragGutter.querySelector('.notion-plus-btn')?.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				addBlockBelow(ed);
			});

			editor = ed;
			if (import.meta.env.DEV && typeof window !== 'undefined') {
				(window as unknown as { __pmEditor?: unknown }).__pmEditor = ed;
			}
			bubbleToolbarMount = mount(BubbleToolbar, {
				target: bubbleHost,
				props: { editor: ed }
			});
		} catch (e) {
			initError = e instanceof Error ? e.message : 'Failed to load document editor';
		} finally {
			booting = false;
		}
	}

	function handleSlashKeydown(e: KeyboardEvent): boolean {
		if (!slashOpen || !slashItems.length) return false;
		return handleMenuKeyDown(e, {
			itemCount: () => slashItems.length,
			getSelectedIndex: () => slashSelected,
			setSelectedIndex: (i) => {
				slashSelected = i;
			},
			selectAt: (i) => {
				const cmd = slashItems[i];
				if (cmd && slashCommandFn) slashCommandFn(cmd);
				slashOpen = false;
			},
			close: () => {
				slashOpen = false;
			}
		});
	}

	function handleMentionKeydown(e: KeyboardEvent): boolean {
		if (!mentionOpen) return false;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return true;
		if (!mentionItems.length) return false;
		return handleMenuKeyDown(e, {
			itemCount: () => mentionItems.length,
			getSelectedIndex: () => mentionSelected,
			setSelectedIndex: (i) => {
				mentionSelected = i;
			},
			selectAt: (i) => {
				const item = mentionItems[i];
				if (item && mentionCommandFn) mentionCommandFn(item);
				mentionOpen = false;
			},
			close: () => {
				mentionOpen = false;
			}
		});
	}

	/** Place the caret on the last editable line, appending a trailing paragraph if the
	 * document ends in an atom block. Backs the Notion-style "click empty space to type". */
	function focusDocumentEnd() {
		const ed = editor;
		if (!ed) return;
		const last = ed.state.doc.lastChild;
		if (last && last.isAtom) {
			ed.chain().insertContentAt(ed.state.doc.content.size, { type: 'paragraph' }).run();
		}
		ed.chain().focus('end').run();
	}

	// Clicking the empty region below the content (the host padding, outside the
	// ProseMirror element) should drop the caret on the last line, like Notion.
	function onContainerPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		const t = e.target as HTMLElement | null;
		if (!t) return;
		if (
			t.classList.contains('notebook-document-host') ||
			t.classList.contains('notebook-document-editor')
		) {
			e.preventDefault();
			focusDocumentEnd();
		}
	}

	$effect(() => {
		if (editorMount && bubbleHost && browser && !editor) void bootEditor();
	});

	onDestroy(() => {
		destroyed = true;
		if (emitTimer) clearTimeout(emitTimer);
		if (bubbleToolbarMount) unmount(bubbleToolbarMount);
		editor?.destroy();
		editor = null;
	});

	$effect(() => {
		const c = cells;
		const layoutKey = c.map((cell) => cell.id).join('\0');
		void layoutKey;
		void notebookId;
		untrack(() => {
			if (!editor) return;
			const pmDoc = cellsToPmDocument(c);
			const serialized = JSON.stringify(pmDoc);
			if (lastEmitted && JSON.stringify(lastEmitted) === serialized) return;
			lastEmitted = pmDoc;
			editor.commands.setContent(pmDoc, { emitUpdate: false });
			bubbleVisible = false;
		});
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="notebook-document-editor markdown-surface relative min-w-0 flex-1"
	onpointerdown={onContainerPointerDown}
>
	{#if initError}
		<div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
			Document editor failed: {initError}
		</div>
	{/if}

	<div bind:this={bubbleHost} class="bubble-host" class:is-visible={bubbleVisible}></div>
	<div bind:this={editorMount} class="notebook-document-host"></div>

	{#if slashOpen && slashItems.length}
		<div
			class="slash-menu-anchor fixed z-50"
			style="top: {slashMenuPos.top}px; left: {slashMenuPos.left}px;"
		>
			<SlashMenu
				items={slashItems}
				selectedIndex={slashSelected}
				onSelect={(cmd) => {
					if (slashCommandFn) slashCommandFn(cmd);
					slashOpen = false;
				}}
				onHoverIndex={(i) => {
					slashSelected = i;
				}}
			/>
		</div>
	{/if}

	{#if mentionOpen}
		<div
			class="mention-menu-anchor fixed z-50"
			style="top: {mentionMenuPos.top}px; left: {mentionMenuPos.left}px;"
		>
			<MentionMenu
				items={mentionItems}
				moreCount={mentionMoreCount}
				query={mentionQuery}
				selectedIndex={mentionSelected}
				onSelect={(item) => {
					if (mentionCommandFn) mentionCommandFn(item);
					mentionOpen = false;
				}}
				onHoverIndex={(i) => {
					mentionSelected = i;
				}}
			/>
		</div>
	{/if}
</div>

<style>
	.notebook-document-editor :global(.notion-drag-gutter) {
		margin-left: calc(-1 * var(--notebook-gutter-width) + 0.25rem);
	}
	:global(.notebook-document-surface) {
		font-size: var(--text-sm);
		line-height: 1.65;
		color: var(--foreground);
	}
	:global(.notebook-document-surface h1) {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 1.25rem 0 0.5rem;
	}
	:global(.notebook-document-surface h2) {
		font-size: 1.35rem;
		font-weight: 600;
		margin: 1rem 0 0.4rem;
	}
	:global(.notebook-document-surface h3) {
		font-size: 1.15rem;
		font-weight: 600;
		margin: 0.75rem 0 0.35rem;
	}
	:global(.notebook-document-surface p) {
		margin: 0.35rem 0;
	}
	.bubble-host {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 40;
		visibility: hidden;
		pointer-events: none;
	}
	.bubble-host.is-visible {
		visibility: visible;
		pointer-events: auto;
	}
	.notebook-document-host {
		min-height: 60vh;
		cursor: text;
	}
</style>
