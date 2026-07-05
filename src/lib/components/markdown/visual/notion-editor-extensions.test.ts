import { describe, expect, it } from 'vitest';
import {
	buildNotionEditorExtensions,
	expandExtensionNames,
	type NotionEditorExtensionOptions
} from './notion-editor-extensions';

function buildOptions(): NotionEditorExtensionOptions {
	return {
		getCells: () => [],
		getNotebookId: () => 'nb-test',
		slashHandler: {
			onStart: () => {},
			onUpdate: () => {},
			onExit: () => {}
		},
		bubbleMenuElement: {} as HTMLElement,
		bubbleMenuGate: {
			isSlashOpen: () => false,
			isContextMenuOpen: () => false
		},
		dragHandleRender: () => ({}) as HTMLElement
	};
}

describe('buildNotionEditorExtensions', () => {
	it('keeps expanded TipTap extension names unique', () => {
		const extensions = buildNotionEditorExtensions(buildOptions());
		const names = expandExtensionNames(extensions);
		const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
		expect(duplicates).toEqual([]);
	});

	it('does not reintroduce StarterKit link, underline, or listKeymap', () => {
		const names = expandExtensionNames(buildNotionEditorExtensions(buildOptions()));
		expect(names.filter((name) => name === 'link')).toHaveLength(1);
		expect(names.filter((name) => name === 'underline')).toHaveLength(1);
		expect(names.filter((name) => name === 'listKeymap')).toHaveLength(1);
	});
});
