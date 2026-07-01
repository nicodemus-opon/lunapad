import type { GUIPipelineStage, StageType } from '$lib/types/gui-pipeline';
import type { PRQLStageError } from '$lib/services/gui-prql';

export type StageEvidenceState =
	| { kind: 'idle' }
	| { kind: 'loading' }
	| { kind: 'result'; rows: Record<string, unknown>[]; columns: string[] }
	| { kind: 'error'; message: string };

export type StageInsightTone = 'info' | 'warn';

export interface StageQualityInsight {
	id: string;
	tone: StageInsightTone;
	label: string;
	detail: string;
}

export interface StageRecommendation {
	type: Exclude<StageType, 'raw'>;
	reason: string;
	stage: Exclude<GUIPipelineStage, { type: 'raw' }>;
}

export interface StageErrorPresentation {
	reason: string;
	hint: string | null;
	lineLabel: string | null;
	display: string | null;
}

function inferErrorHint(stage: GUIPipelineStage, error: PRQLStageError): string {
	const haystack = `${error.reason} ${error.hint ?? ''} ${error.display ?? ''}`.toLowerCase();

	if (
		haystack.includes("can't find") ||
		haystack.includes('not found') ||
		haystack.includes('unknown')
	) {
		if (stage.type === 'from') {
			return 'Select an existing source table or use the schema-qualified name.';
		}
		if (stage.type === 'join') {
			return 'Check join table/alias and verify both join columns exist upstream.';
		}
		return 'Verify column names and ensure the field is produced by an earlier visible stage.';
	}

	if (stage.type === 'derive' && (haystack.includes('type') || haystack.includes('cast'))) {
		return 'Switch this expression to raw mode or cast literals to match the target column type.';
	}

	if (stage.type === 'filter' && haystack.includes('operator')) {
		return 'Choose a compatible operator for this value type, for example use like for text and >= for numbers.';
	}

	if (stage.type === 'group' && (haystack.includes('aggregate') || haystack.includes('group'))) {
		return 'Use grouped dimensions in by and move non-grouped columns into aggregation expressions.';
	}

	if (stage.type === 'sort' && haystack.includes('order')) {
		return 'Sort keys must exist in the current stage output. Add derive/select first if needed.';
	}

	if (stage.type === 'join' && (haystack.includes('ambiguous') || haystack.includes('duplicate'))) {
		return 'Set a join alias and reference right-side columns with that alias to avoid ambiguity.';
	}

	return 'Review this stage expression and upstream columns, then rerun evidence to confirm.';
}

function stageLineLabel(stage: GUIPipelineStage, error: PRQLStageError): string | null {
	if (error.stageLine === null || error.stageLine < 0) return null;

	if (stage.type === 'derive') {
		const named = stage.columns.filter((column) => column.name);
		if (named.length <= 1) {
			return 'derive expression';
		}
		const chipIdx = error.stageLine - 1;
		if (chipIdx >= 0 && chipIdx < named.length) {
			const chip = named[chipIdx]?.name;
			return chip ? `derive chip ${chip}` : `derive chip ${chipIdx + 1}`;
		}
	}

	return `stage line ${error.stageLine + 1}`;
}

export function presentStageErrors(
	stage: GUIPipelineStage,
	errors: PRQLStageError[]
): StageErrorPresentation[] {
	return errors.map((error) => {
		const fallbackHint = inferErrorHint(stage, error);
		const hint = error.hint?.trim() ? error.hint : fallbackHint;
		return {
			reason: error.reason,
			hint,
			lineLabel: stageLineLabel(stage, error),
			display: error.display ?? null
		};
	});
}

function isNumericLike(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value === 'string') {
		const parsed = Number(value.trim().replaceAll(',', ''));
		return Number.isFinite(parsed);
	}
	const parsed = Number(value);
	return Number.isFinite(parsed);
}

function isDateLike(value: unknown): boolean {
	if (value instanceof Date) return true;
	if (typeof value !== 'string') return false;
	return /^\d{4}-\d{2}-\d{2}/.test(value.trim());
}

function summarizeColumns(
	rows: Record<string, unknown>[],
	columns: string[]
): {
	numericColumns: string[];
	dateColumns: string[];
	textColumns: string[];
	boolColumns: string[];
	nullHeavyColumns: string[];
	highCardinalityColumns: string[];
} {
	const sample = rows.slice(0, 300);
	const numericColumns: string[] = [];
	const dateColumns: string[] = [];
	const textColumns: string[] = [];
	const boolColumns: string[] = [];
	const nullHeavyColumns: string[] = [];
	const highCardinalityColumns: string[] = [];

	for (const column of columns) {
		const values = sample.map((row) => row[column]);
		const nullCount = values.filter(
			(value) => value === null || value === undefined || value === ''
		).length;
		const present = values.filter((value) => value !== null && value !== undefined && value !== '');
		const numericHits = present.filter((value) => isNumericLike(value)).length;
		const dateHits = present.filter((value) => isDateLike(value)).length;
		const boolHits = present.filter((value) => typeof value === 'boolean').length;
		const distinctCount = new Set(present.map((value) => String(value))).size;

		if (present.length > 0 && boolHits / present.length >= 0.7) {
			boolColumns.push(column);
		} else if (present.length > 0 && numericHits / present.length >= 0.7) {
			numericColumns.push(column);
		} else if (present.length > 0 && dateHits / present.length >= 0.7) {
			dateColumns.push(column);
		} else {
			textColumns.push(column);
		}
		if (values.length > 0 && nullCount / values.length >= 0.4) nullHeavyColumns.push(column);
		if (present.length >= 20 && distinctCount / present.length >= 0.8)
			highCardinalityColumns.push(column);
	}

	return {
		numericColumns,
		dateColumns,
		textColumns,
		boolColumns,
		nullHeavyColumns,
		highCardinalityColumns
	};
}

function pickFilterPrefill(preview: Extract<StageEvidenceState, { kind: 'result' }>): {
	column: string;
	op: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'like' | 'is null' | 'is not null' | 'in' | 'not in';
	value: string;
} | null {
	const { numericColumns, dateColumns, textColumns, boolColumns } = summarizeColumns(
		preview.rows,
		preview.columns
	);

	const sampleValues = (column: string): unknown[] =>
		preview.rows
			.map((row) => row[column])
			.filter((value) => value !== null && value !== undefined && value !== '')
			.slice(0, 120);

	if (boolColumns.length > 0) {
		return { column: boolColumns[0], op: '==', value: 'true' };
	}

	if (numericColumns.length > 0) {
		const column = numericColumns[0];
		const numeric = sampleValues(column)
			.map((value) => Number(value))
			.filter((value) => Number.isFinite(value))
			.sort((a, b) => a - b);
		if (numeric.length > 0) {
			const mid = Math.floor(numeric.length / 2);
			const pivot = numeric[mid] ?? numeric[0] ?? 0;
			return { column, op: '>=', value: String(pivot) };
		}
	}

	if (dateColumns.length > 0) {
		const column = dateColumns[0];
		const values = sampleValues(column)
			.map((value) => String(value).trim())
			.sort();
		if (values.length > 0) {
			const mid = Math.floor(values.length / 2);
			return { column, op: '>=', value: values[mid] ?? values[0] ?? '' };
		}
	}

	if (textColumns.length > 0) {
		const column = textColumns[0];
		const values = sampleValues(column).map((value) => String(value));
		if (values.length > 0) {
			const counts = new Map<string, number>();
			for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
			const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? values[0] ?? '';
			return { column, op: '==', value: top };
		}
	}

	const fallback = preview.columns[0];
	if (!fallback) return null;
	return { column: fallback, op: '==', value: '' };
}

function pickJoinKey(columns: string[]): string | null {
	if (columns.length === 0) return null;
	const normalized = columns.map((column) => ({
		column,
		normalized: column.trim().toLowerCase()
	}));

	const exactPriority = ['id', 'uuid', 'key', 'pk'];
	for (const preferred of exactPriority) {
		const found = normalized.find((entry) => entry.normalized === preferred)?.column;
		if (found) return found;
	}

	const suffixPriority = ['_id', 'id'];
	for (const suffix of suffixPriority) {
		const found = normalized.find((entry) => entry.normalized.endsWith(suffix))?.column;
		if (found) return found;
	}

	const nameHints = ['customer', 'user', 'account', 'order', 'product', 'company'];
	for (const hint of nameHints) {
		const found = normalized.find((entry) => entry.normalized.includes(hint))?.column;
		if (found) return found;
	}

	return columns[0] ?? null;
}

function makeStageFromType(
	type: Exclude<StageType, 'raw'>,
	preview: StageEvidenceState
): Exclude<GUIPipelineStage, { type: 'raw' }> {
	if (preview.kind !== 'result') {
		switch (type) {
			case 'append':
				return { type: 'append', sources: [] };
			case 'filter':
				return { type: 'filter', conditions: [], logic: 'and' };
			case 'select':
				return { type: 'select', columns: [] };
			case 'derive':
				return { type: 'derive', columns: [] };
			case 'group':
				return { type: 'group', by: [], aggregations: [] };
			case 'window':
				return { type: 'window', frame: 'rows:-2..0', sortKeys: [], derives: [] };
			case 'loop':
				return { type: 'loop', body: 'filter true' };
			case 'sort':
				return { type: 'sort', keys: [] };
			case 'take':
				return { type: 'take', n: 100 };
			case 'join':
				return { type: 'join', joinType: 'inner', table: '', conditions: [] };
			case 'from':
				return { type: 'from', table: '' };
		}
	}

	const columns = preview.columns;
	const firstColumn = columns[0] ?? '';
	const firstValue = preview.rows[0]?.[firstColumn];
	const { numericColumns, dateColumns, textColumns } = summarizeColumns(
		preview.rows,
		preview.columns
	);
	const groupByColumn = textColumns[0] ?? dateColumns[0] ?? firstColumn;
	const metricColumn = numericColumns[0] ?? firstColumn;

	switch (type) {
		case 'append':
			return { type: 'append', sources: [] };
		case 'filter': {
			const inferred = pickFilterPrefill(preview);
			return {
				type: 'filter',
				logic: 'and',
				conditions: inferred
					? [{ column: inferred.column, op: inferred.op, value: inferred.value }]
					: firstColumn
						? [
								{
									column: firstColumn,
									op: '==',
									value:
										typeof firstValue === 'string' ||
										typeof firstValue === 'number' ||
										typeof firstValue === 'boolean'
											? String(firstValue)
											: ''
								}
							]
						: []
			};
		}
		case 'select':
			return { type: 'select', columns: columns.slice(0, Math.min(5, columns.length)) };
		case 'derive':
			return {
				type: 'derive',
				columns: metricColumn
					? [
							{
								name: `${metricColumn}_calc`,
								expr: {
									mode: 'binary',
									left: { kind: 'column', value: metricColumn },
									op: '+',
									right: { kind: 'literal', value: '0' }
								}
							}
						]
					: []
			};
		case 'group':
			return {
				type: 'group',
				by: groupByColumn ? [groupByColumn] : [],
				aggregations: metricColumn
					? [
							{
								name: `sum_${metricColumn}`,
								func: numericColumns.length > 0 ? 'sum' : 'count',
								column: metricColumn
							}
						]
					: []
			};
		case 'window': {
			const sortColumn = dateColumns[0] ?? numericColumns[0] ?? firstColumn;
			const metricColumn = numericColumns[0] ?? '';
			return {
				type: 'window',
				frame: 'rows:-2..0',
				sortKeys: sortColumn ? [{ column: sortColumn, dir: 'asc' }] : [],
				derives: metricColumn
					? [
							{
								name: `rolling_${metricColumn}`,
								expr: { mode: 'raw', expr: `average ${metricColumn}` }
							}
						]
					: []
			};
		}
		case 'loop':
			return { type: 'loop', body: 'filter true' };
		case 'sort':
			return {
				type: 'sort',
				keys: metricColumn
					? [{ column: metricColumn, dir: numericColumns.length > 0 ? 'desc' : 'asc' }]
					: []
			};
		case 'take':
			return { type: 'take', n: preview.rows.length > 1000 ? 200 : 100 };
		case 'join': {
			const joinKey = pickJoinKey(columns);
			return {
				type: 'join',
				joinType: 'inner',
				table: '',
				conditions: joinKey ? [{ left: joinKey, right: joinKey, shorthand: true }] : []
			};
		}
		case 'from':
			return { type: 'from', table: '' };
	}
}

export function getStageSummary(stage: GUIPipelineStage): string {
	switch (stage.type) {
		case 'from':
			return stage.table || 'no table';
		case 'select':
			return stage.columns.length === 0
				? 'all columns'
				: stage.columns.slice(0, 3).join(', ') +
						(stage.columns.length > 3 ? ` +${stage.columns.length - 3}` : '');
		case 'filter':
			return stage.conditions.length === 0
				? 'no conditions'
				: `${stage.conditions.length} condition${stage.conditions.length > 1 ? 's' : ''} (${stage.logic})`;
		case 'derive':
			return stage.columns.length === 0
				? 'no expressions'
				: stage.columns
						.slice(0, 2)
						.map((c) => c.name || '?')
						.join(', ') + (stage.columns.length > 2 ? ` +${stage.columns.length - 2}` : '');
		case 'group':
			return `by ${stage.by.slice(0, 2).join(', ') || 'none'}`;
		case 'sort':
			return stage.keys.length === 0
				? 'no keys'
				: stage.keys
						.slice(0, 2)
						.map((k) => `${k.dir === 'asc' ? '↑' : '↓'}${k.column}`)
						.join(', ') + (stage.keys.length > 2 ? ` +${stage.keys.length - 2}` : '');
		case 'take':
			return stage.rangeFrom !== undefined
				? `${stage.rangeFrom}..${stage.n} rows`
				: `${stage.n} rows`;
		case 'join':
			return `${stage.joinType.toUpperCase()} ${stage.table || '?'}`;
		case 'window':
			return stage.frame || 'rows:-2..0';
		case 'append':
			return stage.sources.length === 0 ? 'no sources' : stage.sources.join(', ');
		case 'loop':
			return 'loop';
		case 'raw':
			return (stage as { type: 'raw'; prql?: string }).prql?.slice(0, 20) || 'raw prql';
		default:
			return '';
	}
}

export function getStageEvidenceSummary(preview: StageEvidenceState): string {
	if (preview.kind === 'loading') return 'running';
	if (preview.kind === 'error') return 'error';
	if (preview.kind === 'result') {
		const rowCount = preview.rows.length;
		const colCount = preview.columns.length;
		const rowLabel = rowCount === 1 ? 'row' : 'rows';
		const colLabel = colCount === 1 ? 'col' : 'cols';
		return `${rowCount} ${rowLabel} · ${colCount} ${colLabel}`;
	}
	return 'none';
}

export function getStageQualityInsights(preview: StageEvidenceState): StageQualityInsight[] {
	if (preview.kind !== 'result') return [];

	const rowCount = preview.rows.length;
	const { numericColumns, nullHeavyColumns, highCardinalityColumns } = summarizeColumns(
		preview.rows,
		preview.columns
	);

	const insights: StageQualityInsight[] = [];

	if (rowCount >= 2000) {
		insights.push({
			id: 'large-result',
			tone: 'info',
			label: 'Large result',
			detail: `${rowCount.toLocaleString()} rows, consider take for faster iteration`
		});
	}

	if (numericColumns.length >= 2) {
		insights.push({
			id: 'metrics-ready',
			tone: 'info',
			label: 'Metrics ready',
			detail: `${numericColumns.length} numeric columns can be grouped or charted`
		});
	}

	if (nullHeavyColumns.length > 0) {
		insights.push({
			id: 'null-heavy',
			tone: 'warn',
			label: 'Null heavy',
			detail: `${nullHeavyColumns.slice(0, 2).join(', ')} have many missing values`
		});
	}

	if (highCardinalityColumns.length > 0) {
		insights.push({
			id: 'high-cardinality',
			tone: 'warn',
			label: 'High cardinality',
			detail: `${highCardinalityColumns[0]} may produce noisy groupings`
		});
	}

	return insights.slice(0, 3);
}

export function getNextStageRecommendations(
	stageType: StageType,
	preview: StageEvidenceState
): StageRecommendation[] {
	const recommendations: StageRecommendation[] = [];

	const push = (
		type: StageRecommendation['type'],
		reason: string,
		stageOverride?: Exclude<GUIPipelineStage, { type: 'raw' }>
	) => {
		if (recommendations.some((item) => item.type === type)) return;
		recommendations.push({
			type,
			reason,
			stage: stageOverride ?? makeStageFromType(type, preview)
		});
	};

	if (preview.kind === 'result') {
		const rowCount = preview.rows.length;
		const { numericColumns, dateColumns, textColumns, boolColumns, nullHeavyColumns } =
			summarizeColumns(preview.rows, preview.columns);

		if (nullHeavyColumns.length > 0 && stageType !== 'filter') {
			const nullColumn = nullHeavyColumns[0];
			push('filter', `Keep rows with ${nullColumn} populated`, {
				type: 'filter',
				logic: 'and',
				conditions: [{ column: nullColumn, op: 'is not null', value: '' }]
			});
		}

		if (
			numericColumns.length > 0 &&
			(textColumns.length > 0 || dateColumns.length > 0 || boolColumns.length > 0) &&
			stageType !== 'group'
		) {
			const dimension =
				textColumns[0] ?? dateColumns[0] ?? boolColumns[0] ?? preview.columns[0] ?? '';
			const metric =
				numericColumns.find((column) => column !== dimension) ?? numericColumns[0] ?? '';
			push('group', `Summarize ${metric} by ${dimension}`, {
				type: 'group',
				by: dimension ? [dimension] : [],
				aggregations: metric
					? [
							{
								name: `sum_${metric}`,
								func: 'sum',
								column: metric
							}
						]
					: []
			});
		}

		if (rowCount > 300 && stageType !== 'take') {
			const suggestedN = rowCount > 3000 ? 200 : 100;
			push('take', `Limit to ${suggestedN} rows for faster iteration`, {
				type: 'take',
				n: suggestedN
			});
		}

		if (preview.columns.length > 10 && stageType !== 'select') {
			const ranked = [...dateColumns, ...textColumns, ...boolColumns, ...numericColumns];
			const deduped = [...new Set(ranked)].filter((column) => preview.columns.includes(column));
			const keepColumns = (deduped.length > 0 ? deduped : preview.columns).slice(0, 6);
			push('select', `Keep a focused set of ${keepColumns.length} columns`, {
				type: 'select',
				columns: keepColumns
			});
		}

		if (numericColumns.length > 0 && stageType !== 'sort') {
			const sortMetric = numericColumns[0];
			push('sort', `Rank by ${sortMetric}`, {
				type: 'sort',
				keys: [{ column: sortMetric, dir: 'desc' }]
			});
		}
	}

	if (stageType === 'from') {
		push('filter', 'Narrow rows early');
		push('select', 'Keep only needed columns');
		push('join', 'Enrich with a lookup table');
	}

	if (stageType === 'filter') {
		push('select', 'Project the cleaned shape');
		push('group', 'Aggregate filtered rows');
	}

	if (stageType === 'select') {
		push('derive', 'Build calculated fields');
		push('sort', 'Order selected output');
		push('join', 'Bring in related attributes');
	}

	if (stageType === 'derive') {
		push('group', 'Aggregate new metrics');
		push('sort', 'Order derived values');
		push('window', 'Compute rolling or windowed metrics');
	}

	if (stageType === 'group') {
		push('sort', 'Rank aggregated results');
		push('take', 'Keep top records');
	}

	if (stageType === 'join') {
		push('select', 'Trim joined columns');
		push('filter', 'Filter joined dataset');
	}

	if (stageType === 'window') {
		push('sort', 'Rank window outputs');
		push('take', 'Keep a focused slice');
	}

	if (stageType === 'append') {
		push('filter', 'Narrow combined rows');
		push('group', 'Summarize merged sources');
	}

	if (stageType === 'loop') {
		push('take', 'Limit iterative result size');
		push('select', 'Project final iterative output');
	}

	return recommendations.slice(0, 3);
}
