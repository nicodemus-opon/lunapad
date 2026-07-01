import type { Cell, CellLanguage } from '$lib/stores/notebook.svelte';
import type { ChartConfig, GUIPipelineStage } from '$lib/types/gui-pipeline';

function makeId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function makeDemoCell(
	code = '',
	outputName = '',
	language: CellLanguage = 'prql',
	overrides: Partial<Cell> = {}
): Cell {
	return {
		id: makeId(),
		cellType: 'query',
		connectionId: null,
		outputName,
		code,
		markdown: '',
		markdownPreview: false,
		udfBody: '',
		language,
		status: 'idle',
		result: null,
		pythonOutput: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: [{ type: 'from', table: '' }] as GUIPipelineStage[],
		editMode: language === 'sql' ? 'prql' : 'gui',
		resultViewMode: 'table',
		resultChartConfig: null,
		display: 'full',
		stageResultsCollapsed: [],
		materializeMode: 'table',
		materializeTarget: outputName,
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description: null,
		dbtSchema: null,
		dbtTags: [],
		promotedModelPath: null,
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
		hideResult: false,
		executionCount: 0,
		...overrides
	};
}

export function makeDemoMarkdownCell(markdown = '', overrides: Partial<Cell> = {}): Cell {
	return {
		...makeDemoCell('', ''),
		cellType: 'markdown',
		markdown,
		markdownPreview: false,
		editMode: 'prql',
		...overrides
	};
}

export function makeDemoId(): string {
	return makeId();
}

export type { ChartConfig };
