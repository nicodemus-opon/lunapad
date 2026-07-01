export type KeyboardContext =
	| 'modal'
	| 'stage-menu'
	| 'stage-editor'
	| 'monaco-markdown'
	| 'monaco-code'
	| 'command-mode'
	| 'global';

export type ShortcutGroup =
	| 'global'
	| 'command-mode'
	| 'cell-editor'
	| 'gui-stages'
	| 'markdown-editor';

export interface KeyChord {
	key: string;
	mod?: boolean;
	shift?: boolean;
	alt?: boolean;
	/** When true, mod and shift must NOT be set */
	plain?: boolean;
}

export interface ShortcutContext {
	event: KeyboardEvent;
	contexts: KeyboardContext[];
	cellId: string | null;
	cellEl: HTMLElement | null;
	stageEditorEl: HTMLElement | null;
	stageMenuEl: HTMLElement | null;
	isTypingTarget: boolean;
	isNativeInputTarget: boolean;
}

export interface ShortcutDef {
	id: string;
	chord: KeyChord;
	contexts: KeyboardContext[];
	group: ShortcutGroup;
	label: string;
	/** Higher priority wins when multiple shortcuts match */
	priority?: number;
	when?: (ctx: ShortcutContext) => boolean;
	handler: (ctx: ShortcutContext) => void;
	/** Shown in help dialog; set false for internal/duplicate bindings */
	showInHelp?: boolean;
}

export type CellDisplay = 'full' | 'collapsed' | 'output';

export interface CellMeta {
	cellId: string;
	canInlinePrompt: boolean;
	isQueryCell: boolean;
	isGuiCell: boolean;
	isDbtProject: boolean;
	worksheetEligible: boolean;
	collapsed: boolean;
	display: CellDisplay;
	outputName: string;
}
