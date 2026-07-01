import { buildShortcutContext } from './context';
import { findMatchingShortcut } from './match';
import { getPageBridge } from './page-bridge';
import { SHORTCUTS } from './shortcuts';
import { dispatchStageEditorKey } from './stage-bridge';
import type { ShortcutContext } from './types';

let mounted = false;

function shouldSkipDispatch(e: KeyboardEvent): boolean {
	const bridge = getPageBridge();
	if (bridge?.isCommandPaletteOpen()) return true;
	if (bridge?.isShortcutsOpen()) return true;
	// Let native inputs handle keys unless a shortcut explicitly matches with higher priority
	return false;
}

function tryStageEditorFallback(ctx: ShortcutContext, e: KeyboardEvent): boolean {
	if (!ctx.stageEditorEl || ctx.isTypingTarget) return false;
	if (!ctx.contexts.includes('stage-editor')) return false;
	return dispatchStageEditorKey(ctx.stageEditorEl, e);
}

export function dispatchShortcut(e: KeyboardEvent): void {
	if (shouldSkipDispatch(e)) return;

	const ctx = buildShortcutContext(e);
	const match = findMatchingShortcut(SHORTCUTS, e, ctx);

	if (match) {
		e.preventDefault();
		e.stopImmediatePropagation();
		match.handler(ctx);
		return;
	}

	if (tryStageEditorFallback(ctx, e)) {
		e.preventDefault();
		e.stopImmediatePropagation();
	}
}

export function mountKeyboardDispatcher(): () => void {
	if (mounted) return () => {};
	mounted = true;

	const listener = (e: KeyboardEvent) => dispatchShortcut(e);
	document.addEventListener('keydown', listener, { capture: true });

	return () => {
		document.removeEventListener('keydown', listener, { capture: true });
		mounted = false;
	};
}
