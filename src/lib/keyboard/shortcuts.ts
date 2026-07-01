import { tick } from 'svelte';
import {
	addCellAfter,
	addCellBefore,
	copyCellToClipboard,
	duplicateCell,
	moveCell,
	openLineageTab,
	pasteCellAfter,
	removeCell,
	runCell,
	runCellsAbove,
	runCellsBelow,
	setCellDisplay,
	testCell,
	toggleWorksheetView,
	undo,
	redo,
	getActiveTabId,
	getNotebooks
} from '$lib/stores/notebook.svelte';
import {
	focusAdjacentCell,
	focusCellAfterDelete,
	focusCellById,
	getCellMeta,
	handleDdDelete,
	requestEnterEdit,
	requestGuiSlash,
	requestInlinePrompt
} from './cell-bridge.svelte';
import { getCellMetaFromContext } from './context';
import { getPageBridge } from './page-bridge';
import { dispatchStageEditorKey, findOpenStageMenu, findStageMenuInEditor } from './stage-bridge';
import { formatChord } from './format';
import type { ShortcutContext, ShortcutDef } from './types';

function page() {
	return getPageBridge();
}

function cellId(ctx: ShortcutContext): string | null {
	return ctx.cellId;
}

function notTyping(ctx: ShortcutContext): boolean {
	return !ctx.isNativeInputTarget;
}

function canInline(ctx: ShortcutContext): boolean {
	const meta = getCellMetaFromContext(ctx);
	return meta?.canInlinePrompt ?? false;
}

function isQuery(ctx: ShortcutContext): boolean {
	return getCellMetaFromContext(ctx)?.isQueryCell ?? false;
}

function isDbt(ctx: ShortcutContext): boolean {
	return getCellMetaFromContext(ctx)?.isDbtProject ?? false;
}

function isGui(ctx: ShortcutContext): boolean {
	return getCellMetaFromContext(ctx)?.isGuiCell ?? false;
}

function worksheetEligible(ctx: ShortcutContext): boolean {
	return getCellMetaFromContext(ctx)?.worksheetEligible ?? false;
}

export const SHORTCUTS: ShortcutDef[] = [
	// ── Global ────────────────────────────────────────────────────────────────
	{
		id: 'global.save',
		chord: { key: 's', mod: true },
		contexts: [
			'global',
			'command-mode',
			'monaco-code',
			'monaco-markdown',
			'stage-editor',
			'stage-menu'
		],
		group: 'global',
		label: 'Save notebook to disk',
		priority: 100,
		handler: () => page()?.saveAll()
	},
	{
		id: 'global.shortcuts',
		chord: { key: '?', plain: true },
		contexts: ['global', 'command-mode', 'stage-editor'],
		group: 'global',
		label: 'Show keyboard shortcuts',
		priority: 90,
		when: (ctx) => !ctx.isTypingTarget,
		handler: () => page()?.openShortcuts()
	},
	{
		id: 'global.worksheet-escape',
		chord: { key: 'Escape', plain: true },
		contexts: [
			'global',
			'command-mode',
			'monaco-code',
			'monaco-markdown',
			'stage-editor',
			'stage-menu'
		],
		group: 'global',
		label: 'Exit worksheet view',
		priority: 120,
		when: () => page()?.isWorksheetView() ?? false,
		handler: () => page()?.closeWorksheetView(),
		showInHelp: false
	},
	{
		id: 'palette.toggle',
		chord: { key: 'k', mod: true },
		contexts: [
			'global',
			'command-mode',
			'monaco-code',
			'monaco-markdown',
			'stage-editor',
			'stage-menu'
		],
		group: 'global',
		label: 'Command palette',
		priority: 100,
		when: (ctx) => !ctx.event.shiftKey,
		handler: () => page()?.toggleCommandPalette()
	},
	{
		id: 'global.ai-chat',
		chord: { key: 'j', mod: true },
		contexts: [
			'global',
			'command-mode',
			'monaco-code',
			'monaco-markdown',
			'stage-editor',
			'stage-menu'
		],
		group: 'global',
		label: 'Toggle AI chat panel',
		priority: 100,
		when: (ctx) => !ctx.event.shiftKey,
		handler: () => page()?.toggleAIChat()
	},
	{
		id: 'global.sidebar',
		chord: { key: 'b', mod: true },
		contexts: ['global', 'command-mode', 'stage-editor', 'stage-menu'],
		group: 'global',
		label: 'Toggle sidebar',
		priority: 100,
		when: (ctx) => !ctx.isTypingTarget,
		handler: () => page()?.toggleSidebar()
	},
	{
		id: 'global.tab',
		chord: { key: '1', mod: true },
		contexts: ['global', 'command-mode'],
		group: 'global',
		label: 'Switch to notebook tab 1–9',
		showInHelp: false,
		when: (ctx) => !ctx.event.shiftKey && !ctx.isTypingTarget,
		handler: (ctx) => {
			if (/^[1-9]$/.test(ctx.event.key)) {
				page()?.switchNotebookTab(parseInt(ctx.event.key, 10) - 1);
			}
		}
	},
	{
		id: 'notebook.add-prql',
		chord: { key: 'Enter', mod: true, shift: true },
		contexts: ['global', 'command-mode'],
		group: 'global',
		label: 'Add PRQL cell',
		when: (ctx) => !ctx.isTypingTarget && (page()?.isNotebookTab() ?? false),
		handler: () => page()?.addPrqlCell()
	},
	{
		id: 'notebook.add-markdown',
		chord: { key: 'm', mod: true, shift: true },
		contexts: ['global', 'command-mode'],
		group: 'global',
		label: 'Add markdown cell',
		when: (ctx) => !ctx.isTypingTarget && (page()?.isNotebookTab() ?? false),
		handler: () => page()?.addMarkdownCell()
	},
	{
		id: 'notebook.open-comments',
		chord: { key: 'c', mod: true, shift: true },
		contexts: ['global', 'command-mode'],
		group: 'global',
		label: 'Open review thread',
		when: (ctx) => !ctx.isTypingTarget && (page()?.isNotebookTab() ?? false),
		handler: () => page()?.openComments()
	},
	{
		id: 'notebook.run-all',
		chord: { key: 'r', mod: true, shift: true },
		contexts: ['global', 'command-mode'],
		group: 'global',
		label: 'Run all cells',
		when: (ctx) => !ctx.isTypingTarget && (page()?.isNotebookTab() ?? false),
		handler: () => page()?.runAll()
	},
	{
		id: 'notebook.toggle-outline',
		chord: { key: 'o', mod: true, shift: true },
		contexts: ['global', 'command-mode'],
		group: 'global',
		label: 'Toggle notebook outline',
		when: (ctx) => !ctx.isTypingTarget && (page()?.isNotebookTab() ?? false),
		handler: () => page()?.toggleNotebookOutline()
	},
	{
		id: 'notebook.undo',
		chord: { key: 'z', mod: true },
		contexts: ['global', 'command-mode'],
		group: 'global',
		label: 'Undo',
		when: (ctx) => !ctx.event.shiftKey && !ctx.isNativeInputTarget,
		handler: () => undo()
	},
	{
		id: 'notebook.redo-shift-z',
		chord: { key: 'z', mod: true, shift: true },
		contexts: ['global', 'command-mode'],
		group: 'global',
		label: 'Redo',
		showInHelp: false,
		when: notTyping,
		handler: () => redo()
	},
	{
		id: 'notebook.redo-y',
		chord: { key: 'y', mod: true },
		contexts: ['global', 'command-mode'],
		group: 'global',
		label: 'Redo',
		showInHelp: false,
		when: notTyping,
		handler: () => redo()
	},

	// ── Cell editor (Monaco / stage-adjacent) ─────────────────────────────────
	{
		id: 'cell.run',
		chord: { key: 'Enter', mod: true },
		contexts: ['monaco-code', 'command-mode'],
		group: 'cell-editor',
		label: 'Run cell',
		priority: 60,
		when: (ctx) => isQuery(ctx) && notTyping(ctx),
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) runCell(id);
		}
	},
	{
		id: 'cell.run-shift',
		chord: { key: 'Enter', shift: true },
		contexts: ['monaco-code', 'command-mode'],
		group: 'cell-editor',
		label: 'Run cell',
		showInHelp: false,
		when: (ctx) => isQuery(ctx) && notTyping(ctx),
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) runCell(id);
		}
	},
	{
		id: 'cell.inline-ai',
		chord: { key: 'k', mod: true, shift: true },
		contexts: ['monaco-code', 'command-mode'],
		group: 'cell-editor',
		label: 'Tell AI what to do (inline)',
		priority: 70,
		when: (ctx) => canInline(ctx) && notTyping(ctx),
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) requestInlinePrompt(id);
		}
	},
	{
		id: 'cell.lineage',
		chord: { key: 'l', mod: true, shift: true },
		contexts: ['monaco-code', 'command-mode'],
		group: 'cell-editor',
		label: 'Open lineage tab',
		when: notTyping,
		handler: (ctx) => {
			const meta = getCellMetaFromContext(ctx);
			if (meta?.outputName) openLineageTab(meta.outputName);
		}
	},
	{
		id: 'cell.dbt-test',
		chord: { key: 't', mod: true, shift: true },
		contexts: ['monaco-code', 'command-mode'],
		group: 'cell-editor',
		label: 'Run dbt tests for cell',
		when: (ctx) => isDbt(ctx) && notTyping(ctx),
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) void testCell(id);
		}
	},
	{
		id: 'cell.command-mode',
		chord: { key: 'Escape' },
		contexts: ['monaco-code', 'monaco-markdown'],
		group: 'cell-editor',
		label: 'Return to cell command mode',
		priority: 40,
		handler: (ctx) => ctx.cellEl?.focus()
	},
	{
		id: 'cell.gui-slash',
		chord: { key: '/', plain: true },
		contexts: ['command-mode', 'global'],
		group: 'cell-editor',
		label: 'Open Add Stage menu (GUI cells)',
		priority: 55,
		when: (ctx) => {
			if (ctx.isTypingTarget) return false;
			if (!isGui(ctx)) return false;
			if (ctx.contexts.includes('stage-editor')) return false;
			return true;
		},
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) requestGuiSlash(id);
		}
	},

	// ── Command mode ──────────────────────────────────────────────────────────
	{
		id: 'command.enter',
		chord: { key: 'Enter', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Enter edit mode / expand cell',
		handler: (ctx) => {
			const id = cellId(ctx);
			if (!id) return;
			const meta = getCellMeta(id);
			if (meta?.collapsed) {
				setCellDisplay(id, 'full');
			} else {
				requestEnterEdit(id);
			}
		}
	},
	{
		id: 'command.up',
		chord: { key: 'k', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Focus previous cell (↑ / k)',
		handler: (ctx) => ctx.cellEl && focusAdjacentCell(ctx.cellEl, 'prev')
	},
	{
		id: 'command.up-arrow',
		chord: { key: 'ArrowUp', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Focus previous cell',
		showInHelp: false,
		handler: (ctx) => ctx.cellEl && focusAdjacentCell(ctx.cellEl, 'prev')
	},
	{
		id: 'command.down',
		chord: { key: 'j', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Focus next cell (↓ / j)',
		handler: (ctx) => ctx.cellEl && focusAdjacentCell(ctx.cellEl, 'next')
	},
	{
		id: 'command.down-arrow',
		chord: { key: 'ArrowDown', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Focus next cell',
		showInHelp: false,
		handler: (ctx) => ctx.cellEl && focusAdjacentCell(ctx.cellEl, 'next')
	},
	{
		id: 'command.insert-above',
		chord: { key: 'a', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Insert cell above',
		handler: async (ctx) => {
			const id = cellId(ctx);
			if (!id || !ctx.cellEl) return;
			addCellBefore(id);
			await tick();
			focusAdjacentCell(ctx.cellEl, 'prev');
		}
	},
	{
		id: 'command.insert-below',
		chord: { key: 'b', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Insert cell below',
		handler: async (ctx) => {
			const id = cellId(ctx);
			if (!id || !ctx.cellEl) return;
			addCellAfter(id);
			await tick();
			focusAdjacentCell(ctx.cellEl, 'next');
		}
	},
	{
		id: 'command.delete-d',
		chord: { key: 'd', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Delete cell (d d)',
		handler: async (ctx) => {
			const id = cellId(ctx);
			if (!id || !ctx.cellEl) return;
			if (handleDdDelete(id, ctx.cellEl)) {
				const el = ctx.cellEl;
				removeCell(id);
				await tick();
				focusCellAfterDelete(el);
			}
		}
	},
	{
		id: 'command.move-up',
		chord: { key: 'k', shift: true, plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Move cell up',
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) moveCell(id, 'up');
		}
	},
	{
		id: 'command.move-down',
		chord: { key: 'j', shift: true, plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Move cell down',
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) moveCell(id, 'down');
		}
	},
	{
		id: 'command.run-above',
		chord: { key: 'ArrowUp', alt: true, shift: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Run cells above',
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) void runCellsAbove(id);
		}
	},
	{
		id: 'command.run-below',
		chord: { key: 'ArrowDown', alt: true, shift: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Run cells below',
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) void runCellsBelow(id);
		}
	},
	{
		id: 'command.collapse',
		chord: { key: 'c', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Collapse / expand cell',
		handler: (ctx) => {
			const id = cellId(ctx);
			const meta = id ? getCellMeta(id) : null;
			if (!id || !meta) return;
			setCellDisplay(id, meta.collapsed ? 'full' : 'collapsed');
		}
	},
	{
		id: 'command.worksheet',
		chord: { key: 'e', mod: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Toggle worksheet view',
		when: worksheetEligible,
		handler: (ctx) => {
			const id = cellId(ctx);
			const notebookId = getActiveTabId();
			if (!id || !notebookId) return;
			toggleWorksheetView(notebookId, id);
		}
	},
	{
		id: 'command.copy-mod',
		chord: { key: 'c', mod: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Copy cell',
		showInHelp: false,
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) copyCellToClipboard(id);
		}
	},
	{
		id: 'command.output-only',
		chord: { key: 'c', shift: true, plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Toggle output-only view',
		when: isQuery,
		handler: (ctx) => {
			const id = cellId(ctx);
			const meta = id ? getCellMeta(id) : null;
			if (!id || !meta) return;
			setCellDisplay(id, meta.display === 'output' ? 'full' : 'output');
		}
	},
	{
		id: 'command.yank',
		chord: { key: 'y', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Copy cell',
		showInHelp: false,
		handler: (ctx) => {
			const id = cellId(ctx);
			if (id) copyCellToClipboard(id);
		}
	},
	{
		id: 'command.paste-mod',
		chord: { key: 'v', mod: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Paste cell below',
		showInHelp: false,
		handler: async (ctx) => {
			const id = cellId(ctx);
			if (!id) return;
			const newId = await pasteCellAfter(id);
			if (newId) {
				await tick();
				focusCellById(newId);
			}
		}
	},
	{
		id: 'command.paste',
		chord: { key: 'p', plain: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Paste cell below',
		showInHelp: false,
		handler: async (ctx) => {
			const id = cellId(ctx);
			if (!id) return;
			const newId = await pasteCellAfter(id);
			if (newId) {
				await tick();
				focusCellById(newId);
			}
		}
	},
	{
		id: 'command.duplicate',
		chord: { key: 'd', mod: true, shift: true },
		contexts: ['command-mode'],
		group: 'command-mode',
		label: 'Duplicate cell',
		handler: async (ctx) => {
			const id = cellId(ctx);
			if (!id) return;
			const newId = duplicateCell(id);
			if (newId) {
				await tick();
				focusCellById(newId);
			}
		}
	},

	// ── Stage menu ────────────────────────────────────────────────────────────
	{
		id: 'stage-menu.close',
		chord: { key: 'Escape' },
		contexts: ['stage-menu'],
		group: 'gui-stages',
		label: 'Close Add Stage menu',
		priority: 80,
		showInHelp: false,
		handler: () => findOpenStageMenu()?.handlers.closeMenu()
	},
	{
		id: 'stage-menu.pick',
		chord: { key: '1', plain: true },
		contexts: ['stage-menu'],
		group: 'gui-stages',
		label: 'Pick result 1–9 from menu',
		priority: 80,
		showInHelp: false,
		when: (ctx) => /^[1-9]$/.test(ctx.event.key),
		handler: (ctx) => {
			const open = findOpenStageMenu();
			if (open) open.handlers.chooseByIndex(parseInt(ctx.event.key, 10) - 1);
		}
	},
	{
		id: 'stage-menu.enter',
		chord: { key: 'Enter', plain: true },
		contexts: ['stage-menu'],
		group: 'gui-stages',
		label: 'Apply fast plan',
		priority: 75,
		showInHelp: false,
		when: (ctx) => !ctx.event.metaKey && !ctx.event.ctrlKey,
		handler: (ctx) => {
			const open = findOpenStageMenu();
			open?.handlers.handleEnter({
				shiftKey: ctx.event.shiftKey,
				fromTyping: ctx.isTypingTarget
			});
		}
	},
	{
		id: 'stage-menu.cmd-enter',
		chord: { key: 'Enter', mod: true },
		contexts: ['stage-menu'],
		group: 'gui-stages',
		label: 'Run AI generation',
		priority: 85,
		when: (ctx) => !ctx.event.altKey,
		handler: () => findOpenStageMenu()?.handlers.runCmdEnter()
	},
	{
		id: 'stage-menu.open-slash',
		chord: { key: '/', plain: true },
		contexts: ['stage-editor'],
		group: 'gui-stages',
		label: 'Open Add Stage menu',
		priority: 70,
		when: (ctx) => !ctx.isTypingTarget && !findOpenStageMenu(),
		handler: (ctx) => {
			if (!ctx.stageEditorEl) return;
			const menu = findStageMenuInEditor(ctx.stageEditorEl);
			menu?.openMenu();
		}
	},

	// ── Markdown editor (help only — handled in Monaco) ───────────────────────
	{
		id: 'markdown.bold',
		chord: { key: 'b', mod: true },
		contexts: ['monaco-markdown'],
		group: 'markdown-editor',
		label: 'Bold',
		showInHelp: true,
		when: () => false,
		handler: () => {}
	},
	{
		id: 'markdown.italic',
		chord: { key: 'i', mod: true },
		contexts: ['monaco-markdown'],
		group: 'markdown-editor',
		label: 'Italic',
		showInHelp: true,
		when: () => false,
		handler: () => {}
	},
	{
		id: 'markdown.link',
		chord: { key: 'l', mod: true },
		contexts: ['monaco-markdown'],
		group: 'markdown-editor',
		label: 'Insert link',
		showInHelp: true,
		when: () => false,
		handler: () => {}
	},
	{
		id: 'markdown.code',
		chord: { key: '`', mod: true },
		contexts: ['monaco-markdown'],
		group: 'markdown-editor',
		label: 'Inline code',
		showInHelp: true,
		when: () => false,
		handler: () => {}
	}
];

/** Tab shortcuts ⌘1–⌘9 share one handler via dynamic key match */
for (let i = 2; i <= 9; i++) {
	SHORTCUTS.push({
		...SHORTCUTS.find((s) => s.id === 'global.tab')!,
		id: `global.tab-${i}`,
		chord: { key: String(i), mod: true },
		showInHelp: false
	});
}

export function shortcutsByGroup(): Record<string, { chord: string; label: string }[]> {
	const groups: Record<string, { chord: string; label: string }[]> = {};
	const seen = new Set<string>();

	for (const s of SHORTCUTS) {
		if (s.showInHelp === false) continue;
		const key = `${s.group}:${s.label}:${formatChordForHelp(s)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (!groups[s.group]) groups[s.group] = [];
		groups[s.group].push({ chord: formatChordForHelp(s), label: s.label });
	}

	const stageHelp = [
		{ chord: 'j / ↓', label: 'Navigate to next stage' },
		{ chord: 'k / ↑', label: 'Navigate to prev stage' },
		{ chord: '⇧J', label: 'Move stage down' },
		{ chord: '⇧K', label: 'Move stage up' },
		{ chord: 'r', label: 'Run stage preview' },
		{ chord: 'x / Del', label: 'Remove stage' },
		{ chord: '⇧D', label: 'Duplicate stage' },
		{ chord: 'v', label: 'Toggle stage disabled' },
		{ chord: 'n', label: 'Add chip to stage' },
		{ chord: 'c', label: 'Collapse / expand stage' },
		{ chord: 'Esc', label: 'Exit to cell command mode' }
	];
	groups['gui-stages'] = [...(groups['gui-stages'] ?? []), ...stageHelp];

	return groups;
}

function formatChordForHelp(s: ShortcutDef): string {
	return formatChord(s.chord);
}
