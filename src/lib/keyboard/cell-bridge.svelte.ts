import type { CellMeta } from './types';

const cellMeta = new Map<string, CellMeta>();

export const cellBridgeState = $state({
	pendingInlinePromptCellId: null as string | null,
	pendingGuiSlashCellId: null as string | null,
	pendingEnterEditCellId: null as string | null
});

let ddPendingCellId: string | null = null;
let ddPendingTimer: ReturnType<typeof setTimeout> | null = null;

export function registerCellMeta(meta: CellMeta): () => void {
	cellMeta.set(meta.cellId, meta);
	return () => cellMeta.delete(meta.cellId);
}

export function getCellMeta(cellId: string): CellMeta | undefined {
	return cellMeta.get(cellId);
}

export function requestInlinePrompt(cellId: string): void {
	cellBridgeState.pendingInlinePromptCellId = cellId;
}

export function requestGuiSlash(cellId: string): void {
	cellBridgeState.pendingGuiSlashCellId = cellId;
}

export function requestEnterEdit(cellId: string): void {
	cellBridgeState.pendingEnterEditCellId = cellId;
}

export function handleDdDelete(cellId: string, _cellEl: HTMLElement): boolean {
	if (ddPendingCellId === cellId) {
		ddPendingCellId = null;
		if (ddPendingTimer) clearTimeout(ddPendingTimer);
		ddPendingTimer = null;
		return true;
	}
	ddPendingCellId = cellId;
	if (ddPendingTimer) clearTimeout(ddPendingTimer);
	ddPendingTimer = setTimeout(() => {
		ddPendingCellId = null;
		ddPendingTimer = null;
	}, 500);
	return false;
}

export function resetDdPending(): void {
	ddPendingCellId = null;
	if (ddPendingTimer) clearTimeout(ddPendingTimer);
	ddPendingTimer = null;
}

export function getFocusedCellEl(active: Element | null): HTMLElement | null {
	if (!active) return null;
	const cell = active.closest<HTMLElement>('.notebook-cell[tabindex]');
	if (cell) return cell;
	return document.querySelector<HTMLElement>('.notebook-cell[tabindex]:focus');
}

export function focusAdjacentCell(currentEl: HTMLElement, dir: 'prev' | 'next'): void {
	const all = Array.from(document.querySelectorAll<HTMLElement>('.notebook-cell[tabindex]'));
	const idx = all.indexOf(currentEl);
	const next = all[dir === 'prev' ? idx - 1 : idx + 1];
	next?.focus();
}

export function focusCellById(id: string): void {
	document
		.querySelector<HTMLElement>(`.notebook-cell[data-cell-id="${CSS.escape(id)}"]`)
		?.focus();
}

export function focusCellAfterDelete(deletedEl: HTMLElement): void {
	const all = Array.from(document.querySelectorAll<HTMLElement>('.notebook-cell[tabindex]'));
	const idx = all.indexOf(deletedEl);
	(all[idx] ?? all[idx - 1] ?? all[0])?.focus();
}
