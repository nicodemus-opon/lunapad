<script lang="ts">
	import { onDestroy, untrack, mount, unmount } from 'svelte';
	import { browser } from '$app/environment';
	import type { NodeSelection as PMNodeSelection } from '@tiptap/pm/state';
	import VisualBlockInspector from './VisualBlockInspector.svelte';
	import SlashMenu from './SlashMenu.svelte';
	import MentionMenu from './MentionMenu.svelte';
	import type { MentionItem } from './mention-utils';
	import BubbleToolbar from './BubbleToolbar.svelte';
	import LinkPopover from './LinkPopover.svelte';
	import { sanitizeUrl } from '$lib/services/safe-url';
	import BlockMenu from './BlockMenu.svelte';
	import {
		buildBlockMenuGroups,
		insertBlockAbove,
		turnBlockInto,
		duplicateBlockAt as duplicateBlockMenuAt,
		deleteBlockAt as deleteBlockMenuAt,
		copyHeadingLinkAt,
		type BlockMenuGroup
	} from './block-menu-actions';
	import {
		markdownToPmDocument,
		pmDocumentToMarkdown,
		type PMDocJSON
	} from '$lib/services/markdoc-pm';
	import { parseVisualBlocks, type VisualBlock } from '$lib/services/markdoc-ast';
	import type { SlashCommand } from '$lib/services/markdown-format';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { findFilterUsages } from '$lib/services/markdoc-visual-analysis';
	import { buildNotionEditorExtensions } from './notion-editor-extensions';
	import { createRefreshBus } from './nodeview-refresh-bus';
	import {
		syncMarkdocNodeSelection,
		patchMarkdocNodeSelection,
		type MarkdocSelectedNode
	} from './markdoc-node-selection';
	import { clampContextMenuPosition, clampMenuPosition, handleMenuKeyDown } from './menu-utils';
	import BodyPortal from '$lib/components/ui/body-portal.svelte';
	import { Plus, Copy, Trash2, X, ArrowUp, ArrowDown } from '@lucide/svelte';
	import { createDragGutter, type DragGutterHandle } from './drag-gutter';
	import { handleImageDrop, handleImagePaste } from './image-drop-paste';
	import { pmContentFromSnippet } from './slash-command-extension';
	import MediaInsertPopover from './MediaInsertPopover.svelte';

	type TipTapEditor = import('@tiptap/core').Editor;
	let NodeSelectionCtor: typeof PMNodeSelection | null = null;

	interface Props {
		value: string;
		onchange: (v: string) => void;
		cells: Cell[];
		notebookId?: string;
		refEntries?: MarkdownRefEntry[];
	}

	const { value, onchange, cells, notebookId = '', refEntries = [] }: Props = $props();

	const refreshBus = createRefreshBus();

	let editorMount = $state<HTMLDivElement | null>(null);
	let editor = $state<TipTapEditor | null>(null);
	let frontmatter = '';
	let lastEmitted: string | null = null;
	let emitTimer: ReturnType<typeof setTimeout> | null = null;
	let initError = $state<string | null>(null);

	// Slash menu state
	let slashOpen = $state(false);
	let slashItems = $state<SlashCommand[]>([]);
	let slashSelected = $state(0);
	let slashCommandFn = $state<((item: SlashCommand) => void) | null>(null);
	let slashMenuPos = $state({ top: 0, left: 0 });

	// Mention menu state
	let mentionOpen = $state(false);
	let mentionItems = $state<MentionItem[]>([]);
	let mentionMoreCount = $state(0);
	let mentionQuery = $state('');
	let mentionSelected = $state(0);
	let mentionCommandFn = $state<((item: { id: string; label: string }) => void) | null>(null);
	let mentionMenuPos = $state({ top: 0, left: 0 });

	// Link popover state (bubble toolbar link button + "/link" slash command)
	let linkPopoverOpen = $state(false);
	let linkPopoverPos = $state({ top: 0, left: 0 });
	let linkPopoverEditor: TipTapEditor | null = null;

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

	let dragGutter: DragGutterHandle | null = null;

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
			openSlashBelow(pos);
			return;
		}
		if (id === 'duplicate') {
			duplicateBlockMenuAt(ed, pos);
			return;
		}
		if (id === 'delete') {
			deleteBlockMenuAt(ed, pos);
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

	// Selection / inspector
	let selectedNodeInfo = $state<MarkdocSelectedNode | null>(null);

	const selectedBlock = $derived.by((): VisualBlock | null => {
		if (!selectedNodeInfo?.source) return null;
		const blocks = parseVisualBlocks(selectedNodeInfo.source);
		return blocks[0] ?? null;
	});

	const filterUsages = $derived.by(() => {
		const params = new Set<string>();
		for (const match of value.matchAll(/\{%\s*filter\b[^%]*\bparam="([^"]+)"/g)) {
			if (match[1]) params.add(match[1]);
		}
		return Object.fromEntries([...params].map((param) => [param, findFilterUsages(cells, param)]));
	});

	const isEmpty = $derived.by(() => {
		if (value.trim()) return false;
		if (!editor) return true;
		return editor.isEmpty;
	});

	// Block context menu
	let ctxMenu = $state<{ x: number; y: number; pos: number } | null>(null);
	const ctxMenuPos = $derived.by(() => {
		if (!ctxMenu) return null;
		return clampContextMenuPosition(ctxMenu.x, ctxMenu.y, { width: 160, height: 220 });
	});

	// DOM refs for extensions
	let bubbleHost = $state<HTMLDivElement | null>(null);
	let bubbleVisible = $state(false);
	let bubbleToolbarMount: ReturnType<typeof mount> | null = null;

	const bubbleGate = {
		isSlashOpen: () => slashOpen,
		isMentionOpen: () => mentionOpen,
		isContextMenuOpen: () =>
			ctxMenu !== null || linkPopoverOpen || blockMenuOpen || mediaPopoverOpen,
		onShow: () => {
			bubbleVisible = true;
		},
		onHide: () => {
			bubbleVisible = false;
		}
	};

	const dashboardTemplates = [
		{
			id: 'executive',
			label: 'Executive KPI',
			description: 'KPI grid, trend chart, and detail table',
			source: `## Executive dashboard

{% grid cols=3 %}
{% metric value=$cell.value label="Revenue" format="currency" /%}
{% metric value=$cell.value label="Orders" /%}
{% metric value=$cell.value label="Conversion" format="percent" /%}
{% /grid %}

{% chart type="line" data=$cell.rows x="date_col" y="value_col" title="Trend" /%}

{% datatable data=$cell.rows limit=25 headerInsights="compact" /%}`
		},
		{
			id: 'filtered',
			label: 'Filtered dashboard',
			description: 'Filter, KPI, chart, and linked table',
			source: `## Filtered report

{% filter kind="dropdown" param="region" label="Region" options=$cell.rows optionsColumn="region" /%}

{% metric value=$cell.value label="Selected total" format="currency" /%}

{% chart type="bar" data=$cell.rows x="region" y="value_col" filterParam="region" /%}

{% datatable data=$cell.rows linkedFilter="region" limit=20 /%}`
		},
		{
			id: 'pivot',
			label: 'Pivot table report',
			description: 'Advanced crosstab table with formatting',
			source: `## Pivot report

{% datatable data=$cell.rows index=["group_col"] pivotBy="pivot_col" valueCol="value_col" agg="sum" valueFormatKind="currency" valueCurrencySymbol="$" headerInsights="full" /%}`
		}
	];

	function syncSelection(ed: TipTapEditor) {
		if (!NodeSelectionCtor) return;
		selectedNodeInfo = syncMarkdocNodeSelection(ed, NodeSelectionCtor);
	}

	function emitNow(ed: TipTapEditor) {
		const doc = ed.getJSON() as PMDocJSON;
		const serialized = pmDocumentToMarkdown({ frontmatter, doc });
		if (serialized === lastEmitted) return;
		lastEmitted = serialized;
		onchange(serialized);
	}

	function scheduleEmit(ed: TipTapEditor) {
		if (emitTimer) clearTimeout(emitTimer);
		emitTimer = setTimeout(() => emitNow(ed), 120);
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

	function loadTemplate(source: string) {
		const pm = markdownToPmDocument(source);
		frontmatter = pm.frontmatter;
		if (editor) {
			editor.commands.setContent(pm.doc, { emitUpdate: false });
			emitNow(editor);
		} else {
			lastEmitted = pmDocumentToMarkdown(pm);
			onchange(lastEmitted);
		}
	}

	function patchSelected(patch: {
		attrs?: Record<string, unknown>;
		body?: string;
		source?: string;
	}) {
		if (!editor || !selectedNodeInfo) return;
		patchMarkdocNodeSelection(editor, selectedNodeInfo, selectedBlock, patch);
	}

	function duplicateBlockAt(pos: number) {
		if (!editor) return;
		const node = editor.state.doc.nodeAt(pos);
		if (!node) return;
		editor
			.chain()
			.focus()
			.insertContentAt(pos + node.nodeSize, node.toJSON())
			.run();
	}

	function moveBlockAt(pos: number, direction: 'up' | 'down') {
		if (!editor) return;
		const node = editor.state.doc.nodeAt(pos);
		if (!node) return;
		const resolvedPos = editor.state.doc.resolve(pos);
		const index = resolvedPos.index(resolvedPos.depth);
		const parent = resolvedPos.parent;
		if (direction === 'up' && index === 0) return;
		if (direction === 'down' && index >= parent.childCount - 1) return;
		const swapIndex = direction === 'up' ? index - 1 : index + 1;
		const swapPos = resolvedPos.posAtIndex(swapIndex, resolvedPos.depth);
		const swapNode = parent.child(swapIndex);
		editor
			.chain()
			.focus()
			.command(({ tr }) => {
				const from = pos;
				const to = pos + node.nodeSize;
				const swapFrom = swapPos;
				const swapTo = swapPos + swapNode.nodeSize;
				if (direction === 'up') {
					tr.delete(from, to);
					tr.insert(swapFrom, node);
				} else {
					tr.delete(swapFrom, swapTo);
					tr.insert(from, swapNode);
				}
				return true;
			})
			.run();
	}

	function deleteBlockAt(pos: number) {
		if (!editor) return;
		const node = editor.state.doc.nodeAt(pos);
		if (!node) return;
		editor
			.chain()
			.focus()
			.deleteRange({ from: pos, to: pos + node.nodeSize })
			.run();
	}

	function onEditorContextMenu(e: MouseEvent) {
		if (!editor) return;
		const view = editor.view;
		const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
		if (pos === undefined) return;
		const resolvedPos = editor.state.doc.resolve(pos);
		const blockPos = resolvedPos.before(resolvedPos.depth);
		e.preventDefault();
		ctxMenu = { x: e.clientX, y: e.clientY, pos: blockPos };
	}

	function insertBlockBelow(pos: number) {
		if (!editor) return;
		const node = editor.state.doc.nodeAt(pos);
		if (!node) return;
		const insertPos = pos + node.nodeSize;
		editor
			.chain()
			.focus()
			.insertContentAt(insertPos, { type: 'paragraph' })
			.setTextSelection(insertPos + 1)
			.run();
	}

	function openSlashBelow(pos: number) {
		if (!editor) return;
		const node = editor.state.doc.nodeAt(pos);
		if (!node) return;
		const insertPos = pos + node.nodeSize;
		editor
			.chain()
			.focus()
			.insertContentAt(insertPos, {
				type: 'paragraph',
				content: [{ type: 'text', text: '/' }]
			})
			.setTextSelection(insertPos + 2)
			.run();
	}

	let booting = false;
	let destroyed = false;

	async function bootEditor() {
		if (!browser || !editorMount || destroyed || editor || booting) return;
		if (!bubbleHost) return;
		booting = true;
		try {
			const [{ Editor }, pmState] = await Promise.all([
				import('@tiptap/core'),
				import('@tiptap/pm/state')
			]);

			NodeSelectionCtor = pmState.NodeSelection;

			if (destroyed || !editorMount || !bubbleHost) return;

			// Drag handle gutter
			const gutter: DragGutterHandle = createDragGutter();
			dragGutter = gutter;

			const pm = markdownToPmDocument(value);
			frontmatter = pm.frontmatter;
			lastEmitted = value;

			const ed = new Editor({
				element: editorMount,
				extensions: buildNotionEditorExtensions({
					getCells: () => cells,
					getNotebookId: () => notebookId,
					onCellsRefresh: refreshBus.register,
					refEntries: () => refEntries,
					bubbleMenuElement: bubbleHost,
					bubbleMenuGate: bubbleGate,
					dragHandleRender: () => gutter.element,
					onDragHandleNodeChange: ({ node, pos }) => gutter.setHoveredPos(node ? pos : null),
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
					}
				}),
				content: pm.doc,
				editorProps: {
					attributes: {
						class:
							'notion-surface markdown-surface prose markdown-body min-h-28 w-full px-0 py-1 focus:outline-none'
					},
					handleDOMEvents: {
						contextmenu: (view, event) => {
							onEditorContextMenu(event as MouseEvent);
							return true;
						},
						drop: (view, event) => handleImageDrop(view, event),
						paste: (view, event) => handleImagePaste(view, event)
					}
				},
				onUpdate: ({ editor: e }) => {
					syncSelection(e);
					scheduleEmit(e);
				},
				onSelectionUpdate: ({ editor: e }) => syncSelection(e)
			});

			// Plus button opens slash menu below hovered block
			gutter.setOnAddBlock((hoveredPos) => {
				if (hoveredPos !== null) openSlashBelow(hoveredPos);
				else
					ed.chain()
						.focus()
						.insertContent({ type: 'paragraph', content: [{ type: 'text', text: '/' }] })
						.run();
			});
			gutter.setOnHandleClick((hoveredPos, handleEl) => openBlockMenu(hoveredPos, handleEl));

			editor = ed;
			bubbleToolbarMount = mount(BubbleToolbar, {
				target: bubbleHost,
				props: { editor: ed }
			});
		} catch (e) {
			initError = e instanceof Error ? e.message : 'Failed to load visual editor';
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
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			return true;
		}
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

	function onKeydown(e: KeyboardEvent) {
		if (blockMenuOpen && handleBlockMenuKeydown(e)) return;
		if (e.key === 'Escape') {
			if (slashOpen) {
				slashOpen = false;
				return;
			}
			if (mentionOpen) {
				mentionOpen = false;
				return;
			}
			if (linkPopoverOpen) {
				linkPopoverOpen = false;
				editor?.commands.focus();
				return;
			}
			if (mediaPopoverOpen) {
				mediaPopoverOpen = false;
				editor?.commands.focus();
				return;
			}
			if (ctxMenu) {
				ctxMenu = null;
				return;
			}
			if (selectedNodeInfo) {
				selectedNodeInfo = null;
				editor?.commands.focus();
				return;
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
		const v = value;
		void cells;
		untrack(() => {
			if (!editor || v === lastEmitted) return;
			const pm = markdownToPmDocument(v);
			frontmatter = pm.frontmatter;
			lastEmitted = v;
			editor.commands.setContent(pm.doc, { emitUpdate: false });
			syncSelection(editor);
			bubbleVisible = false;
		});
	});

	// Query/python cell results live outside the document (setContent above only
	// fires on markdown text changes), so each/group loop previews, live widget
	// data, and orphaned-filter badges need their own poke when a cell finishes
	// running. Depend on a primitive signature (not `cells` itself, and not raw
	// property reads inside the effect body) so a parent re-render that hands
	// down a new `cells` array reference — without anything actually changing —
	// can't refire this and cascade into a self-sustaining update loop.
	const cellsResultSignature = $derived(
		cells.map((c) => `${c.id}:${c.status}:${c.needsRun ? 1 : 0}:${c.lastRunAt ?? 0}`).join('|')
	);
	$effect(() => {
		void cellsResultSignature;
		untrack(() => refreshBus.notify());
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="notion-dashboard notebook-markdown-editor markdown-surface flex min-h-24 gap-2">
	<div class="notion-canvas relative min-w-0 flex-1">
		{#if initError}
			<div
				class="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive"
			>
				Visual editor failed to load: {initError}
			</div>
		{/if}

		{#if isEmpty}
			<div class="rounded-lg border border-dashed border-border bg-muted/20 p-4">
				<p class="text-sm font-semibold">Start writing</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Type <kbd class="rounded bg-muted px-1 font-mono text-2xs">/</kbd> for blocks and widgets, or
					pick a dashboard template.
				</p>
				<div class="mt-3 grid gap-2 sm:grid-cols-3">
					{#each dashboardTemplates as tpl (tpl.id)}
						<button
							type="button"
							class="rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted/40"
							onclick={() => loadTemplate(tpl.source)}
						>
							<span class="block text-xs font-semibold">{tpl.label}</span>
							<span class="mt-1 block text-2xs text-muted-foreground">{tpl.description}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<div bind:this={bubbleHost} class="bubble-host" class:is-visible={bubbleVisible}></div>
		<div bind:this={editorMount} class="notion-editor-host"></div>

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

		{#if ctxMenu && ctxMenuPos}
			<BodyPortal>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="fixed inset-0 z-40" onclick={() => (ctxMenu = null)} onkeydown={() => {}}></div>
				<div
					class="fixed z-50 min-w-40 rounded-md border bg-popover p-1 shadow-lg"
					style="top: {ctxMenuPos.top}px; left: {ctxMenuPos.left}px;"
				>
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60"
						onclick={() => {
							moveBlockAt(ctxMenu!.pos, 'up');
							ctxMenu = null;
						}}
					>
						<ArrowUp class="h-3.5 w-3.5" /> Move up
					</button>
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60"
						onclick={() => {
							moveBlockAt(ctxMenu!.pos, 'down');
							ctxMenu = null;
						}}
					>
						<ArrowDown class="h-3.5 w-3.5" /> Move down
					</button>
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60"
						onclick={() => {
							duplicateBlockAt(ctxMenu!.pos);
							ctxMenu = null;
						}}
					>
						<Copy class="h-3.5 w-3.5" /> Duplicate
					</button>
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60"
						onclick={() => {
							insertBlockBelow(ctxMenu!.pos);
							ctxMenu = null;
						}}
					>
						<Plus class="h-3.5 w-3.5" /> Add below
					</button>
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
						onclick={() => {
							deleteBlockAt(ctxMenu!.pos);
							ctxMenu = null;
						}}
					>
						<Trash2 class="h-3.5 w-3.5" /> Delete
					</button>
				</div>
			</BodyPortal>
		{/if}
	</div>

	{#if selectedNodeInfo}
		<aside
			class="visual-inspector w-72 shrink-0 overflow-hidden rounded-lg border border-border bg-popover shadow-sm"
		>
			<div class="flex items-center justify-between border-b border-border/80 px-3 py-2.5">
				<div>
					<span class="text-sm font-medium text-foreground">Properties</span>
					<p class="text-2xs text-muted-foreground">Block settings</p>
				</div>
				<button
					type="button"
					class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
					title="Close"
					aria-label="Close inspector"
					onclick={() => {
						selectedNodeInfo = null;
						editor?.commands.focus();
					}}
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
			<div class="max-h-[calc(100vh-12rem)] overflow-y-auto py-2">
				<VisualBlockInspector
					block={selectedBlock}
					{refEntries}
					{filterUsages}
					onPatch={patchSelected}
					variant="sidebar"
				/>
			</div>
		</aside>
	{/if}
</div>

<style>
	.notion-dashboard {
		position: relative;
	}
	.notebook-markdown-editor :global(.notion-drag-gutter) {
		margin-left: calc(-1 * var(--notebook-gutter-width) + 0.25rem);
		/* Bridge the gap this shift creates between the rail and the block edge with
		   an invisible hit-testable padding strip, so a mouse moving from the block
		   toward the rail never crosses dead space — which would fire a native
		   mouseleave on the ProseMirror content and make @tiptap/extension-drag-handle
		   hide the rail (and null out its tracked node) right as the pointer arrives. */
		padding-right: calc(var(--notebook-gutter-width) - 0.25rem);
	}
	/* See NotebookDocumentEditor.svelte: extend view.dom's hit box under the whole
	   rail column (padding cancelled by negative margin, no layout change) so the
	   pointer never leaves the ProseMirror element on its way to the rail — the
	   drag-handle plugin hides the rail on view.dom mouseleave. */
	.notebook-markdown-editor :global(.ProseMirror) {
		padding-left: var(--notebook-gutter-width);
		margin-left: calc(-1 * var(--notebook-gutter-width));
	}
	:global(.notion-surface mark) {
		background: color-mix(in oklab, var(--warning) 32%, transparent);
		color: inherit;
		border-radius: 0.15rem;
		padding: 0 0.1rem;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}
	:global(.mention) {
		background: color-mix(in oklab, var(--primary) 12%, transparent);
		color: var(--primary);
		border-radius: 0.2rem;
		padding: 0 0.15rem;
		font-weight: 500;
	}
	:global(.ProseMirror-selectednode .inline-widget-view),
	:global(.ProseMirror-selectednode .markdoc-block-view) {
		border-color: var(--ring);
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
	.notion-editor-host {
		position: relative;
		min-height: 6rem;
	}
	@media (max-width: 720px) {
		.notion-dashboard {
			flex-direction: column;
		}
		.visual-inspector {
			width: 100%;
		}
	}
</style>
