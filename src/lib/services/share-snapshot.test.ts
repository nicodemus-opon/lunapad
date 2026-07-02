import { describe, expect, it } from 'vitest';
import { buildShareSnapshot } from './share-snapshot';
import type { Notebook } from '$lib/stores/notebook.svelte';
import { BUILTIN_DUCKDB_CONNECTION } from '$lib/types/connection';

function makeNotebook(cells: Notebook['cells']): Notebook {
	return {
		id: 'nb1',
		name: 'Test',
		folderId: null,
		cells,
		reportView: true,
		format: 'luna'
	} as Notebook;
}

describe('buildShareSnapshot', () => {
	it('marks markdoc-referenced query cells as data role', () => {
		const notebook = makeNotebook([
			{
				id: 'q1',
				cellType: 'query',
				outputName: 'orders',
				display: 'full',
				language: 'sql',
				code: 'select 1',
				connectionId: BUILTIN_DUCKDB_CONNECTION.id,
				result: { rows: [{ n: 1 }], columns: ['n'] }
			} as unknown as Notebook['cells'][number],
			{
				id: 'm1',
				cellType: 'markdown',
				outputName: '',
				display: 'full',
				language: 'prql',
				markdown: '{% chart ref=$orders /%}',
				code: ''
			} as unknown as Notebook['cells'][number]
		]);
		const snapshot = buildShareSnapshot(notebook);
		const orders = snapshot.cells.find((c) => c.outputName === 'orders');
		expect(orders?.publishRole).toBe('data');
		expect(orders?.isLive).toBe(false);
	});

	it('includes column conditional format rules in snapshots', () => {
		const notebook = makeNotebook([
			{
				id: 'q1',
				cellType: 'query',
				outputName: 'orders',
				display: 'full',
				language: 'sql',
				code: 'select 1',
				connectionId: BUILTIN_DUCKDB_CONNECTION.id,
				result: { rows: [{ n: 1 }], columns: ['n'] },
				columnFormatRules: {
					n: [{ id: 'n:rule', type: 'threshold', op: '>', value: 0, tone: 'positive' }]
				}
			} as unknown as Notebook['cells'][number]
		]);
		const snapshot = buildShareSnapshot(notebook);
		const orders = snapshot.cells.find((c) => c.outputName === 'orders');
		expect(orders?.columnFormatRules?.n?.length).toBe(1);
	});
});
