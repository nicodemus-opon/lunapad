import { describe, it, expect, beforeEach } from 'vitest';
import {
	classifyNotebookChange,
	labelForNotebookChange,
	relativeTime,
	maybeRecordNotebookRevision,
	getNotebookRevisions,
	recordNotebookRevert,
	MAX_NOTEBOOK_REVISIONS,
	snapshotNotebook,
	fingerprintNotebook,
	type NotebookHistorySnapshot
} from './notebook-history.js';
import type { Cell } from '$lib/stores/notebook.svelte';

function cell(id: string, overrides: Partial<Cell> = {}): Cell {
	return {
		id,
		outputName: id,
		cellType: 'query',
		language: 'prql',
		code: `from ${id}`,
		markdown: '',
		udfBody: '',
		connectionId: null,
		guiStages: [],
		editMode: 'prql',
		materializeMode: 'view',
		description: null,
		dbtTags: [],
		resultChartConfig: null,
		plotConfig: null,
		plotMode: 'code',
		...overrides
	} as unknown as Cell;
}

function snap(name: string, cells: Cell[]): NotebookHistorySnapshot {
	return snapshotNotebook(name, cells);
}

beforeEach(() => {
	if (typeof localStorage === 'undefined') {
		const store = new Map<string, string>();
		// @ts-expect-error — minimal in-memory stub for the node test env
		globalThis.localStorage = {
			getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k),
			clear: () => store.clear()
		};
	} else {
		localStorage.clear();
	}
});

describe('classifyNotebookChange', () => {
	it('detects query edits with the cell name', () => {
		const prev = snap('nb', [cell('orders')]);
		const next = snap('nb', [cell('orders', { code: 'from orders | filter x > 1' })]);
		expect(classifyNotebookChange(prev, next)).toEqual({ kind: 'query', cellName: 'orders' });
	});

	it('detects visualization edits', () => {
		const prev = snap('nb', [cell('orders')]);
		const next = snap('nb', [
			cell('orders', {
				resultChartConfig: { chartType: 'bar', xColumn: 'x', yColumns: ['y'], colorColumn: null }
			})
		]);
		expect(classifyNotebookChange(prev, next)).toEqual({
			kind: 'visualization',
			cellName: 'orders'
		});
	});

	it('detects added and removed cells', () => {
		expect(
			classifyNotebookChange(snap('nb', [cell('a')]), snap('nb', [cell('a'), cell('b')]))
		).toEqual({ kind: 'cell-add', cellName: 'b' });
		expect(
			classifyNotebookChange(snap('nb', [cell('a'), cell('b')]), snap('nb', [cell('a')]))
		).toEqual({ kind: 'cell-remove', cellName: 'b' });
	});

	it('detects reorder and rename', () => {
		expect(
			classifyNotebookChange(snap('nb', [cell('a'), cell('b')]), snap('nb', [cell('b'), cell('a')]))
		).toEqual({ kind: 'reorder' });
		expect(classifyNotebookChange(snap('old', [cell('a')]), snap('new', [cell('a')]))).toEqual({
			kind: 'rename'
		});
	});

	it('prefers structural changes over content edits', () => {
		const prev = snap('nb', [cell('a'), cell('b')]);
		// Same id set, reordered + edited → reorder (structural outranks content).
		const reordered = snap('nb', [cell('b', { code: 'changed' }), cell('a')]);
		expect(classifyNotebookChange(prev, reordered)).toEqual({ kind: 'reorder' });
		// An actual removal outranks a simultaneous edit elsewhere.
		const removed = snap('nb', [cell('b', { code: 'changed' })]);
		expect(classifyNotebookChange(prev, removed)).toEqual({ kind: 'cell-remove', cellName: 'a' });
	});

	it('labels the first content edit in cell order', () => {
		const prev = snap('nb', [cell('a'), cell('b')]);
		const next = snap('nb', [
			cell('a', {
				resultChartConfig: { chartType: 'line', xColumn: 'x', yColumns: ['y'], colorColumn: null }
			}),
			cell('b', { code: 'changed' })
		]);
		// query outranks visualization only within a cell; across cells, order wins
		expect(classifyNotebookChange(prev, next)).toEqual({
			kind: 'visualization',
			cellName: 'a'
		});
	});

	it('returns null when nothing changed', () => {
		expect(classifyNotebookChange(snap('nb', [cell('a')]), snap('nb', [cell('a')]))).toBeNull();
	});

	it('strips runtime fields from snapshots', () => {
		const withRuntime = {
			...cell('a'),
			result: { rows: [{ x: 1 }], columns: ['x'] },
			needsRun: true
		} as unknown as Cell;
		const s = snapshotNotebook('nb', [withRuntime]);
		expect('result' in s.cells[0]).toBe(false);
		expect('needsRun' in s.cells[0]).toBe(false);
		expect(s.cells[0].code).toBe('from a');
	});

	it('fingerprints only compared fields', () => {
		const base = [cell('a')];
		expect(fingerprintNotebook('nb', base)).toBe(fingerprintNotebook('nb', [cell('a')]));
		expect(fingerprintNotebook('nb', base)).not.toBe(
			fingerprintNotebook('nb', [cell('a', { code: 'changed' })])
		);
		// Runtime-only differences are invisible to the fingerprint.
		const withRuntime = { ...cell('a'), result: { rows: [{ x: 1 }], columns: ['x'] } };
		expect(fingerprintNotebook('nb', [withRuntime as unknown as Cell])).toBe(
			fingerprintNotebook('nb', base)
		);
	});
});

describe('labels', () => {
	it('uses single-summary Metabase copy', () => {
		expect(labelForNotebookChange({ kind: 'query', cellName: 'orders' })).toBe(
			'modified the orders query'
		);
		expect(labelForNotebookChange({ kind: 'visualization', cellName: 'orders' })).toBe(
			'changed visualization settings in orders'
		);
		expect(labelForNotebookChange({ kind: 'cell-add', cellName: 'x' })).toBe('added x');
		expect(labelForNotebookChange({ kind: 'reorder' })).toBe('reordered cells');
	});
});

describe('relativeTime', () => {
	it('formats Metabase-style strings', () => {
		const now = new Date('2026-10-10T12:00:00Z').getTime();
		expect(relativeTime(now - 10_000, now)).toBe('just now');
		expect(relativeTime(now - 2 * 60_000, now)).toBe('2 minutes ago');
		expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
		expect(relativeTime(now - 65 * 86_400_000, now)).toBe('2 months ago');
	});
});

describe('revision store', () => {
	it('seeds create then records only real changes, newest-first', () => {
		expect(maybeRecordNotebookRevision('nb1', 'nb', [cell('a')])?.kind).toBe('create');
		expect(maybeRecordNotebookRevision('nb1', 'nb', [cell('a')])).toBeNull();
		expect(maybeRecordNotebookRevision('nb1', 'nb', [cell('a', { code: 'v2' })])?.kind).toBe(
			'query'
		);
		const revs = getNotebookRevisions('nb1');
		expect(revs).toHaveLength(2);
		expect(revs[0].kind).toBe('query');
		expect(revs[0].label).toBe('modified the a query');
	});

	it('revert cuts a new version (non-destructive)', () => {
		maybeRecordNotebookRevision('nb1', 'nb', [cell('a')]);
		maybeRecordNotebookRevision('nb1', 'nb', [cell('a', { code: 'v2' })]);
		const oldest = getNotebookRevisions('nb1').at(-1)!;
		recordNotebookRevert('nb1', oldest.snapshot);
		const after = getNotebookRevisions('nb1');
		expect(after).toHaveLength(3);
		expect(after[0].kind).toBe('revert');
		expect(after[0].snapshot.cells[0].code).toBe('from a');
	});

	it('caps history at 15 like Metabase', () => {
		maybeRecordNotebookRevision('nb1', 'nb', [cell('a')]);
		for (let i = 0; i < MAX_NOTEBOOK_REVISIONS + 5; i++) {
			maybeRecordNotebookRevision('nb1', 'nb', [cell('a', { code: `v${i}` })]);
		}
		expect(getNotebookRevisions('nb1')).toHaveLength(MAX_NOTEBOOK_REVISIONS);
	});
});
