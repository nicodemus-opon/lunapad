import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/intelligence-db', () => ({
	recordCellExecutionMetadata: vi.fn(),
	recordUploadedTableMetadata: vi.fn(),
	getIntelligentQuickChips: vi.fn().mockResolvedValue([])
}));

import {
	__resetStateForTests,
	addCell,
	getActiveTabId,
	getCells,
	getNotebooks,
	removeCell,
	renameNotebook,
	restoreNotebookHistorySnapshot,
	undo
} from '$lib/stores/notebook.svelte';
import { snapshotNotebook, type NotebookHistorySnapshot } from '$lib/services/notebook-history';

function activeNotebook() {
	return getNotebooks().find((n) => n.id === getActiveTabId())!;
}

/** Full app path: snapshot → localStorage JSON round-trip → restore. */
function roundTrip(snap: NotebookHistorySnapshot): NotebookHistorySnapshot {
	return JSON.parse(JSON.stringify(snap)) as NotebookHistorySnapshot;
}

describe('restoreNotebookHistorySnapshot', () => {
	beforeEach(() => {
		__resetStateForTests();
	});

	it('restores edited code to the snapshotted version', () => {
		addCell();
		const nb = activeNotebook();
		const cell = getCells()[getCells().length - 1];
		const originalCode = cell.code;
		const before = roundTrip(snapshotNotebook(nb.name, nb.cells));
		cell.code = 'from orders_changed_by_user';
		expect(restoreNotebookHistorySnapshot(nb.id, before)).toBe(true);
		expect(getCells().find((c) => c.id === cell.id)?.code).toBe(originalCode);
	});

	it('restores visualization settings (chart config) on live cells', () => {
		addCell();
		const nb = activeNotebook();
		const cell = getCells()[getCells().length - 1];
		const before = roundTrip(snapshotNotebook(nb.name, nb.cells));
		cell.resultChartConfig = {
			chartType: 'bar',
			xColumn: 'x',
			yColumns: ['y'],
			colorColumn: null
		};
		expect(cell.resultChartConfig).not.toBeNull();
		expect(restoreNotebookHistorySnapshot(nb.id, before)).toBe(true);
		expect(getCells().find((c) => c.id === cell.id)?.resultChartConfig).toBeNull();
	});

	it('restores structure: resurrected deleted cells, dropped added cells, order, name', () => {
		addCell();
		addCell();
		const nb = activeNotebook();
		const [first, second] = getCells().slice(-2);
		const before = roundTrip(snapshotNotebook(nb.name, nb.cells));
		removeCell(first.id, nb);
		addCell();
		renameNotebook(nb.id, 'renamed!');
		expect(getCells().some((c) => c.id === first.id)).toBe(false);
		expect(restoreNotebookHistorySnapshot(nb.id, before)).toBe(true);
		const ids = getCells().map((c) => c.id);
		expect(ids).toContain(first.id);
		expect(ids).toContain(second.id);
		expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
		expect(ids).toHaveLength(before.cells.length);
		expect(activeNotebook().name).toBe(before.name);
	});

	it('session undo still works after a history revert', () => {
		addCell();
		const nb = activeNotebook();
		const cell = getCells()[getCells().length - 1];
		const originalCode = cell.code;
		const before = roundTrip(snapshotNotebook(nb.name, nb.cells));
		cell.code = 'changed';
		expect(restoreNotebookHistorySnapshot(nb.id, before)).toBe(true);
		expect(getCells().find((c) => c.id === cell.id)?.code).toBe(originalCode);
		undo();
		expect(getCells().find((c) => c.id === cell.id)?.code).toBe('changed');
	});

	it('returns false for an unknown notebook', () => {
		addCell();
		const nb = activeNotebook();
		const before = snapshotNotebook(nb.name, nb.cells);
		expect(restoreNotebookHistorySnapshot('nope', before)).toBe(false);
	});
});
