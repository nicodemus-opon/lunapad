import { describe, expect, it } from 'vitest';
import type { Cell } from '$lib/stores/notebook.svelte';
import {
	buildNotebookOutline,
	headingAnchorId,
	slugifyHeading,
	textFromMarkdocChildren
} from './notebook-outline';

function makeCell(partial: Partial<Cell> & Pick<Cell, 'id' | 'cellType'>): Cell {
	return {
		id: partial.id,
		cellType: partial.cellType,
		connectionId: null,
		outputName: partial.outputName ?? '',
		code: partial.code ?? '',
		markdown: partial.markdown ?? '',
		markdownPreview: false,
		markdownEditMode: 'source' as const,
		udfBody: '',
		language: 'prql',
		status: 'idle',
		result: null,
		pythonOutput: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: [],
		editMode: 'prql',
		resultViewMode: 'table',
		resultChartConfig: null,
		display: 'full',
		stageResultsCollapsed: [],
		materializeMode: 'table',
		materializeTarget: '',
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description: null,
		dbtSchema: null,
		dbtTags: [],
		promotedModelPath: partial.promotedModelPath ?? null,
		promotedSeedPath: null,
		dbtTestStatus: 'idle',
		dbtTestResults: [],
		dbtTestLog: [],
		scheduleEnabled: false,
		scheduleIntervalMinutes: 60,
		scheduleScope: 'cell',
		scheduleStatus: 'idle',
		scheduleLastRunAt: null,
		scheduleNextRunAt: null,
		scheduleLastError: null,
		intelligence: null,
		needsRun: false,
		staleReason: null,
		staleSources: [],
		lastRunAt: null,
		hideResult: partial.hideResult ?? false,
		hideInReport: partial.hideInReport ?? false,
		executionCount: partial.executionCount ?? 0
	};
}

describe('slugifyHeading', () => {
	it('slugifies basic headings', () => {
		expect(slugifyHeading('Hello World')).toBe('hello-world');
		expect(slugifyHeading('  Sales & Revenue!  ')).toBe('sales-revenue');
	});
});

describe('headingAnchorId', () => {
	it('prefixes with cell id', () => {
		expect(headingAnchorId('abc', 'Overview')).toBe('abc--overview');
	});
});

describe('buildNotebookOutline', () => {
	it('returns empty for empty notebook', () => {
		expect(buildNotebookOutline([])).toEqual([]);
	});

	it('parses nested markdown headings', () => {
		const cells = [
			makeCell({
				id: 'md1',
				cellType: 'markdown',
				markdown: '# Intro\n\n## Setup\n\n### Details'
			})
		];
		const outline = buildNotebookOutline(cells);
		expect(outline).toHaveLength(3);
		expect(outline[0]).toMatchObject({ kind: 'heading', level: 1, label: 'Intro' });
		expect(outline[1]).toMatchObject({ kind: 'heading', level: 2, label: 'Setup' });
		expect(outline[2]).toMatchObject({ kind: 'heading', level: 3, label: 'Details' });
	});

	it('dedupes duplicate heading slugs', () => {
		const cells = [
			makeCell({
				id: 'md1',
				cellType: 'markdown',
				markdown: '# Overview\n\n# Overview'
			})
		];
		const outline = buildNotebookOutline(cells);
		expect(outline).toHaveLength(2);
		expect(outline[0].id).toBe('md1--overview');
		expect(outline[1].id).toBe('md1--overview-2');
	});

	it('includes named query cells', () => {
		const cells = [
			makeCell({ id: 'q1', cellType: 'query', outputName: 'orders_clean' }),
			makeCell({ id: 'md1', cellType: 'markdown', markdown: '# Report' })
		];
		const outline = buildNotebookOutline(cells);
		expect(outline.some((e) => e.kind === 'cell' && e.label === 'orders_clean')).toBe(true);
		expect(outline.some((e) => e.label === 'Report')).toBe(true);
	});

	it('skips promoted cells and unnamed cells', () => {
		const cells = [
			makeCell({ id: 'q1', cellType: 'query', outputName: '', promotedModelPath: null }),
			makeCell({
				id: 'q2',
				cellType: 'query',
				outputName: 'promoted',
				promotedModelPath: 'models/foo.sql'
			})
		];
		expect(buildNotebookOutline(cells)).toEqual([]);
	});
});

describe('textFromMarkdocChildren', () => {
	it('concatenates string children', () => {
		expect(textFromMarkdocChildren(['Hello ', 'World'])).toBe('Hello World');
	});
});
