<script lang="ts">
	import { onDestroy, untrack, mount, unmount } from 'svelte';
	import { browser } from '$app/environment';
	import SlashMenu from './SlashMenu.svelte';
	import MentionMenu from './MentionMenu.svelte';
	import type { MentionItem } from './mention-utils';
	import BubbleToolbar from './BubbleToolbar.svelte';
	import LinkPopover from './LinkPopover.svelte';
	import MediaInsertPopover from './MediaInsertPopover.svelte';
	import { handleImageDrop, handleImagePaste } from './image-drop-paste';
	import { pmContentFromSnippet } from './slash-command-extension';
	import { sanitizeUrl } from '$lib/services/safe-url';
	import { cellsToPmDocument, pmDocumentToBlocks } from '$lib/services/notebook-pm';
	import type { PMDocJSON } from '$lib/services/markdoc-pm';
	import type { SlashCommand } from '$lib/services/markdown-format';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import type { PlotStarterKind } from '$lib/services/plot-defaults';
	import {
		syncNotebookFromPmDocument,
		insertQueryBlockCell,
		removeQueryBlockCell,
		duplicateQueryBlockCell,
		getNotebooks
	} from '$lib/stores/notebook.svelte';
	import { buildNotebookDocumentExtensions } from './notebook-document-extensions';
	import { createRefreshBus } from './nodeview-refresh-bus';
	import { clampMenuPosition, handleMenuKeyDown } from './menu-utils';
	import BodyPortal from '$lib/components/ui/body-portal.svelte';
	import NodeConfigPopover from './NodeConfigPopover.svelte';
	import BlockMenu from './BlockMenu.svelte';
	import {
		buildBlockMenuGroups,
		insertBlockAbove,
		turnBlockInto,
		duplicateBlockAt,
		deleteBlockAt,
		copyHeadingLinkAt,
		type BlockMenuGroup
	} from './block-menu-actions';
	import {
		syncMarkdocNodeSelection,
		visualBlockFromSelection,
		patchMarkdocNodeSelection,
		type MarkdocSelectedNode
	} from './markdoc-node-selection';
	import { findFilterUsages } from '$lib/services/markdoc-visual-analysis';
	import { createDragGutter, type DragGutterHandle } from './drag-gutter';

	type TipTapEditor = import('@tiptap/core').Editor;
	type NodeSelectionClass = typeof import('@tiptap/pm/state').NodeSelection;

	interface Props {
		notebookId: string;
		cells: Cell[];
		dark?: boolean;
		reportView?: boolean;
		refEntries?: MarkdownRefEntry[];
	}

	const { notebookId, cells, dark = false, reportView = false, refEntries = [] }: Props = $props();

	const refreshBus = createRefreshBus();

	let editorMount = $state<HTMLDivElement | null>(null);
	let editor = $state<TipTapEditor | null>(null);
	let lastEmitted: PMDocJSON | null = null;
	let emitTimer: ReturnType<typeof setTimeout> | null = null;
	let initError = $state<string | null>(null);
	// While the user is actively editing prose we must never call setContent():
	// it rebuilds the whole document and resets the caret to the top, which
	// splits text mid-typing (e.g. a markdown "# " heading followed by its title
	// landing in a separate paragraph). Defer any store→document reconciliation
	// until the editor loses focus.
	let editorFocused = false;
	let blurFlushPending = false;
	let pendingReconcile = false;
	let latestCells: Cell[] = [];
	/** Notebook id the editor content belongs to — guards blur/debounced emits after tab switches. */
	let editingNotebookId: string | null = null;
	let loadedNotebookId: string | null = null;
	let reconcilingFromStore = false;
	let dragGutter: DragGutterHandle | null = null;

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

	// Media insert popover ("/image" slash command)
	let mediaPopoverOpen = $state(false);
	let mediaPopoverKind = $state<'image' | 'video'>('image');
	let mediaPopoverPos = $state({ top: 0, left: 0 });
	let mediaPopoverEditor: TipTapEditor | null = null;

	function onRequestMedia(kind: 'image' | 'video', ed: TipTapEditor) {
		mediaPopoverEditor = ed;
		mediaPopoverKind = kind;
		const coords = ed.view.coordsAtPos(ed.state.selection.from);
		mediaPopoverPos = clampMenuPosition(
			{ top: coords.top, left: coords.left, bottom: coords.bottom },
			{ width: 288, height: 160 }
		);
		mediaPopoverOpen = true;
	}

	function applyMediaInsert(src: string) {
		const ed = mediaPopoverEditor;
		const kind = mediaPopoverKind;
		mediaPopoverOpen = false;
		if (!ed) return;
		if (kind === 'image') {
			ed.chain().focus().setImage({ src }).run();
		} else {
			const content = pmContentFromSnippet(`{% video src=${JSON.stringify(src)} /%}`);
			ed.chain().focus().insertContent(content).run();
		}
	}

	// Link popover state (bubble toolbar link button + "/link" slash command)
	let linkPopoverOpen = $state(false);
	let linkPopoverPos = $state({ top: 0, left: 0 });
	let linkPopoverEditor: TipTapEditor | null = null;

	function onRequestLink(ed: TipTapEditor) {
		linkPopoverEditor = ed;
		const coords = ed.view.coordsAtPos(ed.state.selection.from);
		linkPopoverPos = clampMenuPosition(
			{ top: coords.top, left: coords.left, bottom: coords.bottom },
			{ width: 288, height: 60 }
		);
		linkPopoverOpen = true;
	}

	function applyLinkFromPopover(url: string) {
		const ed = linkPopoverEditor;
		linkPopoverOpen = false;
		if (!ed) return;
		const safe = sanitizeUrl(url);
		if (!safe) {
			ed.commands.focus();
			return;
		}
		const { from, to } = ed.state.selection;
		if (from === to) {
			ed.chain()
				.focus()
				.insertContent({
					type: 'text',
					text: safe,
					marks: [{ type: 'link', attrs: { href: safe } }]
				})
				.run();
		} else {
			ed.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
		}
	}

	// Block menu (drag-handle click)
	let blockMenuOpen = $state(false);
	let blockMenuPos = $state({ top: 0, left: 0 });
	let blockMenuGroups = $state<BlockMenuGroup[]>([]);
	let blockMenuSelected = $state(0);
	let blockMenuNodePos: number | null = null;

	function openBlockMenu(pos: number | null, handleEl: HTMLElement) {
		if (pos === null || !editor) return;
		blockMenuNodePos = pos;
		blockMenuGroups = buildBlockMenuGroups(editor, pos);
		blockMenuSelected = 0;
		const rect = handleEl.getBoundingClientRect();
		blockMenuPos = clampMenuPosition(
			{ top: rect.top, left: rect.right, bottom: rect.bottom },
			{ width: 224, height: 320 },
			{ placement: 'beside' }
		);
		blockMenuOpen = true;
		dragGutter?.setOpen(true);
	}

	function closeBlockMenu() {
		blockMenuOpen = false;
		blockMenuNodePos = null;
		dragGutter?.setOpen(false);
		editor?.commands.focus();
	}

	function handleBlockMenuSelect(id: string) {
		const ed = editor;
		const pos = blockMenuNodePos;
		closeBlockMenu();
		if (!ed || pos === null) return;
		if (id === 'add-above') {
			insertBlockAbove(ed, pos);
			return;
		}
		if (id === 'add-below') {
			openSlashBelow(ed, pos);
			return;
		}
		if (id === 'duplicate') {
			duplicateBlockAt(ed, pos, {
				onDuplicateQueryBlock: (cellId) => duplicateQueryBlockCell(cellId, notebookId)
			});
			return;
		}
		if (id === 'delete') {
			deleteBlockAt(ed, pos, { onDeleteQueryBlock: (cellId) => removeQueryBlockCell(cellId) });
			return;
		}
		if (id === 'copy-link') {
			const anchor = copyHeadingLinkAt(ed, pos, cells);
			if (anchor && typeof navigator !== 'undefined' && navigator.clipboard) {
				const url = `${location.origin}${location.pathname}#${anchor}`;
				void navigator.clipboard.writeText(url);
			}
			return;
		}
		if (id.startsWith('turn-')) {
			turnBlockInto(ed, pos, id);
		}
	}

	function handleBlockMenuKeydown(e: KeyboardEvent): boolean {
		if (!blockMenuOpen) return false;
		const flat = blockMenuGroups.flatMap((g) => g.items);
		return handleMenuKeyDown(e, {
			itemCount: () => flat.length,
			getSelectedIndex: () => blockMenuSelected,
			setSelectedIndex: (i) => {
				blockMenuSelected = i;
			},
			selectAt: (i) => {
				const item = flat[i];
				if (item && !item.disabled) handleBlockMenuSelect(item.id);
			},
			close: closeBlockMenu
		});
	}

	let bubbleHost = $state<HTMLDivElement | null>(null);
	let bubbleVisible = $state(false);
	let bubbleToolbarMount: ReturnType<typeof mount> | null = null;

	let selectedNodeInfo = $state<MarkdocSelectedNode | null>(null);
	let nodeConfigOpen = $state(false);
	let NodeSelectionCtor: NodeSelectionClass | null = null;

	const selectedBlock = $derived(visualBlockFromSelection(selectedNodeInfo));
	const filterUsages = $derived.by(() => {
		const params = new Set<string>();
		for (const cell of cells) {
			for (const match of cell.code.matchAll(/\{%\s*filter\b[^%]*\bparam="([^"]+)"/g)) {
				if (match[1]) params.add(match[1]);
			}
		}
		return Object.fromEntries([...params].map((param) => [param, findFilterUsages(cells, param)]));
	});

	const bubbleGate = {
		isSlashOpen: () => slashOpen,
		isMentionOpen: () => mentionOpen,
		isContextMenuOpen: () => nodeConfigOpen || linkPopoverOpen || blockMenuOpen || mediaPopoverOpen,
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

	function insertQueryBlock(
		lang: 'sql' | 'prql' | 'python' | 'plot',
		ed: TipTapEditor,
		plotKind?: PlotStarterKind
	) {
		// The slash trigger text ("/sql"...) was already removed by the suggestion
		// command. Insert the visual query block in the same editor flow, then sync
		// that exact document to the store so focus does not jump back to the old line.
		if (emitTimer) {
			clearTimeout(emitTimer);
			emitTimer = null;
		}
		emitNow(ed, notebookId);
		const anchorId = findAnchorCellId(ed);
		const cellId = insertQueryBlockCell(anchorId, lang, notebookId, plotKind);
		ed.chain()
			.focus()
			.insertContent([
				{
					type: 'queryBlock',
					attrs: {
						cellId,
						cellType: lang === 'python' ? 'python' : lang === 'plot' ? 'plot' : 'query',
						pinned: false
					}
				},
				{ type: 'paragraph' }
			])
			.run();
		if (emitTimer) {
			clearTimeout(emitTimer);
			emitTimer = null;
		}
		emitNow(ed, notebookId);
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
		ed.chain()
			.insertContentAt(insertPos, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
			.setTextSelection(insertPos + 2)
			.focus()
			.run();
	}

	/** Insert a "/" paragraph right after the given top-level block and open the slash
	 * menu there — used by the gutter "+" button when hovering a specific block, so the
	 * insert lands where the user is pointing rather than at the current selection. */
	function openSlashBelow(ed: TipTapEditor, pos: number) {
		const node = ed.state.doc.nodeAt(pos);
		if (!node) {
			addBlockBelow(ed);
			return;
		}
		const insertPos = pos + node.nodeSize;
		ed.chain()
			.focus()
			.insertContentAt(insertPos, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
			.setTextSelection(insertPos + 2)
			.run();
	}

	function insertPage(ed: TipTapEditor) {
		const pageId = `page-${Date.now().toString(36)}`;
		ed.chain()
			.focus()
			.insertContent({
				type: 'notebookPage',
				attrs: { title: 'Untitled', pageId }
			})
			.insertContent({ type: 'paragraph' })
			.run();
	}

	function emitNow(ed: TipTapEditor, targetNotebookId: string) {
		if (!getNotebooks().some((n) => n.id === targetNotebookId)) return;
		const doc = ed.getJSON() as PMDocJSON;
		syncNotebookFromPmDocument(targetNotebookId, doc);
		// Align lastEmitted with the doc the reactive cells→document effect will
		// reconstruct (cellsToPmDocument), NOT the raw editor JSON. The markdown
		// round-trip is lossy, so the two rarely match byte-for-byte; using the raw
		// JSON made the effect think the store had diverged and call setContent() on
		// every keystroke — which resets the caret to the top and closes the slash /
		// mention menus mid-typing. Reconstructing here keeps self-originated edits
		// from triggering a spurious re-render.
		const cellsNow = getNotebooks().find((n) => n.id === targetNotebookId)?.cells ?? [];
		lastEmitted = cellsToPmDocument(cellsNow);
	}

	function scheduleEmit(ed: TipTapEditor) {
		const targetNotebookId = editingNotebookId ?? notebookId;
		if (emitTimer) clearTimeout(emitTimer);
		emitTimer = setTimeout(() => {
			emitTimer = null;
			emitNow(ed, targetNotebookId);
			if (!editorFocused && pendingReconcile) {
				pendingReconcile = false;
				const current = getNotebooks().find((n) => n.id === targetNotebookId)?.cells ?? latestCells;
				reconcileFromCells(current);
			}
		}, 150);
	}

	function flushPendingEmit(ed: TipTapEditor, targetNotebookId = editingNotebookId ?? notebookId): boolean {
		if (!emitTimer) return false;
		clearTimeout(emitTimer);
		emitTimer = null;
		emitNow(ed, targetNotebookId);
		return true;
	}

	function resetEditorForNotebookSwitch(nextCells: Cell[]) {
		if (emitTimer) {
			clearTimeout(emitTimer);
			emitTimer = null;
		}
		editingNotebookId = null;
		editorFocused = false;
		blurFlushPending = false;
		pendingReconcile = false;
		nodeConfigOpen = false;
		selectedNodeInfo = null;
		slashOpen = false;
		mentionOpen = false;
		loadedNotebookId = notebookId;
		latestCells = nextCells;
		reconcileFromCells(nextCells);
	}

	/** Rebuild the editor document from the given cells when it has genuinely
	 * diverged from what we last emitted. Preserves the caret where possible so
	 * a reconciliation never yanks the cursor to the top of the document. */
	function reconcileFromCells(c: Cell[]) {
		const ed = editor;
		if (!ed) return;
		let pmDoc = cellsToPmDocument(c);
		const hasMarkdownCell = c.some(
			(cell) => cell.cellType === 'markdown' && !!(cell.markdown ?? '').trim()
		);
		const notebookName =
			getNotebooks()
				.find((n) => n.id === notebookId)
				?.name.trim() ?? '';
		if (!hasMarkdownCell && notebookName && notebookName !== 'Untitled notebook') {
			pmDoc = {
				...pmDoc,
				content: [
					{
						type: 'heading',
						attrs: { level: 1 },
						content: [{ type: 'text', text: notebookName }]
					},
					...(pmDoc.content ?? [])
				]
			};
		}
		const serialized = JSON.stringify(pmDoc);
		if (lastEmitted && JSON.stringify(lastEmitted) === serialized) return;
		const currentDoc = ed.getJSON() as PMDocJSON;
		const currentMarkdown = pmDocumentToBlocks(currentDoc)
			.filter((block) => block.kind === 'markdown')
			.map((block) => block.markdown.trim())
			.filter(Boolean);
		const nextHasMarkdown = pmDocumentToBlocks(pmDoc).some(
			(block) => block.kind === 'markdown' && !!block.markdown.trim()
		);
		if (currentMarkdown.length > 0 && !nextHasMarkdown) {
			emitNow(ed, loadedNotebookId ?? notebookId);
			return;
		}
		lastEmitted = pmDoc;
		const prevAnchor = ed.state.selection.anchor;
		const hadFocus = ed.view.hasFocus();
		reconcilingFromStore = true;
		try {
			ed.commands.setContent(pmDoc, { emitUpdate: false });
		} finally {
			reconcilingFromStore = false;
		}
		// Restore the caret to (approximately) where it was; setContent otherwise
		// collapses the selection to the document start.
		const size = ed.state.doc.content.size;
		const pos = Math.max(0, Math.min(prevAnchor, size));
		try {
			ed.chain().setTextSelection(pos).run();
			if (hadFocus) ed.commands.focus();
		} catch {
			/* position no longer resolvable — leave default selection */
		}
		bubbleVisible = false;
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

	function syncSelection(ed: TipTapEditor) {
		if (!NodeSelectionCtor) return;
		const next = syncMarkdocNodeSelection(ed, NodeSelectionCtor);
		if (next) {
			selectedNodeInfo = next;
			nodeConfigOpen = true;
		} else if (selectedNodeInfo) {
			selectedNodeInfo = null;
			nodeConfigOpen = false;
		}
	}

	function patchSelected(patch: {
		attrs?: Record<string, unknown>;
		body?: string;
		source?: string;
	}) {
		const ed = editor;
		if (!ed || !selectedNodeInfo) return;
		patchMarkdocNodeSelection(ed, selectedNodeInfo, selectedBlock, patch);
		syncSelection(ed);
	}

	let booting = false;
	let destroyed = false;

	async function bootEditor() {
		if (!browser || !editorMount || destroyed || editor || booting) return;
		if (!bubbleHost) return;
		booting = true;
		try {
			const { Editor } = await import('@tiptap/core');
			const { NodeSelection } = await import('@tiptap/pm/state');
			NodeSelectionCtor = NodeSelection;
			if (destroyed || !editorMount || !bubbleHost) return;

			const gutter: DragGutterHandle = createDragGutter();
			dragGutter = gutter;

			const pmDoc = cellsToPmDocument(cells);
			lastEmitted = pmDoc;

			const ed = new Editor({
				element: editorMount,
				extensions: buildNotebookDocumentExtensions({
					getCells: () => cells,
					getNotebookId: () => notebookId,
					onCellsRefresh: refreshBus.register,
					reportView: () => reportView,
					refEntries: () => refEntries,
					bubbleMenuElement: bubbleHost,
					bubbleMenuGate: bubbleGate,
					dragHandleRender: () => gutter.element,
					onDragHandleNodeChange: ({ node, pos }) => gutter.setHoveredPos(node ? pos : null),
					insertQueryBlock: (lang, e, plotKind) => insertQueryBlock(lang, e, plotKind),
					insertPage,
					onRequestLink: (e) => onRequestLink(e),
					onRequestMedia: (kind, e) => onRequestMedia(kind, e),
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
						onBeforeControlAction: () => flushPendingEmit(ed),
						onDeleteCell: (cellId) => removeQueryBlockCell(cellId)
					}
				}),
				content: pmDoc,
				editorProps: {
					attributes: {
						class:
							'notion-surface notebook-document-surface markdown-surface prose markdown-body min-h-28 w-full px-0 pt-1 pb-24 focus:outline-none'
					},
					handleDOMEvents: {
						beforeinput: () => {
							const ed = editor;
							if (ed && !reconcilingFromStore) {
								setTimeout(() => {
									if (!destroyed) scheduleEmit(ed);
								}, 0);
							}
							return false;
						},
						input: () => {
							const ed = editor;
							if (ed && !reconcilingFromStore) scheduleEmit(ed);
							return false;
						},
						drop: (view, event) => handleImageDrop(view, event),
						paste: (view, event) => handleImagePaste(view, event),
						// Portaled menus (bits-ui Select, Popover, etc.) render outside the
						// query-block node view — stop PM from stealing their clicks.
						mousedown: (_view, event) => {
							const raw = event.target;
							const el =
								raw instanceof Element ? raw : raw instanceof Text ? raw.parentElement : null;
							if (
								el?.closest('[data-testid="query-block"], [data-query-block], .query-block-view')
							) {
								const ed = editor;
								if (ed && !reconcilingFromStore) flushPendingEmit(ed);
							}
							if (
								el?.closest(
									'[data-slot="select-content"], [data-slot="select-item"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], .column-menu, .node-config-popover, .node-config-backdrop'
								)
							) {
								return true;
							}
							return false;
						}
					}
				},
				onUpdate: ({ editor: e }) => {
					syncSelection(e);
					scheduleEmit(e);
				},
				onTransaction: ({ editor: e, transaction }) => {
					if (transaction.docChanged && !reconcilingFromStore) {
						syncSelection(e);
						scheduleEmit(e);
					}
				},
				onSelectionUpdate: ({ editor: e }) => syncSelection(e),
				onFocus: () => {
					editorFocused = true;
					editingNotebookId = notebookId;
				},
				onBlur: ({ editor: e }) => {
					editorFocused = false;
					const targetNotebookId = editingNotebookId ?? notebookId;
					editingNotebookId = null;
					// Flush any debounced edit BEFORE reconciling so blurring quickly
					// (e.g. clicking a button right after typing) never reverts the
					// last keystrokes to the pre-debounce store snapshot.
					const shouldEmit = Boolean(emitTimer);
					const shouldReconcile = pendingReconcile;
					pendingReconcile = false;
					if (shouldEmit || shouldReconcile) {
						blurFlushPending = true;
						setTimeout(() => {
							if (destroyed) return;
							if (shouldEmit) flushPendingEmit(e, targetNotebookId);
							const reconcileAfterFlush = shouldReconcile || pendingReconcile;
							pendingReconcile = false;
							if (reconcileAfterFlush) {
								const current =
									getNotebooks().find((n) => n.id === notebookId)?.cells ?? latestCells;
								reconcileFromCells(current);
							}
							blurFlushPending = false;
						}, 0);
					}
				}
			});

			gutter.setOnAddBlock((hoveredPos) => {
				if (hoveredPos !== null) openSlashBelow(ed, hoveredPos);
				else addBlockBelow(ed);
			});
			gutter.setOnHandleClick((hoveredPos, handleEl) => openBlockMenu(hoveredPos, handleEl));

			editor = ed;
			loadedNotebookId = notebookId;
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

	function onKeydown(e: KeyboardEvent) {
		if (blockMenuOpen && handleBlockMenuKeydown(e)) return;
		if (e.key === 'Escape') {
			if (linkPopoverOpen) {
				linkPopoverOpen = false;
				editor?.commands.focus();
			}
			if (mediaPopoverOpen) {
				mediaPopoverOpen = false;
				editor?.commands.focus();
			}
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
		const id = notebookId;
		const layoutKey = c.map((cell) => cell.id).join('\0');
		void layoutKey;

		untrack(() => {
			if (!editor) return;

			// Tab switch (including "New notebook") — never defer reconciliation or
			// flush stale editor JSON into the newly active notebook id.
			if (loadedNotebookId !== null && loadedNotebookId !== id) {
				resetEditorForNotebookSwitch(c);
				return;
			}

			if (loadedNotebookId === null) loadedNotebookId = id;
			latestCells = c;
			if (emitTimer) {
				pendingReconcile = true;
				return;
			}
			if (blurFlushPending) {
				pendingReconcile = true;
				return;
			}
			// Never rebuild the document out from under an active editing session —
			// that resets the caret and splits text the user is in the middle of
			// typing. Defer until blur (see onBlur handler above).
			if (editorFocused) {
				pendingReconcile = true;
				return;
			}
			reconcileFromCells(c);
		});
	});

	// reconcileFromCells above only rebuilds the doc when its *serialized structure*
	// changes — query results never touch that JSON (they're not persisted document
	// content), so it silently no-ops when a cell finishes running. Each/group loop
	// previews, live widget data, and orphaned-filter badges need a separate poke.
	// Depend on a primitive signature (not `cells` itself, and not raw property
	// reads inside the effect body) so a parent re-render that hands down a new
	// `cells` array reference — without anything actually changing — can't refire
	// this and cascade into a self-sustaining update loop.
	$effect(() => {
		const cellsResultSignature = cells
			.map((c) => `${c.id}:${c.status}:${c.needsRun ? 1 : 0}:${c.lastRunAt ?? 0}`)
			.join('|');
		void cellsResultSignature;
		untrack(() => refreshBus.notify());
	});
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="notebook-document-editor markdown-surface relative min-w-0 flex-1"
	onpointerdown={onContainerPointerDown}
>
	{#if initError}
		<div
			class="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive"
		>
			Document editor failed: {initError}
		</div>
	{/if}

	<div bind:this={bubbleHost} class="bubble-host" class:is-visible={bubbleVisible}></div>
	<div bind:this={editorMount} class="notebook-document-host"></div>

	{#if slashOpen && slashItems.length}
		<BodyPortal>
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
		</BodyPortal>
	{/if}

	{#if mentionOpen}
		<BodyPortal>
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
		</BodyPortal>
	{/if}

	{#if linkPopoverOpen}
		<BodyPortal>
			<div
				class="link-popover-anchor fixed z-50"
				style="top: {linkPopoverPos.top}px; left: {linkPopoverPos.left}px;"
			>
				<LinkPopover
					onApply={applyLinkFromPopover}
					onCancel={() => {
						linkPopoverOpen = false;
						editor?.commands.focus();
					}}
				/>
			</div>
		</BodyPortal>
	{/if}

	{#if mediaPopoverOpen}
		<BodyPortal>
			<div
				class="media-popover-anchor fixed z-50"
				style="top: {mediaPopoverPos.top}px; left: {mediaPopoverPos.left}px;"
			>
				<MediaInsertPopover
					kind={mediaPopoverKind}
					onInsert={applyMediaInsert}
					onCancel={() => {
						mediaPopoverOpen = false;
						editor?.commands.focus();
					}}
				/>
			</div>
		</BodyPortal>
	{/if}

	{#if blockMenuOpen}
		<BodyPortal>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="fixed inset-0 z-40" onclick={closeBlockMenu} onkeydown={() => {}}></div>
			<div class="fixed z-50" style="top: {blockMenuPos.top}px; left: {blockMenuPos.left}px;">
				<BlockMenu
					groups={blockMenuGroups}
					selectedIndex={blockMenuSelected}
					onSelect={handleBlockMenuSelect}
					onHoverIndex={(i) => {
						blockMenuSelected = i;
					}}
				/>
			</div>
		</BodyPortal>
	{/if}

	<NodeConfigPopover
		open={nodeConfigOpen}
		{editor}
		selected={selectedNodeInfo}
		block={selectedBlock}
		{refEntries}
		{filterUsages}
		{cells}
		onPatch={patchSelected}
		onClose={() => {
			nodeConfigOpen = false;
			editor?.commands.focus();
		}}
	/>
</div>

<style>
	.notebook-document-editor :global(.notion-drag-gutter) {
		margin-left: calc(-1 * var(--notebook-gutter-width) + 0.25rem);
		/* Bridge the gap this shift creates between the rail and the block edge with
		   an invisible hit-testable padding strip, so a mouse moving from the block
		   toward the rail never crosses dead space — which would fire a native
		   mouseleave on the ProseMirror content and make @tiptap/extension-drag-handle
		   hide the rail (and null out its tracked node) right as the pointer arrives. */
		padding-right: calc(var(--notebook-gutter-width) - 0.25rem);
	}
	/* The gutter bridge above only covers the rail's own ~1.25rem-tall box; leaving
	   a tall block leftward at any other height still exits view.dom and the
	   drag-handle plugin hides the rail instantly. Extend the ProseMirror element's
	   hit box under the whole rail column (padding cancelled by negative margin, so
	   layout is unchanged) — the pointer then never leaves view.dom on its way to
	   the rail, and the plugin's own mousemove tracking keeps the rail on the block
	   at the pointer's height, Notion-style. */
	.notebook-document-editor :global(.ProseMirror) {
		padding-left: var(--notebook-gutter-width);
		margin-left: calc(-1 * var(--notebook-gutter-width));
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
		position: relative;
		min-height: 60vh;
		cursor: text;
	}
</style>
