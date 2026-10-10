import { describe, it, expect, beforeEach } from 'vitest';
import {
	classifyCellChange,
	labelForKind,
	relativeTime,
	maybeRecordCellRevision,
	getCellRevisions,
	recordRevertRevision,
	MAX_CELL_REVISIONS,
	snapshotFromCell,
	type CellLike
} from './cell-history.js';

function cell(overrides: Partial<CellLike> = {}): CellLike {
	return {
		id: 'c1',
		cellType: 'query',
		outputName: 'orders',
		code: 'from orders',
		markdown: '',
		udfBody: '',
		language: 'prql',
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
	};
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

describe('classifyCellChange', () => {
	it('detects query edits', () => {
		const prev = snapshotFromCell(cell());
		const next = snapshotFromCell(cell({ code: 'from orders | filter x > 1' }));
		expect(classifyCellChange(prev, next)).toBe('query');
	});

	it('detects gui-stage edits as query edits', () => {
		const prev = snapshotFromCell(cell());
		const next = snapshotFromCell(cell({ guiStages: [{ type: 'filter' }] }));
		expect(classifyCellChange(prev, next)).toBe('query');
	});

	it('detects visualization edits', () => {
		const prev = snapshotFromCell(cell());
		const next = snapshotFromCell(cell({ resultChartConfig: { type: 'bar' } }));
		expect(classifyCellChange(prev, next)).toBe('visualization');
	});

	it('detects markdown edits as text', () => {
		const prev = snapshotFromCell(cell({ cellType: 'markdown', markdown: 'hello' }));
		const next = snapshotFromCell(cell({ cellType: 'markdown', markdown: 'hello!' }));
		expect(classifyCellChange(prev, next)).toBe('text');
	});

	it('detects renames as metadata', () => {
		const prev = snapshotFromCell(cell());
		const next = snapshotFromCell(cell({ outputName: 'orders2' }));
		expect(classifyCellChange(prev, next)).toBe('metadata');
	});

	it('prefers query over visualization when both changed', () => {
		const prev = snapshotFromCell(cell());
		const next = snapshotFromCell(
			cell({ code: 'from orders2', resultChartConfig: { type: 'line' } })
		);
		expect(classifyCellChange(prev, next)).toBe('query');
	});

	it('returns null when nothing changed', () => {
		const snap = snapshotFromCell(cell());
		expect(classifyCellChange(snap, snapshotFromCell(cell()))).toBeNull();
	});
});

describe('labels', () => {
	it('uses Metabase copy', () => {
		expect(labelForKind('query')).toBe('modified the query');
		expect(labelForKind('visualization')).toBe('changed the visualization settings');
	});
});

describe('relativeTime', () => {
	it('formats Metabase-style strings', () => {
		const now = new Date('2026-10-10T12:00:00Z').getTime();
		expect(relativeTime(now - 10_000, now)).toBe('just now');
		expect(relativeTime(now - 2 * 60_000, now)).toBe('2 minutes ago');
		expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2 hours ago');
		expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
		expect(relativeTime(now - 65 * 86_400_000, now)).toBe('2 months ago');
	});
});

describe('revision store', () => {
	it('seeds a create revision then records only real changes', () => {
		const first = maybeRecordCellRevision('nb1', cell());
		expect(first?.kind).toBe('create');
		expect(maybeRecordCellRevision('nb1', cell())).toBeNull();
		const changed = maybeRecordCellRevision('nb1', cell({ code: 'from orders2' }));
		expect(changed?.kind).toBe('query');
		expect(getCellRevisions('nb1', 'c1')).toHaveLength(2);
		// newest first
		expect(getCellRevisions('nb1', 'c1')[0].kind).toBe('query');
	});

	it('revert cuts a new version (non-destructive)', () => {
		maybeRecordCellRevision('nb1', cell());
		maybeRecordCellRevision('nb1', cell({ code: 'v2' }));
		const [latest] = getCellRevisions('nb1', 'c1');
		expect(latest.kind).toBe('query');
		const oldest = getCellRevisions('nb1', 'c1').at(-1)!;
		recordRevertRevision('nb1', cell({ code: 'v2' }), oldest.snapshot);
		const after = getCellRevisions('nb1', 'c1');
		expect(after).toHaveLength(3);
		expect(after[0].kind).toBe('revert');
		expect(after[0].snapshot.code).toBe('from orders');
	});

	it('caps history at 15 like Metabase', () => {
		maybeRecordCellRevision('nb1', cell());
		for (let i = 0; i < MAX_CELL_REVISIONS + 5; i++) {
			maybeRecordCellRevision('nb1', cell({ code: `from orders_${i}` }));
		}
		expect(getCellRevisions('nb1', 'c1')).toHaveLength(MAX_CELL_REVISIONS);
	});
});
