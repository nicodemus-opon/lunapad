export interface StageEditorHandlers {
	handleKeydown: (event: KeyboardEvent) => boolean;
}

const stageEditors = new WeakMap<HTMLElement, StageEditorHandlers>();

export function registerStageEditor(el: HTMLElement, handlers: StageEditorHandlers): () => void {
	stageEditors.set(el, handlers);
	return () => stageEditors.delete(el);
}

export function dispatchStageEditorKey(el: HTMLElement, event: KeyboardEvent): boolean {
	return stageEditors.get(el)?.handleKeydown(event) ?? false;
}

export interface StageMenuHandlers {
	isOpen: () => boolean;
	openMenu: () => void;
	closeMenu: () => void;
	chooseByIndex: (index: number) => void;
	handleEnter: (opts: { shiftKey: boolean; fromTyping: boolean }) => void;
	runCmdEnter: () => void;
}

const stageMenus = new WeakMap<HTMLElement, StageMenuHandlers>();

export function registerStageMenu(el: HTMLElement, handlers: StageMenuHandlers): () => void {
	stageMenus.set(el, handlers);
	return () => stageMenus.delete(el);
}

export function getStageMenu(el: HTMLElement): StageMenuHandlers | undefined {
	return stageMenus.get(el);
}

export function findStageMenuInEditor(stageEditorEl: HTMLElement): StageMenuHandlers | undefined {
	const menuEl = stageEditorEl.querySelector<HTMLElement>('[data-keyboard-scope="stage-menu"]');
	if (!menuEl) return undefined;
	return stageMenus.get(menuEl);
}

export function findOpenStageMenu(): { el: HTMLElement; handlers: StageMenuHandlers } | null {
	for (const el of document.querySelectorAll<HTMLElement>('[data-keyboard-scope="stage-menu"]')) {
		const handlers = stageMenus.get(el);
		if (handlers?.isOpen()) return { el, handlers };
	}
	return null;
}
