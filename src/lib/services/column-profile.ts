import { detectColumnFormat, type ColumnFormatKind } from '$lib/services/column-format';
import { coerceNumber } from '$lib/utils';

export interface TopValue {
	value: string | null;
	count: number;
	pctOfRows: number;
}

export interface ColumnProfileNumeric {
	count: number;
	min: number | null;
	max: number | null;
	mean: number | null;
	median: number | null;
	q25: number | null;
	q75: number | null;
	stddev: number | null;
	sum: number | null;
	skew: number | null;
	kurt: number | null;
	histogramBuckets: number[] | null;
}

export interface ColumnProfileBoolean {
	trueCount: number;
	falseCount: number;
}

export interface ColumnProfileText {
	avgLen: number | null;
	minLen: number | null;
	maxLen: number | null;
	emptyCount: number;
}

export interface ColumnProfileTemporal {
	min: string | null;
	max: string | null;
	rangeDays: number | null;
}

export interface ColumnProfile {
	column: string;
	kind: ColumnFormatKind;
	/** DuckDB type label when sourced from SUMMARIZE */
	typeLabel?: string;
	totalRows: number;
	nonNull: number;
	nullCount: number;
	nullPct: number;
	completeness: number;
	unique: number;
	uniquePct: number;
	topValues: TopValue[];
	isLikelyId: boolean;
	isConstant: boolean;
	highNull: boolean;
	numeric?: ColumnProfileNumeric;
	boolean?: ColumnProfileBoolean;
	text?: ColumnProfileText;
	temporal?: ColumnProfileTemporal;
}

export interface DatasetOverview {
	name?: string;
	rowCount: number;
	columnCount: number;
	totalMissingCells: number;
	avgCompleteness: number;
	numericColumnCount: number;
}

export interface DuckDbSummarizeRow {
	column_name: string;
	column_type: string;
	min: string | null;
	max: string | null;
	approx_unique: number | null;
	avg: string | null;
	std: string | null;
	q25: string | null;
	q50: string | null;
	q75: string | null;
	count: number | null;
	null_percentage: string | null;
}

export interface DuckDbProfileExtras {
	topValues: { val: string | null; cnt: number }[];
	skew?: number | null;
	kurt?: number | null;
	avgLen?: number | null;
	minLen?: number | null;
	maxLen?: number | null;
	emptyCount?: number | null;
	totalRows: number;
}

const NUMERIC_KINDS = new Set<ColumnFormatKind>(['number', 'currency', 'percentage']);
const TEMPORAL_KINDS = new Set<ColumnFormatKind>(['date', 'datetime']);
const TOP_VALUES_LIMIT = 8;
const HISTOGRAM_BUCKETS = 20;
const HIGH_NULL_THRESHOLD = 20;

export function quantile(sorted: number[], q: number): number | null {
	if (sorted.length === 0) return null;
	if (sorted.length === 1) return sorted[0];
	const pos = (sorted.length - 1) * q;
	const base = Math.floor(pos);
	const rest = pos - base;
	const next = sorted[base + 1] ?? sorted[base];
	return sorted[base] + rest * (next - sorted[base]);
}

export function mean(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((acc, n) => acc + n, 0) / values.length;
}

export function stddev(values: number[]): number | null {
	if (values.length < 2) return null;
	const m = mean(values)!;
	const variance = values.reduce((acc, n) => acc + (n - m) ** 2, 0) / (values.length - 1);
	return Math.sqrt(variance);
}

export function buildHistogramBuckets(
	values: number[],
	buckets = HISTOGRAM_BUCKETS
): number[] | null {
	if (values.length === 0) return null;
	const min = values[0];
	const max = values[values.length - 1];
	const hist = new Array(buckets).fill(0) as number[];
	const range = max - min;
	if (range <= 0) {
		hist[Math.floor(buckets / 2)] = values.length;
		return hist;
	}
	for (const n of values) {
		const bucket = Math.min(Math.floor(((n - min) / range) * buckets), buckets - 1);
		hist[bucket]++;
	}
	return hist;
}

function parseOptionalNumber(value: string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : null;
}

function computeTopValues(
	values: unknown[],
	totalRows: number,
	limit = TOP_VALUES_LIMIT
): TopValue[] {
	const counts = new Map<string, { value: string | null; count: number }>();
	for (const v of values) {
		const key = v === null || v === undefined ? '__null__' : String(v);
		const existing = counts.get(key);
		if (existing) {
			existing.count++;
		} else {
			counts.set(key, {
				value: v === null || v === undefined ? null : String(v),
				count: 1
			});
		}
	}
	return [...counts.values()]
		.sort((a, b) => b.count - a.count)
		.slice(0, limit)
		.map((row) => ({
			value: row.value,
			count: row.count,
			pctOfRows: totalRows > 0 ? (row.count / totalRows) * 100 : 0
		}));
}

function safeDateRangeDays(min: string | null, max: string | null): number | null {
	if (!min || !max) return null;
	try {
		const d1 = new Date(min);
		const d2 = new Date(max);
		if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
		return Math.round(Math.abs(d2.getTime() - d1.getTime()) / 86_400_000);
	} catch {
		return null;
	}
}

function duckDbCategory(type: string): 'numeric' | 'text' | 'bool' | 'temporal' | 'other' {
	const t = type.toUpperCase();
	if (
		t.includes('INT') ||
		t.includes('FLOAT') ||
		t.includes('DOUBLE') ||
		t.includes('DECIMAL') ||
		t.includes('NUMERIC') ||
		t.includes('REAL') ||
		t.includes('HUGEINT') ||
		t.includes('UBIGINT')
	) {
		return 'numeric';
	}
	if (t.includes('BOOL')) return 'bool';
	if (t.startsWith('DATE') || t.includes('TIMESTAMP') || t.includes('TIME')) return 'temporal';
	if (
		t.includes('VARCHAR') ||
		t.includes('TEXT') ||
		t.includes('CHAR') ||
		t.includes('STRING') ||
		t.includes('BLOB')
	) {
		return 'text';
	}
	return 'other';
}

function duckDbKindFromType(type: string): ColumnFormatKind {
	const cat = duckDbCategory(type);
	if (cat === 'numeric') return 'number';
	if (cat === 'bool') return 'boolean';
	if (cat === 'temporal') return type.toUpperCase().includes('TIME') ? 'datetime' : 'date';
	if (cat === 'text') return 'text';
	return 'text';
}

function buildNumericProfile(
	values: number[],
	skew?: number | null,
	kurt?: number | null
): ColumnProfileNumeric {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		count: values.length,
		min: sorted[0] ?? null,
		max: sorted[sorted.length - 1] ?? null,
		mean: mean(values),
		median: quantile(sorted, 0.5),
		q25: quantile(sorted, 0.25),
		q75: quantile(sorted, 0.75),
		stddev: stddev(values),
		sum: values.length > 0 ? values.reduce((acc, n) => acc + n, 0) : null,
		skew: skew ?? null,
		kurt: kurt ?? null,
		histogramBuckets: buildHistogramBuckets(sorted)
	};
}

export function computeColumnProfile(
	rows: Record<string, unknown>[],
	column: string
): ColumnProfile {
	const totalRows = rows.length;
	const values = rows.map((r) => r[column]);
	const nonNullValues = values.filter((v) => v !== null && v !== undefined);
	const nullCount = totalRows - nonNullValues.length;
	const nullPct = totalRows === 0 ? 0 : (nullCount / totalRows) * 100;
	const completeness = 100 - nullPct;
	const unique = new Set(nonNullValues.map((v) => String(v))).size;
	const uniquePct = totalRows === 0 ? 0 : (unique / totalRows) * 100;
	const kind = detectColumnFormat(rows, column).kind;
	const topValues = computeTopValues(values, totalRows);

	const isConstant = unique <= 1 && nonNullValues.length > 0;
	const isLikelyId = kind === 'id' || (uniquePct >= 90 && totalRows >= 5);
	const highNull = nullPct > HIGH_NULL_THRESHOLD;

	const profile: ColumnProfile = {
		column,
		kind,
		totalRows,
		nonNull: nonNullValues.length,
		nullCount,
		nullPct,
		completeness,
		unique,
		uniquePct,
		topValues,
		isLikelyId,
		isConstant,
		highNull
	};

	if (kind === 'boolean') {
		const trueCount = nonNullValues.filter(
			(v) => v === true || String(v).toLowerCase() === 'true'
		).length;
		const falseCount = nonNullValues.filter(
			(v) => v === false || String(v).toLowerCase() === 'false'
		).length;
		profile.boolean = { trueCount, falseCount };
	} else if (NUMERIC_KINDS.has(kind)) {
		const numericValues = nonNullValues
			.map((v) => coerceNumber(v))
			.filter((v): v is number => v !== null);
		if (numericValues.length > 0) {
			profile.numeric = buildNumericProfile(numericValues);
		}
	} else if (TEMPORAL_KINDS.has(kind)) {
		const stringValues = nonNullValues.map((v) =>
			v instanceof Date ? v.toISOString() : String(v)
		);
		const sorted = [...stringValues].sort();
		profile.temporal = {
			min: sorted[0] ?? null,
			max: sorted[sorted.length - 1] ?? null,
			rangeDays: safeDateRangeDays(sorted[0] ?? null, sorted[sorted.length - 1] ?? null)
		};
	} else if (kind === 'text' || kind === 'category' || kind === 'email' || kind === 'url') {
		const lengths = nonNullValues.map((v) => String(v).length);
		const emptyCount = nonNullValues.filter((v) => String(v) === '').length;
		profile.text = {
			avgLen: lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : null,
			minLen: lengths.length > 0 ? Math.min(...lengths) : null,
			maxLen: lengths.length > 0 ? Math.max(...lengths) : null,
			emptyCount
		};
	}

	// Coercible numeric values in otherwise text columns
	if (!profile.numeric) {
		const numericValues = nonNullValues
			.map((v) => coerceNumber(v))
			.filter((v): v is number => v !== null);
		if (
			numericValues.length > 0 &&
			numericValues.length / Math.max(nonNullValues.length, 1) >= 0.7
		) {
			profile.numeric = buildNumericProfile(numericValues);
		}
	}

	return profile;
}

export function computeProfilesFromRows(
	rows: Record<string, unknown>[],
	columns: string[]
): ColumnProfile[] {
	return columns.map((column) => computeColumnProfile(rows, column));
}

export function computeDatasetOverview(
	profiles: ColumnProfile[],
	meta: { name?: string; rowCount?: number } = {}
): DatasetOverview {
	const rowCount = meta.rowCount ?? profiles[0]?.totalRows ?? 0;
	const columnCount = profiles.length;
	const totalMissingCells = profiles.reduce((sum, p) => sum + p.nullCount, 0);
	const avgCompleteness =
		columnCount > 0 ? profiles.reduce((sum, p) => sum + p.completeness, 0) / columnCount : 0;
	const numericColumnCount = profiles.filter((p) => p.numeric != null).length;
	return {
		name: meta.name,
		rowCount,
		columnCount,
		totalMissingCells,
		avgCompleteness,
		numericColumnCount
	};
}

export function mapDuckDbProfile(
	summarize: DuckDbSummarizeRow,
	extras: DuckDbProfileExtras
): ColumnProfile {
	const totalRows = extras.totalRows;
	const nullPct = summarize.null_percentage
		? Math.min(100, Math.max(0, parseFloat(summarize.null_percentage)))
		: 0;
	const completeness = 100 - nullPct;
	const nullCount = Math.round((nullPct / 100) * totalRows);
	const nonNull = Math.max(0, totalRows - nullCount);
	const unique = summarize.approx_unique ?? 0;
	const uniquePct = totalRows > 0 ? (unique / totalRows) * 100 : 0;
	const kind = duckDbKindFromType(summarize.column_type);
	const cat = duckDbCategory(summarize.column_type);

	const topValues: TopValue[] = extras.topValues.map((row) => ({
		value: row.val,
		count: row.cnt,
		pctOfRows: totalRows > 0 ? (row.cnt / totalRows) * 100 : 0
	}));

	const isConstant = unique <= 1 && nonNull > 0;
	const isLikelyId =
		/(^|_)(id|uuid|guid)$/i.test(summarize.column_name) && uniquePct >= 90 && totalRows >= 5;
	const highNull = nullPct > HIGH_NULL_THRESHOLD;

	const profile: ColumnProfile = {
		column: summarize.column_name,
		kind,
		typeLabel: summarize.column_type.toLowerCase().split('(')[0],
		totalRows,
		nonNull,
		nullCount,
		nullPct,
		completeness,
		unique,
		uniquePct,
		topValues,
		isLikelyId,
		isConstant,
		highNull
	};

	if (cat === 'numeric') {
		const min = parseOptionalNumber(summarize.min);
		const max = parseOptionalNumber(summarize.max);
		const values: number[] = [];
		if (min != null) values.push(min);
		if (max != null && max !== min) values.push(max);
		const sorted =
			min != null && max != null ? [min, max].sort((a, b) => a - b) : values.sort((a, b) => a - b);
		profile.numeric = {
			count: nonNull,
			min,
			max,
			mean: parseOptionalNumber(summarize.avg),
			median: parseOptionalNumber(summarize.q50),
			q25: parseOptionalNumber(summarize.q25),
			q75: parseOptionalNumber(summarize.q75),
			stddev: parseOptionalNumber(summarize.std),
			sum: null,
			skew: extras.skew ?? null,
			kurt: extras.kurt ?? null,
			histogramBuckets:
				min != null && max != null ? buildHistogramBuckets(sorted.length ? sorted : [min]) : null
		};
	} else if (cat === 'bool') {
		const trueRow = extras.topValues.find((v) => v.val?.toLowerCase() === 'true');
		const falseRow = extras.topValues.find((v) => v.val?.toLowerCase() === 'false');
		profile.boolean = {
			trueCount: trueRow?.cnt ?? 0,
			falseCount: falseRow?.cnt ?? 0
		};
	} else if (cat === 'temporal') {
		profile.temporal = {
			min: summarize.min,
			max: summarize.max,
			rangeDays: safeDateRangeDays(summarize.min, summarize.max)
		};
	} else if (cat === 'text') {
		profile.text = {
			avgLen: extras.avgLen ?? null,
			minLen: extras.minLen ?? null,
			maxLen: extras.maxLen ?? null,
			emptyCount: extras.emptyCount ?? 0
		};
	}

	return profile;
}

/** Lightweight stats for ResultTable column headers */
export function computeTableHeaderStats(
	rows: Record<string, unknown>[],
	column: string
): {
	col: string;
	missing: number;
	distinct: number;
	total: number;
	isNumeric: boolean;
	min: number | null;
	max: number | null;
	histBuckets: number[] | null;
} {
	const profile = computeColumnProfile(rows, column);
	return {
		col: column,
		missing: profile.nullCount,
		distinct: profile.unique,
		total: profile.totalRows,
		isNumeric: profile.numeric != null,
		min: profile.numeric?.min ?? null,
		max: profile.numeric?.max ?? null,
		histBuckets: profile.numeric?.histogramBuckets ?? null
	};
}

export function collectQualityHints(
	profiles: ColumnProfile[],
	options: { truncated?: boolean } = {}
): string[] {
	const hints: string[] = [];
	const highNullCols = profiles.filter((p) => p.highNull).length;
	const constantCols = profiles.filter((p) => p.isConstant).length;
	const idCols = profiles.filter((p) => p.isLikelyId).length;

	if (highNullCols > 0) {
		hints.push(
			highNullCols === 1 ? '1 column has >20% nulls' : `${highNullCols} columns have >20% nulls`
		);
	}
	if (constantCols > 0) {
		hints.push(constantCols === 1 ? '1 constant column' : `${constantCols} constant columns`);
	}
	if (idCols > 0) {
		hints.push(idCols === 1 ? '1 likely identifier column' : `${idCols} likely identifier columns`);
	}
	if (options.truncated) {
		hints.push('Results capped at 1,000 rows');
	}
	return hints;
}

export function defaultSelectedColumn(profiles: ColumnProfile[]): string | null {
	if (profiles.length === 0) return null;
	const flagged = profiles.find((p) => p.highNull || p.isConstant || p.isLikelyId);
	return flagged?.column ?? profiles[0].column;
}

export function compactProfileColumns(profiles: ColumnProfile[], limit = 2): ColumnProfile[] {
	const flagged = profiles.filter((p) => p.highNull || p.isConstant || p.isLikelyId);
	if (flagged.length >= limit) return flagged.slice(0, limit);
	const rest = profiles.filter((p) => !flagged.includes(p));
	return [...flagged, ...rest].slice(0, limit);
}
