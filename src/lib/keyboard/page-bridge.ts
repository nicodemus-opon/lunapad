export interface PageBridge {
	isCommandPaletteOpen: () => boolean;
	isShortcutsOpen: () => boolean;
	toggleCommandPalette: () => void;
	openShortcuts: () => void;
	toggleSidebar: () => void;
	saveAll: () => void;
	switchNotebookTab: (index: number) => void;
	toggleAIChat: () => void;
	openComments: () => void;
	addPrqlCell: () => void;
	addMarkdownCell: () => void;
	runAll: () => void;
	isNotebookTab: () => boolean;
	toggleNotebookOutline: () => void;
	isWorksheetView: () => boolean;
	closeWorksheetView: () => void;
	goBackPageNav: () => void;
	goForwardPageNav: () => void;
}

let pageBridge: PageBridge | null = null;

export function registerPageBridge(bridge: PageBridge): () => void {
	pageBridge = bridge;
	return () => {
		pageBridge = null;
	};
}

export function getPageBridge(): PageBridge | null {
	return pageBridge;
}
