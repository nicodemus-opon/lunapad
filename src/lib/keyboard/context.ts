import type { KeyboardContext, ShortcutContext } from './types';
import { getCellMeta, getFocusedCellEl } from './cell-bridge.svelte';
import { findOpenStageMenu } from './stage-bridge';

export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function isNativeInputTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function closest(el: Element | null, selector: string): HTMLElement | null {
	return el?.closest(selector) ?? null;
}

export function deriveContexts(active: Element | null): KeyboardContext[] {
	const contexts: KeyboardContext[] = [];
	if (!active) {
		contexts.push('global');
		return contexts;
	}

	if (closest(active, '[data-keyboard-scope="modal"]')) {
		contexts.push('modal');
	}
	if (closest(active, '[data-keyboard-scope="stage-menu"]')) {
		contexts.push('stage-menu');
	}
	if (findOpenStageMenu()) {
		if (!contexts.includes('stage-menu')) contexts.push('stage-menu');
	}
	if (closest(active, '.stage-editor')) {
		contexts.push('stage-editor');
	}
	if (closest(active, '.markdown-editor .monaco-editor')) {
		contexts.push('monaco-markdown');
	}
	if (closest(active, '.code-editor .monaco-editor')) {
		contexts.push('monaco-code');
	}

	const cellEl = closest(active, '.notebook-cell[tabindex]');
	if (cellEl && active === cellEl) {
		contexts.push('command-mode');
	}

	if (contexts.length === 0 || !contexts.includes('modal')) {
		contexts.push('global');
	}
	return contexts;
}

export function buildShortcutContext(e: KeyboardEvent): ShortcutContext {
	const active = document.activeElement instanceof Element ? document.activeElement : null;
	const cellEl = getFocusedCellEl(active);
	const cellId = cellEl?.dataset.cellId ?? null;

	return {
		event: e,
		contexts: deriveContexts(active),
		cellId,
		cellEl,
		stageEditorEl: closest(active, '.stage-editor'),
		stageMenuEl: closest(active, '[data-keyboard-scope="stage-menu"]'),
		isTypingTarget: isTypingTarget(e.target),
		isNativeInputTarget: isNativeInputTarget(e.target)
	};
}

export function getCellMetaFromContext(ctx: ShortcutContext) {
	if (!ctx.cellId) return null;
	return getCellMeta(ctx.cellId);
}
