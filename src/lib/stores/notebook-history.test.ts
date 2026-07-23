import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { recordCellExecutionMetadataMock, recordUploadedTableMetadataMock } = vi.hoisted(() => ({
	recordCellExecutionMetadataMock: vi.fn(),
	recordUploadedTableMetadataMock: vi.fn()
}));

vi.mock('$lib/services/intelligence-db', () => ({
	recordCellExecutionMetadata: recordCellExecutionMetadataMock,
	recordUploadedTableMetadata: recordUploadedTableMetadataMock,
	getIntelligentQuickChips: vi.fn().mockResolvedValue([])
}));

const { dropViewMock } = vi.hoisted(() => ({
	dropViewMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/services/duckdb', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/services/duckdb')>('$lib/services/duckdb');
	return { ...actual, dropView: dropViewMock };
});

import {
	__resetStateForTests,
	addCell,
	addNotebook,
	removeCell,
	duplicateCell,
	copyCellToClipboard,
	pasteCellAfter,
	hasClipboardCell,
	updateCellCode,
	setActiveTab,
	undo,
	redo,
	canUndo,
	canRedo,
	getCells,
	getNotebooks,
	notebookHistorySignal
} from '$lib/stores/notebook.svelte';

describe('notebook undo/redo + copy/paste/duplicate', () => {
	beforeEach(() => {
		__resetStateForTests();
		recordCellExecutionMetadataMock.mockReset();
		recordUploadedTableMetadataMock.mockReset();
		dropViewMock.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('canUndo/canRedo are false on a fresh notebook', () => {
		expect(canUndo()).toBe(false);
		expect(canRedo()).toBe(false);
	});

	it('undo after addCell removes the added cell; redo re-adds it', () => {
		const before = getCells().length;
		addCell();
		expect(getCells()).toHaveLength(before + 1);
		expect(canUndo()).toBe(true);

		undo();
		expect(getCells()).toHaveLength(before);
		expect(canRedo()).toBe(true);

		redo();
		expect(getCells()).toHaveLength(before + 1);
	});

	it('undo after removeCell restores the cell, including its prior result/status', () => {
		addCell();
		const cell = getCells()[getCells().length - 1];
		cell.result = { rows: [{ x: 1 }], columns: ['x'] };
		cell.status = 'success';
		const cellId = cell.id;
		const countBefore = getCells().length;

		removeCell(cellId);
		expect(getCells()).toHaveLength(countBefore - 1);
		expect(dropViewMock).toHaveBeenCalled();

		undo();
		expect(getCells()).toHaveLength(countBefore);
		const restored = getCells().find((c) => c.id === cellId);
		expect(restored).toBeDefined();
		expect(restored!.result).toEqual({ rows: [{ x: 1 }], columns: ['x'] });
		expect(restored!.status).toBe('success');
	});

	it('a burst of updateCellCode calls collapses into a single undo step', () => {
		vi.useFakeTimers();
		const cellId = getCells()[0].id;
		const originalCode = getCells()[0].code;

		updateCellCode(cellId, 'select 1');
		vi.advanceTimersByTime(200);
		updateCellCode(cellId, 'select 1, 2');
		vi.advanceTimersByTime(200);
		updateCellCode(cellId, 'select 1, 2, 3');

		expect(getCells()[0].code).toBe('select 1, 2, 3');
		expect(canUndo()).toBe(true);

		undo();
		expect(getCells()[0].code).toBe(originalCode);
		// The whole burst was one step — a second undo has nothing left to do.
		expect(canUndo()).toBe(false);
	});

	it('a new burst after the idle window checkpoints again', () => {
		vi.useFakeTimers();
		const cellId = getCells()[0].id;

		updateCellCode(cellId, 'select 1');
		vi.advanceTimersByTime(1000); // past the 800ms coalescing window
		updateCellCode(cellId, 'select 1, 2');

		undo();
		expect(getCells()[0].code).toBe('select 1');
		undo();
		expect(getCells()[0].code).not.toBe('select 1');
	});

	it('duplicateCell inserts immediately after the source with a deconflicted outputName', () => {
		const source = getCells()[0];
		const countBefore = getCells().length;

		const newId = duplicateCell(source.id);
		expect(newId).not.toBe('');
		const cells = getCells();
		expect(cells).toHaveLength(countBefore + 1);
		const idx = cells.findIndex((c) => c.id === source.id);
		expect(cells[idx + 1].id).toBe(newId);
		expect(cells[idx + 1].outputName).toBe(`${source.outputName}_copy`);
		expect(cells[idx + 1].code).toBe(source.code);

		undo();
		expect(getCells()).toHaveLength(countBefore);
		expect(getCells().some((c) => c.id === newId)).toBe(false);
	});

	it('copyCellToClipboard + pasteCellAfter round-trips a cell with a new id and deconflicted outputName', async () => {
		vi.stubGlobal('navigator', {
			clipboard: {
				writeText: vi.fn().mockResolvedValue(undefined),
				readText: vi.fn().mockRejectedValue(new Error('no permission'))
			}
		});

		const source = getCells()[0];
		expect(hasClipboardCell()).toBe(false);
		copyCellToClipboard(source.id);
		expect(hasClipboardCell()).toBe(true);

		const countBefore = getCells().length;
		const newId = await pasteCellAfter(source.id);
		expect(newId).not.toBe('');
		const cells = getCells();
		expect(cells).toHaveLength(countBefore + 1);
		const pasted = cells.find((c) => c.id === newId)!;
		expect(pasted.id).not.toBe(source.id);
		expect(pasted.outputName).toBe(`${source.outputName}_copy`);
		expect(pasted.code).toBe(source.code);
	});

	it('pasteCellAfter returns "" when the clipboard is empty', async () => {
		const result = await pasteCellAfter(null);
		expect(result).toBe('');
	});

	it('evicts the oldest undo step once the depth cap is exceeded', () => {
		for (let i = 0; i < 55; i++) addCell();
		// Capped at 50 — undoing 55 times should leave the notebook with extra
		// (un-undoable) cells rather than erroring.
		for (let i = 0; i < 55; i++) undo();
		expect(canUndo()).toBe(false);
		expect(getCells().length).toBeGreaterThan(1);
	});

	it('undo/redo bump notebookHistorySignal for the affected notebook so the visual editor can force a resync', () => {
		const nbId = getNotebooks()[0].id;
		const seqBefore = notebookHistorySignal.seq;

		addCell();
		undo();
		expect(notebookHistorySignal.notebookId).toBe(nbId);
		expect(notebookHistorySignal.seq).toBe(seqBefore + 1);

		redo();
		expect(notebookHistorySignal.notebookId).toBe(nbId);
		expect(notebookHistorySignal.seq).toBe(seqBefore + 2);
	});

	it('history is scoped per notebook', () => {
		const nbAId = getNotebooks()[0].id;
		const countA = getCells().length;
		addCell(); // checkpoints notebook A

		addNotebook(); // creates + activates notebook B
		expect(canUndo()).toBe(false); // B has its own, empty stack
		addCell(); // checkpoints notebook B
		expect(canUndo()).toBe(true);
		undo();
		expect(canUndo()).toBe(false);

		setActiveTab(nbAId);
		// Notebook A's stack is untouched by anything that happened on B.
		expect(canUndo()).toBe(true);
		undo();
		expect(getCells()).toHaveLength(countA);
	});
});
