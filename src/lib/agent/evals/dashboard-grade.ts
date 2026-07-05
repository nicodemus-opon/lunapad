import Markdoc from '@markdoc/markdoc';
import type { Cell } from '$lib/stores/notebook.svelte';
import { detectHardcodedContent } from '$lib/services/markdown-lint.js';
import {
	extractBareMarkdocRefRoots,
	normalizeMarkdocFirstRowRefs,
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
		columnFormatRules: {},
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
		.filter((c) => (c.cellType === 'query' || c.cellType === 'python') && c.outputName)
		.map((c) => c.outputName);
	const stubs = new Map(stubCellsForRefs(names).map((c) => [c.outputName, c]));
	return cells.map((c) => {
		if ((c.cellType !== 'query' && c.cellType !== 'python') || !c.outputName) return c;
		if (c.result?.rows?.length) return c;
		return stubs.get(c.outputName) ?? c;
	});
}

/** Critical failures only — used to block tool calls server-side. */
export function getCriticalMarkdownFailures(
	markdown: string,
	knownOutputNames: Set<string>,
	chartedOutputNames?: Set<string>
): string[] {
	if (!markdown.trim()) return ['empty markdown'];
	const normalizedMarkdown = normalizeMarkdocFirstRowRefs(markdown);
	const failures: string[] = [];
	const stubs = stubCellsForRefs(knownOutputNames);

	for (const d of validateMarkdocMarkdown(normalizedMarkdown, stubs)) {
		failures.push(d.message);
	}

	for (const ref of extractBareMarkdocRefRoots(normalizedMarkdown)) {
		if (!knownOutputNames.has(ref)) {
			failures.push(`Undefined variable: '${ref}'`);
		}
	}

	if (/\{%\s*\w+[^%]*\|[^%]*%\}/.test(normalizedMarkdown)) {
		failures.push('Pipe operator inside Markdoc tag (not supported)');
	}
	if (/\bSELECT\b/i.test(normalizedMarkdown.replace(/\{%[^%]*%\}/g, ''))) {
		failures.push('Raw SQL in markdown body');
	}
	if (/create_dashboard|add_dashboard_block/i.test(normalizedMarkdown)) {
		failures.push('Obsolete create_dashboard API referenced');
	}
	if (/\$cell\b/.test(normalizedMarkdown)) {
		failures.push(
			'Placeholder $cell ref — use real outputName (e.g. $region_performance.total_revenue)'
		);
	}
	if (/\$stg_[a-z0-9_]+/i.test(normalizedMarkdown)) {
		failures.push('stg_ cells are not reporting-ready — build a mart model first');
	}

	for (const chartFailure of getChartAxisFailures(normalizedMarkdown, chartedOutputNames)) {
		failures.push(chartFailure);
	}

	return [...new Set(failures)];
}

/**
 * `ref=$cellName` supplies a base config (data + x/y) automatically, so axis attrs are
 * optional there. Without `ref=`, chart types split into three groups: 'big-value'/'value'/
 * 'delta' read a single value column via `x=`; axis charts (bar/line/etc.) need both `x=`
 * and `y=`/`yColumns=`; 'table'/'custom' need neither. Catching a missing `x=` here — instead
 * of letting the cell render with an unset xColumn — is what stops the "Set x and y columns
 * to preview chart" placeholder from silently shipping in AI-authored dashboards.
 */
const CHART_VALUE_COLUMN_TYPES = new Set(['big-value', 'value', 'delta']);
const CHART_AXIS_TYPES = new Set([
	'sparkline',
	'line',
	'bar',
	'bar-horizontal',
	'area',
	'scatter',
	'bubble',
	'histogram',
	'heatmap',
	'calendar-heatmap',
	'funnel',
	'box-plot',
	'sankey'
]);

/**
 * Walks the real Markdoc AST rather than regex-matching tag source text: a text-based
 * `{%...%}` regex truncates at the first literal `%` inside a quoted attribute value
 * (e.g. `title="50% growth"`), and can't tell a real `x=` attribute from the substring
 * "x=" appearing inside some other attribute's string value. Node.attributes gives the
 * actual parsed key/value map regardless of quoting or escaping.
 */
function isMarkdocVariable(value: unknown): value is { path: unknown[] } {
	return (
		!!value &&
		typeof value === 'object' &&
		(value as { $$mdtype?: string }).$$mdtype === 'Variable' &&
		Array.isArray((value as { path?: unknown }).path)
	);
}

/**
 * `chartedOutputNames` is the set of cells whose OWN chart already has an xColumn (i.e. it
 * has actually been configured, e.g. via pick_chart) — the real thing `ref=$cellName`
 * inherits (see `chartConfig: cell.resultChartConfig ?? null` in markdoc-interp.ts). A
 * freshly created query/python cell that has never been charted contributes an EMPTY base
 * config, so `ref=$freshCell` alone still renders the "Set x and y columns" placeholder even
 * though the markdown looks correct. When `chartedOutputNames` is omitted (eval/test callers
 * that don't track live per-cell chart state), ref targets are assumed charted — permissive,
 * matching the previous behavior.
 */
function getChartAxisFailures(markdown: string, chartedOutputNames?: Set<string>): string[] {
	const failures: string[] = [];
	if (!markdown.includes('{%')) return failures;
	const ast = Markdoc.parse(markdown);
	for (const node of ast.walk()) {
		if (node.type !== 'tag' || node.tag !== 'chart') continue;
		const attrs = node.attributes as Record<string, unknown>;
		// ChartWidget.svelte defaults chartType to 'bar' when `type=` is omitted, so an
		// untyped chart still needs axis columns — it is not the same as `type="table"`.
		const type = typeof attrs.type === 'string' ? attrs.type : 'bar';
		const hasX = 'x' in attrs;
		const hasY = 'y' in attrs || 'yColumns' in attrs;
		const hasCode = 'code' in attrs;

		const refPath = isMarkdocVariable(attrs.ref) ? attrs.ref.path : null;
		const refName = refPath && typeof refPath[0] === 'string' ? refPath[0] : null;
		if (refName) {
			const refIsCharted = chartedOutputNames?.has(refName.toLowerCase()) ?? true;
			if (refIsCharted) continue;
			if (CHART_VALUE_COLUMN_TYPES.has(type) && hasX) continue;
			if (CHART_AXIS_TYPES.has(type) && hasX && hasY) continue;
			if (type === 'custom' && hasCode) continue;
			if (!CHART_VALUE_COLUMN_TYPES.has(type) && !CHART_AXIS_TYPES.has(type) && type !== 'custom') {
				continue; // 'table' etc. need no axis columns regardless of ref state
			}
			failures.push(
				`chart ref=$${refName} has no chart configured yet on $${refName} itself (never charted) — call pick_chart on $${refName} first, or pass x=/y=/code= overrides directly on this chart tag instead of relying on ref=`
			);
			continue;
		}

		if (CHART_VALUE_COLUMN_TYPES.has(type) && !hasX) {
			failures.push(
				`chart type="${type}" needs x= (the value column) or ref=$cellName — otherwise it renders empty`
			);
		} else if (CHART_AXIS_TYPES.has(type) && (!hasX || !hasY)) {
			failures.push(
				`chart type="${type}" needs both x= and y=/yColumns= or ref=$cellName — otherwise it renders empty`
			);
		} else if (type === 'custom' && !hasCode) {
			failures.push(
				`chart type="custom" needs a code= string (or ref=$cellName pointing at a cell with one) — otherwise it renders empty`
			);
		}
	}
	return failures;
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
