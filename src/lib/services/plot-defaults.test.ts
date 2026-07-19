import { describe, expect, it } from 'vitest';
import type { Cell } from '$lib/stores/notebook.svelte';
import { runPlotCode, buildPlotScope } from './plot-cell';
import {
	findPlotSourceCell,
	buildPlotDefaults,
	chartConfigToPlotCode,
	type PlotStarterKind
} from './plot-defaults';

function makeCell(partial: Partial<Cell> & Pick<Cell, 'id' | 'cellType' | 'outputName'>): Cell {
	return {
		connectionId: null,
		code: '',
		markdown: '',
		markdownPreview: false,
		markdownEditMode: 'source',
		udfBody: '',
		language: 'prql',
		status: 'idle',
		result: null,
		pythonOutput: null,
		controlConfig: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: [],
		editMode: 'prql',
		resultViewMode: 'table',
		resultChartConfig: null,
		plotMode: 'code',
		plotConfig: null,
		plotSourceCellId: null,
		columnFormatRules: {},
		columnWidths: {},
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
		hideInReport: false,
		executionCount: 0,
		...partial
	};
}

const SAMPLE_ROWS = [
	{ month: 'Jan', revenue: 100 },
	{ month: 'Feb', revenue: 140 },
	{ month: 'Mar', revenue: 90 }
];
const SAMPLE_COLUMNS = ['month', 'revenue'];

function ranQueryCell(id = 'q1', outputName = 'monthly_revenue'): Cell {
	return makeCell({
		id,
		cellType: 'query',
		outputName,
		result: { rows: SAMPLE_ROWS, columns: SAMPLE_COLUMNS }
	});
}

describe('findPlotSourceCell', () => {
	it('returns the nearest preceding query/python cell', () => {
		const cells = [
			ranQueryCell('q1', 'first'),
			makeCell({ id: 'm1', cellType: 'markdown', outputName: '' }),
			ranQueryCell('q2', 'second')
		];
		expect(findPlotSourceCell(cells, 3)?.id).toBe('q2');
	});

	it('skips markdown/udf/plot cells and returns null with nothing upstream', () => {
		const cells = [makeCell({ id: 'm1', cellType: 'markdown', outputName: '' })];
		expect(findPlotSourceCell(cells, 1)).toBeNull();
	});
});

describe('buildPlotDefaults', () => {
	it('falls back to a code-mode sample when there is no source cell', () => {
		const defaults = buildPlotDefaults(null, 'auto');
		expect(defaults.plotMode).toBe('code');
		expect(defaults.plotConfig).toBeNull();
		const scope = buildPlotScope([]);
		expect(() => runPlotCode(defaults.code, scope)).not.toThrow();
		const result = runPlotCode(defaults.code, scope);
		expect(result.data.length).toBeGreaterThan(0);
	});

	it('falls back to a dynamic code-mode template when the source has not run yet', () => {
		const source = makeCell({ id: 'q1', cellType: 'query', outputName: 'my_query', result: null });
		const defaults = buildPlotDefaults(source, 'auto');
		expect(defaults.plotMode).toBe('code');
		expect(defaults.code).toContain('my_query');
		const scope = buildPlotScope([source]);
		const result = runPlotCode(defaults.code, scope);
		expect(result.data.length).toBeGreaterThan(0);
	});

	it('picks GUI mode with an inferred config when the source has run', () => {
		const source = ranQueryCell();
		const defaults = buildPlotDefaults(source, 'auto');
		expect(defaults.plotMode).toBe('gui');
		expect(defaults.plotSourceCellId).toBe(source.id);
		expect(defaults.plotConfig).not.toBeNull();
	});

	const kinds: PlotStarterKind[] = ['bar', 'line', 'scatter', 'pie', 'area'];
	for (const kind of kinds) {
		it(`forces chartType=${kind} when an explicit kind is requested`, () => {
			const source = ranQueryCell();
			const defaults = buildPlotDefaults(source, kind);
			expect(defaults.plotMode).toBe('gui');
			expect(defaults.plotConfig?.chartType).toBe(kind);
		});
	}
});

describe('chartConfigToPlotCode', () => {
	const scope = buildPlotScope([ranQueryCell('q1', 'monthly_revenue')]);

	it('produces a bar trace for chartType=bar', () => {
		const code = chartConfigToPlotCode(
			{ chartType: 'bar', xColumn: 'month', yColumns: ['revenue'], colorColumn: null },
			'monthly_revenue'
		);
		const result = runPlotCode(code, scope);
		expect(result.data[0].type).toBe('bar');
	});

	it('produces a lines-mode scatter trace for chartType=line', () => {
		const code = chartConfigToPlotCode(
			{ chartType: 'line', xColumn: 'month', yColumns: ['revenue'], colorColumn: null },
			'monthly_revenue'
		);
		const result = runPlotCode(code, scope);
		expect(result.data[0].type).toBe('scatter');
		expect((result.data[0] as { mode?: string }).mode).toBe('lines');
	});

	it('produces a pie trace with per-slice theme colors for chartType=pie', () => {
		const code = chartConfigToPlotCode(
			{ chartType: 'pie', xColumn: 'month', yColumns: ['revenue'], colorColumn: null },
			'monthly_revenue'
		);
		const result = runPlotCode(code, scope);
		expect(result.data[0].type).toBe('pie');
		const marker = (result.data[0] as { marker?: { colors?: string[] } }).marker;
		expect(marker?.colors?.every((c) => c.startsWith('var(--chart-'))).toBe(true);
	});

	it('falls back to a bar chart with a comment for an untranslatable chartType', () => {
		const code = chartConfigToPlotCode(
			{ chartType: 'sankey', xColumn: 'month', yColumns: ['revenue'], colorColumn: null },
			'monthly_revenue'
		);
		expect(code).toContain("couldn't be fully translated");
		const result = runPlotCode(code, scope);
		expect(result.data[0].type).toBe('bar');
	});
});
