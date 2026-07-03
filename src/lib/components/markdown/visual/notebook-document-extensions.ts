import type { Extensions } from '@tiptap/core';
import {
	buildNotionEditorExtensions,
	type NotionEditorExtensionOptions
} from './notion-editor-extensions';
import {
	createQueryBlockExtension,
	type QueryBlockExtensionContext
} from './query-block-extension';
import { createNotebookPageExtension } from './notebook-page-extension';

export interface NotebookDocumentExtensionOptions extends NotionEditorExtensionOptions {
	queryBlock: QueryBlockExtensionContext;
}

export function buildNotebookDocumentExtensions(opts: NotebookDocumentExtensionOptions): Extensions {
	return [
		...buildNotionEditorExtensions(opts),
		createQueryBlockExtension(opts.queryBlock),
		createNotebookPageExtension()
	];
}
