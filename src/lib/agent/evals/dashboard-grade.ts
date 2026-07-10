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
		/** A markdown heading (title or "## Section") — signals the report has narrative
		 * structure rather than being a flat wall of blocks. */
		hasHeading: boolean;
		/** One dominant display numeral (metric size="hero") — visual hierarchy, not a flat tile wall. */
		hasHeroMetric: boolean;
		/** Stat-rail line items (metric layout="row") — infographic-style icon·label·value lists. */
		hasRowMetrics: boolean;
		/** Any allowlisted icon= on metric/card/callout. */
		hasIcon: boolean;
		/** Pictogram/waffle display (metric iconCount=). */
		hasPictogram: boolean;
		/** Asymmetric layout: a columns width= or a grid item span= — varied sizing, not uniform tiles. */
		hasAsymmetry: boolean;
		/** ≥2 "## Section" headers — the report is sectioned like a designed document. */
		hasSectionHeaders: boolean;
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

/** Minimal query cells so markdoc validators see known outputNames.
 *
 * `columnsByOutputName`, when given, supplies each cell's REAL result column names (the
 * server only ever receives column names from the client, never row values — see
 * AIChatCell.resultColumns). Without it, every stub falls back to the generic MOCK_ROW shape,
 * which would make any real, non-demo column (e.g. `distinct_companies`) look "undefined" to
 * Markdoc's variable resolution even though it genuinely exists. */
export function stubCellsForRefs(
	outputNames: Iterable<string>,
	columnsByOutputName?: Map<string, string[]>
): Cell[] {
	return [...outputNames].map((outputName) => {
		const realColumns = columnsByOutputName?.get(outputName);
		const row =
			realColumns && realColumns.length > 0
				? Object.fromEntries(realColumns.map((col) => [col, MOCK_ROW[col] ?? 1]))
				: MOCK_ROW;
		return {
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
				rows: [row, row],
				columns: Object.keys(row)
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
			columnWidths: {},
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
		};
	});
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

/** Critical failures only — used to block tool calls server-side.
 *
 * `columnsByOutputName`, when given, supplies each cell's REAL result column names (keyed
 * case-insensitively, since `knownOutputNames` is lowercased by some callers — chat-tool-
 * policy.ts — but not others — gradeDashboard's eval path). Without it, validation falls back
 * to `stubCellsForRefs`'s generic MOCK_ROW shape, which would flag any real, non-demo column
 * (e.g. `distinct_companies`) as "undefined" even though it genuinely exists. */
export function getCriticalMarkdownFailures(
	markdown: string,
	knownOutputNames: Set<string>,
	chartedOutputNames?: Set<string>,
	columnsByOutputName?: Map<string, string[]>
): string[] {
	if (!markdown.trim()) return ['empty markdown'];
	const normalizedMarkdown = normalizeMarkdocFirstRowRefs(markdown);
	const failures: string[] = [];
	const lowercasedColumns = columnsByOutputName
		? new Map([...columnsByOutputName].map(([name, cols]) => [name.toLowerCase(), cols]))
		: undefined;
	const stubs = stubCellsForRefs(knownOutputNames, lowercasedColumns);

	// For known cells whose REAL columns we don't have (cell never run, or an older client that
	// only sent context-cell columns), the stub row is just MOCK_ROW — so any real column would
	// fail Markdoc's variable resolution as "undefined" even though we have no basis to judge
	// it. Make those stubs permissive structurally: graft every `$cell.path…` the markdown
	// actually references into the stub row (at any depth), so validation passes for exactly
	// the refs used while phantom cell roots still fail. Strictness applies only when the real
	// columns are known.
	const RESERVED_VAR_FIELDS = new Set(['rows', 'count', 'rowCount', 'columns', 'chartConfig']);
	const referencedPaths = [...normalizedMarkdown.matchAll(/\$([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)+)/g)];
	for (const stub of stubs) {
		if (lowercasedColumns?.get(stub.outputName.toLowerCase())?.length) continue;
		if (!stub.result?.rows?.length) continue;
		const row: Record<string, unknown> = { ...(stub.result.rows[0] as Record<string, unknown>) };
		for (const [, root, dottedPath] of referencedPaths) {
			if (root.toLowerCase() !== stub.outputName.toLowerCase()) continue;
			const segments = dottedPath.slice(1).split('.');
			if (RESERVED_VAR_FIELDS.has(segments[0])) continue;
			let cur = row;
			for (let i = 0; i < segments.length; i++) {
				const seg = segments[i];
				if (i === segments.length - 1) {
					if (!(seg in cur)) cur[seg] = 1;
				} else {
					if (typeof cur[seg] !== 'object' || cur[seg] === null) cur[seg] = {};
					cur = cur[seg] as Record<string, unknown>;
				}
			}
		}
		stub.result = { rows: [row, row], columns: Object.keys(row) };
	}

	for (const d of validateMarkdocMarkdown(normalizedMarkdown, stubs)) {
		failures.push(d.message);
	}

	// Only bare refs with an explicit `.field` access are unambiguous cell-reference intent —
	// a lone `$word` in prose (no dot) is just as likely a stray dollar sign in casual text,
	// so treating it as a hard failure produces false positives on ordinary narration.
	for (const ref of extractBareMarkdocRefRoots(normalizedMarkdown)) {
		const hasFieldAccess = new RegExp(
			`\\$${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[A-Za-z_]`
		).test(normalizedMarkdown);
		if (hasFieldAccess && !knownOutputNames.has(ref)) {
			failures.push(`Undefined variable: '${ref}'`);
		}
	}

	if (/\{%\s*\w+[^%]*\|[^%]*%\}/.test(normalizedMarkdown)) {
		failures.push('Pipe operator inside Markdoc tag (not supported)');
	}
	// Require FROM-with-an-identifier alongside SELECT so ordinary prose ("select a date
	// range", "we selected the top vendors") doesn't trip this — real embedded SQL has SELECT
	// and FROM <table> together, not FROM followed by an English determiner.
	if (
		/\bSELECT\b[\s\S]{0,300}?\bFROM\s+(?!(?:the|a|an|this|that|these|those|our|your|my|his|her|their)\b)[a-zA-Z_][\w.]*\b/i.test(
			normalizedMarkdown.replace(/\{%[^%]*%\}/g, '')
		)
	) {
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
		hasInteractive: /filterParam=|linkedFilter=|kind="relative-date"/.test(markdown),
		hasHeading: /^#{1,6}\s/m.test(markdown),
		hasHeroMetric: /size="hero"/.test(markdown),
		hasRowMetrics: /layout="row"/.test(markdown),
		hasIcon: /\bicon="/.test(markdown),
		hasPictogram: /\biconCount=/.test(markdown),
		hasAsymmetry: /\bwidth=|\bspan=/.test(markdown),
		hasSectionHeaders: (markdown.match(/^##\s/gm) ?? []).length >= 2
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
	// A dashboard with several distinct structural elements but no heading anywhere is a flat
	// wall of blocks with no narrative sectioning — composition quality, not tag inventory.
	const structuralElementCount = [
		structure.hasGrid,
		structure.hasTabs,
		structure.hasColumns,
		structure.hasDatatable,
		structure.hasCallout
	].filter(Boolean).length;
	if (structuralElementCount >= 2 && !structure.hasHeading) {
		warnings.push('Multiple structural elements but no heading — report reads as unsectioned');
	}

	// Visual hierarchy — the difference between an infographic and a generated form dump.
	const metricCount = (markdown.match(/\{%\s*metric\b/g) ?? []).length;
	if (metricCount >= 3 && !structure.hasHeroMetric) {
		warnings.push(
			'Flat KPI wall — no hero stat; promote the key figure to size="hero" and demote the rest to "compact"'
		);
	}
	if (structure.hasGrid && metricCount >= 4 && !structure.hasAsymmetry && !structure.hasRowMetrics) {
		warnings.push(
			'Uniform tile grid — use an asymmetric columns split (width=2 vs 1), span=, or a layout="row" stat rail to create hierarchy'
		);
	}

	const { errors: renderErrors } = renderMarkdocCell(markdown, renderCells);
	for (const e of renderErrors) failures.push(`Render: ${e}`);

	// Bonuses are intentionally small and capped — presence of a tag type is not itself a
	// quality signal (a flat wall of grid+tabs+filter used to score highest here, which
	// rewarded inventory over composition). Structure (hasHeading) carries the largest bonus.
	let score = 100;
	score -= failures.length * 15;
	score -= warnings.length * 5;
	if (structure.hasHeading) score += 8;
	if (structure.hasGrid) score += 3;
	if (structure.hasMetric) score += 3;
	if (structure.hasChart) score += 3;
	if (structure.hasTabs) score += 3;
	if (structure.hasFilter) score += 4;
	if (structure.hasProgress) score += 3;
	if (structure.hasDatatable) score += 3;
	if (structure.hasCallout) score += 3;
	if (structure.hasConditional) score += 3;
	if (structure.hasInteractive) score += 4;
	// Hierarchy bonuses — composition quality, kept below hasHeading's +8.
	if (structure.hasHeroMetric) score += 5;
	if (structure.hasAsymmetry) score += 4;
	if (structure.hasSectionHeaders) score += 3;
	if (structure.hasRowMetrics) score += 2;
	if (structure.hasIcon) score += 2;
	if (structure.hasPictogram) score += 2;

	return {
		score: Math.max(0, Math.min(100, score)),
		failures: [...new Set(failures)],
		warnings: [...new Set(warnings)],
		structure
	};
}
