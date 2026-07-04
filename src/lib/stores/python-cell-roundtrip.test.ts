import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/intelligence-db', () => ({
	recordCellExecutionMetadata: vi.fn(),
	recordUploadedTableMetadata: vi.fn(),
	getIntelligentQuickChips: vi.fn().mockResolvedValue([])
}));

import {
	__resetStateForTests,
	exportJSON,
	getCells,
	getNotebooks,
	importJSON,
	insertQueryBlockCell,
	syncNotebookFromPmDocument,
	updateCellCode,
	updatePythonCellCode
} from '$lib/stores/notebook.svelte';
import { cellsToPmDocument } from '$lib/services/notebook-pm';

function pythonCellFixture(code = 'orders.head()') {
	const nb = getNotebooks()[0];
	return {
		...nb.cells[0],
		id: 'py-cell-1',
		cellType: 'python' as const,
		outputName: 'py_analysis',
		code,
		language: 'prql' as const,
		editMode: 'prql' as const,
		status: 'success' as const,
		result: null,
		pythonOutput: {
			stdout: 'hello from python\n',
			figures: [],
			error: null
		},
		guiStages: [{ type: 'from', table: '' }]
	};
}

describe('python cell roundtrip', () => {
	beforeEach(() => {
		__resetStateForTests();
	});

	it('updatePythonCellCode persists code changes (updateCellCode ignores python)', () => {
		const nb = getNotebooks()[0];
		nb.cells = [pythonCellFixture('old code') as unknown as (typeof nb.cells)[0]];
		updatePythonCellCode('py-cell-1', 'new code');
		expect(getCells()[0].code).toBe('new code');
		updateCellCode('py-cell-1', 'ignored');
		expect(getCells()[0].code).toBe('new code');
	});

	it('exportJSON/importJSON round-trips python cell code and stdout output', () => {
		const nb = getNotebooks()[0];
		nb.cells = [pythonCellFixture('orders.describe()') as unknown as (typeof nb.cells)[0]];
		const json = exportJSON();
		__resetStateForTests();
		importJSON(json);
		const cell = getCells().find((c) => c.id === 'py-cell-1');
		expect(cell?.cellType).toBe('python');
		expect(cell?.code).toBe('orders.describe()');
		expect(cell?.pythonOutput?.stdout).toContain('hello from python');
		expect(cell?.status).toBe('success');
	});

	it('exportJSON/importJSON round-trips python cells with a DataFrame result and stdout', () => {
		const nb = getNotebooks()[0];
		nb.cells = [
			{
				...pythonCellFixture('result = orders.head()'),
				result: {
					rows: [{ id: 1, status: 'ok' }],
					columns: ['id', 'status']
				},
				pythonOutput: {
					stdout: 'computed\n',
					figures: [],
					error: null
				}
			} as unknown as (typeof nb.cells)[0]
		];
		const json = exportJSON();
		__resetStateForTests();
		importJSON(json);
		const cell = getCells().find((c) => c.id === 'py-cell-1');
		expect(cell?.result?.rows).toHaveLength(1);
		expect(cell?.pythonOutput?.stdout).toBe('computed\n');
		expect(cell?.status).toBe('success');
	});

	it('syncNotebookFromPmDocument preserves python code when the PM document changes', () => {
		const nb = getNotebooks()[0];
		nb.cells = [
			{
				id: 'md1',
				cellType: 'markdown',
				markdown: 'Before',
				outputName: '',
				code: '',
				language: 'prql',
				editMode: 'prql',
				guiStages: [{ type: 'from', table: '' }],
				status: 'idle',
				errors: [],
				display: 'full',
				hideResult: false
			} as unknown as unknown as (typeof nb.cells)[0],
			pythonCellFixture('upstream.head()') as unknown as (typeof nb.cells)[0]
		];
		const doc = cellsToPmDocument(nb.cells);
		// Simulate a structural PM edit: trailing affordance paragraph gains text.
		const trailing = (doc.content ?? []).at(-1);
		if (trailing?.type === 'paragraph') {
			trailing.content = [{ type: 'text', text: 'Trailing note' }];
		}
		syncNotebookFromPmDocument(nb.id, doc);
		const py = getCells().find((c) => c.id === 'py-cell-1');
		expect(py?.cellType).toBe('python');
		expect(py?.code).toBe('upstream.head()');
		expect(py?.pythonOutput?.stdout).toContain('hello from python');
	});

	it('insertQueryBlockCell creates a python cell in the notebook', () => {
		const anchorId = getCells()[0].id;
		const newId = insertQueryBlockCell(anchorId, 'python');
		expect(newId).toBeTruthy();
		const inserted = getCells().find((c) => c.id === newId);
		expect(inserted?.cellType).toBe('python');
		expect(inserted?.display).toBe('output');
	});
});
