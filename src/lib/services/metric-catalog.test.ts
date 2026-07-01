import { describe, expect, it } from 'vitest';
import { buildMetricCatalog, filterCatalog } from './metric-catalog';
import type { Cell } from '$lib/stores/notebook.svelte';

function queryCell(outputName: string, columns: string[], row: Record<string, unknown>): Cell {
	return {
		id: 'c1',
		cellType: 'query',
		outputName,
		result: { rows: [row], columns },
		code: '',
		markdown: '',
		markdownPreview: false,
		connectionId: 'builtin.duckdb',
		language: 'sql',
		status: 'success',
		errors: [],
		compiledSQL: null,
		executionMs: 1,
		guiStages: [],
		editMode: 'prql',
		resultViewMode: 'table',
		resultChartConfig: null,
		display: 'full',
		stageResultsCollapsed: [],
		materializeMode: 'ephemeral',
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
		udfBody: '',
		pythonOutput: null
	} as unknown as Cell;
}

describe('metric-catalog', () => {
	it('lists numeric fields from query results', () => {
		const entries = buildMetricCatalog([
			queryCell('orders', ['revenue', 'region'], { revenue: 100, region: 'North' })
		]);
		expect(entries.some((e) => e.ref === '$orders.revenue' && e.kind === 'numeric')).toBe(true);
		expect(filterCatalog(entries, 'rev')[0]?.field).toBe('revenue');
	});
});
