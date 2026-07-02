import type { Cell } from '$lib/stores/notebook.svelte';
import { detectHardcodedContent } from '$lib/services/markdown-lint.js';
import {
	extractBareMarkdocRefRoots,
	renderMarkdocCell,
	validateMarkdocMarkdown
} from '$lib/services/markdoc-interp.js';

export interface DashboardGrade {
	score: number;
	failures: string[];
	warnings: string[];
	structure: {
		hasGrid: boolean;
		hasMetric: boolean;
		hasChart: boolean;
		hasTabs: boolean;
		hasColumns: boolean;
		hasFilter: boolean;
		hasProgress: boolean;
		hasDatatable: boolean;
		hasCallout: boolean;
		hasConditional: boolean;
		hasInteractive: boolean;
	};
}

const MOCK_ROW: Record<string, unknown> = {
	placeholder: 1,
	count: 2000,
	total_revenue: 125000,
	attainment_pct: 92,
	quota: 150000,
	month: '2024-01-01',
	region: 'North',
	product: 'Laptop',
	units_sold: 42,
	order_count: 100,
	category: 'Electronics'
};

/** Minimal query cells so markdoc validators see known outputNames. */
export function stubCellsForRefs(outputNames: Iterable<string>): Cell[] {
	return [...outputNames].map((outputName) => ({
		id: `stub-${outputName}`,
		cellType: 'query' as const,
		connectionId: 'builtin.duckdb',
		outputName,
		code: '',
		markdown: '',
		markdownPreview: false,
		markdownEditMode: 'source' as const,
		udfBody: '',
		language: 'sql' as const,
		status: 'success' as const,
		result: {
			rows: [MOCK_ROW, { ...MOCK_ROW, region: 'South', product: 'Phone' }],
			columns: Object.keys(MOCK_ROW)
		},
		pythonOutput: null,
		errors: [],
		compiledSQL: null,
		executionMs: 1,
		guiStages: [],
		editMode: 'prql' as const,
		resultViewMode: 'table' as const,
		resultChartConfig: null,
		display: 'full' as const,
		stageResultsCollapsed: [],
		materializeMode: 'ephemeral' as const,
		materializeTarget: '',
		materializeStatus: 'idle' as const,
		materializeError: null,
		materializedRelationType: null,
		description: null,
		dbtSchema: null,
		dbtTags: [],
		promotedModelPath: null,
		promotedSeedPath: null,
		dbtTestStatus: 'idle' as const,
		dbtTestResults: [],
		dbtTestLog: [],
		scheduleEnabled: false,
		scheduleIntervalMinutes: 60,
		scheduleScope: 'cell' as const,
		scheduleStatus: 'idle' as const,
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
		executionCount: 0
	}));
}

function cellsWithResults(cells: Cell[]): Cell[] {
	const names = cells
		.filter((c) => c.cellType === 'query' && c.outputName)
		.map((c) => c.outputName);
	const stubs = new Map(stubCellsForRefs(names).map((c) => [c.outputName, c]));
	return cells.map((c) => {
		if (c.cellType !== 'query' || !c.outputName) return c;
		if (c.result?.rows?.length) return c;
		return stubs.get(c.outputName) ?? c;
	});
}

/** Critical failures only — used to block tool calls server-side. */
export function getCriticalMarkdownFailures(
	markdown: string,
	knownOutputNames: Set<string>
): string[] {
	if (!markdown.trim()) return ['empty markdown'];
	const failures: string[] = [];
	const stubs = stubCellsForRefs(knownOutputNames);

	for (const d of validateMarkdocMarkdown(markdown, stubs)) {
		failures.push(d.message);
	}

	for (const ref of extractBareMarkdocRefRoots(markdown)) {
		if (!knownOutputNames.has(ref)) {
			failures.push(`Undefined variable: '${ref}'`);
		}
	}

	if (/\{%\s*\w+[^%]*\|[^%]*%\}/.test(markdown)) {
		failures.push('Pipe operator inside Markdoc tag (not supported)');
	}
	if (/\bSELECT\b/i.test(markdown.replace(/\{%[^%]*%\}/g, ''))) {
		failures.push('Raw SQL in markdown body');
	}
	if (/create_dashboard|add_dashboard_block/i.test(markdown)) {
		failures.push('Obsolete create_dashboard API referenced');
	}
	if (/\$cell\b/.test(markdown)) {
		failures.push(
			'Placeholder $cell ref — use real outputName (e.g. $region_performance.total_revenue)'
		);
	}
	if (/\$stg_[a-z0-9_]+/i.test(markdown)) {
		failures.push('stg_ cells are not reporting-ready — build a mart model first');
	}

	return [...new Set(failures)];
}

function scoreStructure(markdown: string): DashboardGrade['structure'] {
	return {
		hasGrid: /\{%\s*grid\b/.test(markdown),
		hasMetric: /\{%\s*metric\b/.test(markdown),
		hasChart: /\{%\s*chart\b/.test(markdown),
		hasTabs: /\{%\s*tabs\b/.test(markdown),
		hasColumns: /\{%\s*columns\b/.test(markdown),
		hasFilter: /\{%\s*filter\b/.test(markdown),
		hasProgress: /\{%\s*progress\b/.test(markdown),
		hasDatatable: /\{%\s*datatable\b/.test(markdown),
		hasCallout: /\{%\s*callout\b/.test(markdown),
		hasConditional: /\{%\s*if\b/.test(markdown),
		hasInteractive: /filterParam=|linkedFilter=|kind="relative-date"/.test(markdown)
	};
}

export function gradeDashboard(markdown: string, cells: Cell[]): DashboardGrade {
	const failures: string[] = [];
	const warnings: string[] = [];
	const renderCells = cellsWithResults(cells);
	const known = new Set(
		renderCells.filter((c) => c.cellType === 'query' && c.outputName).map((c) => c.outputName)
	);

	failures.push(...getCriticalMarkdownFailures(markdown, known));

	const hardcoded = detectHardcodedContent(markdown, renderCells);
	if (hardcoded) failures.push(hardcoded);

	if (
		/\{%\s*percent\s*\(\s*\$[a-z0-9_]+\s*,/i.test(markdown) &&
		!/\*\s*100|pct_of|_pct\b/i.test(markdown)
	) {
		warnings.push('percent() used — ensure value is already on 0–100 scale');
	}

	const structure = scoreStructure(markdown);
	if (!structure.hasGrid && !structure.hasTabs && !structure.hasColumns) {
		warnings.push('No layout container (grid, tabs, or columns)');
	}
	if (!structure.hasMetric && !structure.hasChart && !structure.hasDatatable) {
		failures.push('No data widgets (metric, chart, or datatable)');
	}

	const { errors: renderErrors } = renderMarkdocCell(markdown, renderCells);
	for (const e of renderErrors) failures.push(`Render: ${e}`);

	let score = 100;
	score -= failures.length * 15;
	score -= warnings.length * 5;
	if (structure.hasGrid) score += 5;
	if (structure.hasMetric) score += 5;
	if (structure.hasChart) score += 5;
	if (structure.hasTabs) score += 8;
	if (structure.hasFilter) score += 8;
	if (structure.hasProgress) score += 5;
	if (structure.hasDatatable) score += 5;
	if (structure.hasCallout) score += 4;
	if (structure.hasConditional) score += 4;
	if (structure.hasInteractive) score += 6;

	return {
		score: Math.max(0, Math.min(100, score)),
		failures: [...new Set(failures)],
		warnings: [...new Set(warnings)],
		structure
	};
}
