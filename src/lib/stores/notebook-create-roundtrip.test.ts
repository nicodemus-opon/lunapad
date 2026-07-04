import { beforeEach, describe, expect, it, vi } from 'vitest';

const listProjectNotebooksMock = vi.fn();
const writeProjectFileMock = vi.fn().mockResolvedValue(undefined);

vi.mock('$lib/services/intelligence-db', () => ({
	recordCellExecutionMetadata: vi.fn(),
	recordUploadedTableMetadata: vi.fn(),
	getIntelligentQuickChips: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/services/project-client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/project-client')>();
	return {
		...actual,
		listProjectNotebooks: (...args: unknown[]) => listProjectNotebooksMock(...args),
		writeProjectFile: (...args: unknown[]) => writeProjectFileMock(...args),
		watchProjectFolder: vi.fn(() => () => {}),
		openProject: vi.fn().mockResolvedValue({
			isDbtProject: true,
			isEvidenceProject: false
		})
	};
});

import type { Notebook } from '$lib/stores/notebook.svelte';
import {
	__resetStateForTests,
	addNotebook,
	getActiveTabId,
	getNotebooks,
	getOpenNotebookTabIds,
	loadProjectNotebooks,
	openProject,
	syncNotebookFromPmDocument
} from '$lib/stores/notebook.svelte';
import { cellsToPmDocument } from '$lib/services/notebook-pm';

const STAGING_FOLDER = { id: 'models/staging', name: 'staging', parentId: null };

function diskNotebook(id: string, name: string): Notebook {
	return {
		id,
		name,
		folderId: 'models/staging',
		format: 'luna',
		cells: [
			{
				id: name,
				cellType: 'query',
				outputName: name,
				code: '',
				markdown: '',
				language: 'sql',
				editMode: 'prql',
				guiStages: [{ type: 'from', table: '' }],
				status: 'idle',
				errors: [],
				display: 'full',
				hideResult: false
			} as Notebook['cells'][0]
		],
		defaultCellLanguage: 'sql',
		filters: {}
	} as Notebook;
}

describe('notebook create roundtrip', () => {
	beforeEach(() => {
		__resetStateForTests();
		listProjectNotebooksMock.mockReset();
		writeProjectFileMock.mockClear();
	});

	it('addNotebook PM round-trip keeps the starter query cell', () => {
		addNotebook();
		const nb = getNotebooks().find((n) => n.id === getActiveTabId());
		expect(nb?.cells).toHaveLength(1);
		expect(nb?.cells[0]?.cellType).toBe('query');

		const doc = cellsToPmDocument(nb!.cells);
		syncNotebookFromPmDocument(nb!.id, doc);
		const after = getNotebooks().find((n) => n.id === nb!.id);
		expect(after?.cells).toHaveLength(1);
		expect(after?.cells[0]?.id).toBe(nb!.cells[0].id);
	});

	it('rejects a stale PM document from another notebook on tab switch', () => {
		const first = getNotebooks()[0];
		first.cells = [
			{
				...first.cells[0],
				id: 'old_cell',
				outputName: 'old_cell',
				code: 'select 1'
			}
		];
		addNotebook();
		const newId = getActiveTabId();
		const newNb = getNotebooks().find((n) => n.id === newId)!;
		const originalCellId = newNb.cells[0].id;

		const staleDoc = cellsToPmDocument(first.cells);
		syncNotebookFromPmDocument(newId, staleDoc);

		const reloaded = getNotebooks().find((n) => n.id === newId)!;
		expect(reloaded.cells).toHaveLength(1);
		expect(reloaded.cells[0].id).toBe(originalCellId);
		expect(reloaded.cells.some((c) => c.id === 'old_cell')).toBe(false);
	});

	it('loadProjectNotebooks preserves a new notebook before its .luna file appears on disk', async () => {
		const existing = diskNotebook('models/staging/existing', 'existing');
		listProjectNotebooksMock.mockResolvedValue({
			notebooks: [existing],
			folders: [STAGING_FOLDER]
		});
		await openProject('/tmp/test-project');

		addNotebook();
		const newId = getActiveTabId();
		expect(getOpenNotebookTabIds()).toContain(newId);

		// Watcher reload while the debounced save has not landed on disk yet.
		listProjectNotebooksMock.mockResolvedValue({
			notebooks: [existing],
			folders: [STAGING_FOLDER]
		});
		await loadProjectNotebooks();

		expect(getNotebooks().some((n) => n.id === newId)).toBe(true);
		expect(getOpenNotebookTabIds()).toContain(newId);
		expect(getActiveTabId()).toBe(newId);
	});

	it('allocates a unique notebook path when new_model is already taken', async () => {
		const existing = diskNotebook('models/staging/new_model', 'new_model');
		listProjectNotebooksMock.mockResolvedValue({
			notebooks: [existing],
			folders: [STAGING_FOLDER]
		});
		await openProject('/tmp/test-project');

		addNotebook();
		const created = getNotebooks().find((n) => n.id === getActiveTabId());
		expect(created?.id).toBe('models/staging/new_model_1');
		expect(created?.cells[0]?.outputName).toBe('new_model_1');
	});
});
