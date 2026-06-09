/**
 * Heuristics for pre-filling chip values when adding new chips to pipeline stages.
 * Uses column name patterns to make smart guesses without requiring schema type info.
 */
import type { AggFunc, AggregationRow, FilterCondition, FilterOp, GUIPipelineStage } from '$lib/types/gui-pipeline';

// ── Column-picking heuristics ─────────────────────────────────────────────────

function firstUnused(available: string[], used: string[]): string {
	return available.find((c) => !used.includes(c)) ?? available[0] ?? '';
}

function matchesPattern(col: string, patterns: RegExp[]): boolean {
	return patterns.some((p) => p.test(col));
}

const DATE_PATTERNS = [/date|time|created|updated|_at$|at$/i, /year|month|day|hour|week|period/i];
const NUMERIC_PATTERNS = [/amount|total|price|revenue|cost|income|value|score|rank|count|sum|avg|balance|qty|quantity/i, /^(n|num|cnt)_/i];
const CATEGORICAL_PATTERNS = [/name|type|category|status|label|tag|group|class|region|country|city|department/i];
const ID_PATTERNS = [/^id$|_id$|^pk$|^key$/i];

function findByPattern(candidates: string[], patterns: RegExp[]): string | undefined {
	return candidates.find((c) => matchesPattern(c, patterns));
}

// ── Per-stage defaults ─────────────────────────────────────────────────────────

/** Best column for SELECT (first unselected, in schema order) */
export function pickSelectColumn(available: string[], existing: string[]): string {
	return firstUnused(available, existing);
}

/** Best column for SORT (prefer date > numeric > first unused) */
export function pickSortColumn(available: string[], existingCols: string[]): string {
	const unused = available.filter((c) => !existingCols.includes(c));
	const candidates = unused.length > 0 ? unused : available;
	return (
		findByPattern(candidates, DATE_PATTERNS) ??
		findByPattern(candidates, NUMERIC_PATTERNS) ??
		candidates[0] ??
		''
	);
}

/** Best column for GROUP BY (prefer categorical > non-id > first unused) */
export function pickGroupByColumn(available: string[], existing: string[]): string {
	const unused = available.filter((c) => !existing.includes(c));
	const candidates = unused.length > 0 ? unused : available;
	return (
		findByPattern(candidates, CATEGORICAL_PATTERNS) ??
		candidates.find((c) => !matchesPattern(c, ID_PATTERNS)) ??
		candidates[0] ??
		''
	);
}

/** Best default aggregation (func + column) */
export function pickDefaultAgg(available: string[], existing: AggregationRow[]): AggregationRow {
	const usedCols = existing.map((a) => a.column).filter(Boolean);
	const unused = available.filter((c) => !usedCols.includes(c));
	const candidates = unused.length > 0 ? unused : available;

	const numCol = findByPattern(candidates, NUMERIC_PATTERNS);
	if (numCol) return { name: '', func: 'sum', column: numCol };

	// count() doesn't need a column
	if (candidates.length === 0 || existing.some((a) => a.func !== 'count')) {
		return { name: '', func: 'count', column: '' };
	}

	return { name: '', func: 'sum', column: candidates[0] ?? '' };
}

/** Best default filter condition */
export function pickDefaultFilter(available: string[], existing: FilterCondition[]): { column: string; op: FilterOp; value: string } {
	const usedCols = existing.map((c) => c.column).filter(Boolean);
	const unused = available.filter((c) => !usedCols.includes(c));
	const candidates = unused.length > 0 ? unused : available;

	// Prefer date columns with >=, numeric with >=, categorical with ==
	const dateCol = findByPattern(candidates, DATE_PATTERNS);
	if (dateCol) return { column: dateCol, op: '>=', value: '' };

	const numCol = findByPattern(candidates, NUMERIC_PATTERNS);
	if (numCol) return { column: numCol, op: '>=', value: '' };

	return { column: candidates[0] ?? available[0] ?? '', op: '==', value: '' };
}

/** Best left-operand column for DERIVE (prefer numeric for binary arithmetic, then date) */
export function pickDeriveColumn(available: string[]): string {
	return (
		findByPattern(available, NUMERIC_PATTERNS) ??
		findByPattern(available, DATE_PATTERNS) ??
		available[0] ??
		''
	);
}

/** Best sort direction given a column name */
export function pickSortDir(col: string): 'asc' | 'desc' {
	// Numeric/rank columns often want descending (biggest first)
	if (matchesPattern(col, NUMERIC_PATTERNS)) return 'desc';
	return 'asc';
}

/** Best column for JOIN ON condition */
export function pickJoinColumn(available: string[]): string {
	// Prefer ID-like columns for join keys
	return (
		findByPattern(available, ID_PATTERNS) ??
		available.find((c) => matchesPattern(c, [/^id|_id$/i])) ??
		available[0] ??
		''
	);
}

/**
 * Create a pre-filled stage for the insert-after zone using column intelligence.
 * Only covers the five types shown in the insert zone.
 */
export function makeIntelligentDefaultStage(
	type: 'filter' | 'select' | 'derive' | 'sort' | 'group',
	availableColumns: string[]
): GUIPipelineStage {
	switch (type) {
		case 'filter': {
			const s = pickDefaultFilter(availableColumns, []);
			return { type: 'filter', logic: 'and', conditions: [{ column: s.column, op: s.op, value: s.value }] };
		}
		case 'select':
			return { type: 'select', columns: [] };
		case 'derive': {
			const leftCol = pickDeriveColumn(availableColumns);
			const name = leftCol ? `new_${leftCol}` : 'new_col';
			return {
				type: 'derive',
				columns: [{
					name,
					expr: { mode: 'binary', left: { kind: 'column', value: leftCol }, op: '+', right: { kind: 'literal', value: '0' } }
				}]
			};
		}
		case 'sort': {
			const col = pickSortColumn(availableColumns, []);
			return { type: 'sort', keys: col ? [{ column: col, dir: pickSortDir(col) }] : [] };
		}
		case 'group': {
			const agg = pickDefaultAgg(availableColumns, []);
			const byCol = pickGroupByColumn(availableColumns, []);
			return {
				type: 'group',
				by: byCol ? [byCol] : [],
				aggregations: [{ name: '', func: agg.func, column: agg.column }]
			};
		}
	}
}
