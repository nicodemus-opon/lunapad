import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, './NotebookDocumentEditor.svelte'), 'utf8');
const extensionSource = readFileSync(resolve(currentDir, './slash-command-extension.ts'), 'utf8');
const pageSource = readFileSync(resolve(currentDir, '../../../../routes/+page.svelte'), 'utf8');

describe('NotebookDocumentEditor control insertion', () => {
	it('threads notebook control slash commands to the store insertion callback', () => {
		expect(source).toContain('onInsertControlCell?:');
		expect(source).toContain('function insertControlBlock');
		expect(source).toContain('insertControlBlockCell(anchorId, kind, notebookId)');
		expect(source).toContain('insertControlCell: (kind, e) => insertControlBlock(kind, e)');
		expect(pageSource).toContain('function insertControlCellFromGui');
		expect(pageSource).toContain('onInsertControlCell={(kind) => insertControlCellFromGui(kind)}');
	});

	it('maps every notebook control slash command to a durable control kind', () => {
		for (const id of [
			'control-text-input',
			'control-number-input',
			'control-slider',
			'control-date-input',
			'control-date-range',
			'control-checkbox',
			'control-select',
			'control-multiselect',
			'control-run-button',
			'control-file-upload',
			'control-table-input',
			'control-table-display',
			'control-pivot',
			'control-map',
			'control-single-value',
			'control-writeback',
			'control-agent'
		]) {
			expect(extensionSource).toContain(`'${id}'`);
		}
		expect(extensionSource).toContain('const insertControlCell = this.options.insertControlCell');
		expect(extensionSource).toContain('insertControlCell,');
		expect(extensionSource).toContain('insertControlCell?.(CONTROL_COMMAND_KIND[id]');
	});
});
