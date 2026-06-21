import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function coerceNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') {
		let normalized = value.trim();
		if (!normalized) return null;

		// Handle escaped quotes from CSV/SQL payloads (e.g. \"5300\").
		normalized = normalized.replace(/\\"/g, '"');
		normalized = normalized.replace(/^"+|"+$/g, '');
		normalized = normalized.replace(/^'+|'+$/g, '');

		const isParenNegative = /^\(.*\)$/.test(normalized);
		normalized = normalized.replace(/^\(|\)$/g, '');
		normalized = normalized
			.replaceAll(',', '')
			.replaceAll(' ', '')
			.replace(/[$€£¥₦₵₹]/g, '')
			.replace(/%$/g, '');

		if (!normalized) return null;
		const parsed = Number(normalized);
		if (!Number.isFinite(parsed)) return null;
		return isParenNegative ? -Math.abs(parsed) : parsed;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

// ── Chart config inference ───────────────────────────────────────────────────
import type { ChartConfig, ChartType } from '$lib/types/gui-pipeline';
import { recommendIntelligentChartTypes } from '$lib/services/intelligence-db';

export interface ChartRecommendation {
	chartType: ChartType;
	reason: string;
	confidence: number;
}

export type ColKind = 'numeric' | 'date' | 'bool' | 'text';

function detectColKind(rows: Record<string, unknown>[], col: string): ColKind {
	const samples = rows
		.map((r) => r[col])
		.filter((v) => v !== null && v !== undefined)
		.slice(0, 50);
	if (samples.length === 0) return 'text';

	if (samples.some((v) => typeof v === 'boolean')) return 'bool';
	if (samples.some((v) => v instanceof Date)) return 'date';

	const dateHits = samples.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(String(v).trim())).length;
	if (dateHits / samples.length >= 0.7) return 'date';

	const numericHits = samples.filter((v) => coerceNumber(v) !== null).length;
	if (numericHits / samples.length >= 0.7) return 'numeric';

	return 'text';
}

function makeConfig(overrides: Partial<ChartConfig> & { chartType: ChartType }): ChartConfig {
	return {
		xColumn: '',
		yColumns: [],
		colorColumn: null,
		sizeColumn: null,
		yColumnsSecondary: [],
		seriesMode: 'auto',
		recommendation: null,
		...overrides
	};
}

// Returns true when a column name suggests it's a KPI-style delta/comparison
function isComparisonColName(name: string): boolean {
	return /prev|last|prior|comparison|delta|diff|change|vs|versus/i.test(name);
}

export function inferChartConfig(
	columns: string[],
	rows: Record<string, unknown>[]
): ChartConfig {
	if (columns.length === 0) return makeConfig({ chartType: 'table' });

	const kinds: Record<string, ColKind> = {};
	for (const col of columns) kinds[col] = detectColKind(rows, col);

	const dateCols = columns.filter((c) => kinds[c] === 'date');
	const numCols  = columns.filter((c) => kinds[c] === 'numeric');
	const textCols = columns.filter((c) => kinds[c] === 'text');

	function cardinality(col: string): number {
		return new Set(rows.map((r) => r[col])).size;
	}
	const lowCardText = textCols.find((c) => cardinality(c) <= Math.min(20, rows.length / 2));

	// ── Aggregate / KPI patterns ──────────────────────────────────────────────
	// Single row: always a KPI card, regardless of column count
	if (rows.length === 1 && numCols.length >= 1) {
		const mainCol = numCols[0];
		// If a second numeric col looks like a comparison, wire it up
		const compCol = numCols.find((c) => c !== mainCol && isComparisonColName(c)) ?? numCols[1];
		return makeConfig({
			chartType: 'big-value',
			xColumn: mainCol,
			yColumns: compCol && compCol !== mainCol ? [compCol] : [],
			colorColumn: dateCols[0] ?? null  // sparkline date if available
		});
	}

	// Empty result: table
	if (rows.length === 0) return makeConfig({ chartType: 'table', xColumn: columns[0] });

	// ── Table fallback for wide/non-chartable data ────────────────────────────
	if (columns.length > 10) return makeConfig({ chartType: 'table', xColumn: columns[0] });
	if (numCols.length === 0) return makeConfig({ chartType: 'table', xColumn: columns[0] });

	// ── Standard chart inference ──────────────────────────────────────────────
	// Pick X: prefer date, else low-cardinality text, else any text, else first numeric
	const xColumn = dateCols[0] ?? lowCardText ?? textCols[0] ?? numCols[0] ?? columns[0];
	const yColumns = numCols.filter((c) => c !== xColumn).slice(0, 4);
	// If the only numeric col was chosen as X, treat it as the Y instead
	const finalY = yColumns.length > 0 ? yColumns : numCols.filter((c) => c !== xColumn);

	// No Y found: single numeric, no categorical X → big-value
	if (finalY.length === 0) {
		return makeConfig({ chartType: 'big-value', xColumn: numCols[0] });
	}

	let chartType: ChartType = 'bar';
	if (dateCols.length > 0) chartType = 'line';
	else if (finalY.length >= 2) chartType = 'line';
	else if (numCols.length >= 2 && textCols.length === 0 && dateCols.length === 0) chartType = 'scatter';

	return makeConfig({
		chartType,
		xColumn,
		yColumns: finalY,
		colorColumn: lowCardText && lowCardText !== xColumn ? lowCardText : null,
		seriesMode: 'auto'
	});
}

export function normalizeChartConfig(config: ChartConfig): ChartConfig {
	const nextY = Array.from(new Set((config.yColumns ?? []).filter(Boolean)));
	const nextSecondaryY = Array.from(new Set((config.yColumnsSecondary ?? []).filter(Boolean)));
	const seriesMode = config.seriesMode ?? (config.chartType === 'area' ? 'stacked' : 'auto');
	return {
		chartType: config.chartType,
		xColumn: config.xColumn,
		yColumns: nextY,
		colorColumn: config.colorColumn ?? null,
		sizeColumn: config.sizeColumn ?? null,
		yColumnsSecondary: nextSecondaryY,
		seriesMode,
		recommendation: config.recommendation ?? null,
		// Preserve all optional display/config fields so they are not wiped on updates
		...(config.sortOrder !== undefined && { sortOrder: config.sortOrder }),
		...(config.histogramBins !== undefined && { histogramBins: config.histogramBins }),
		...(config.title !== undefined && { title: config.title }),
		...(config.description !== undefined && { description: config.description }),
		...(config.deltaDownIsGood !== undefined && { deltaDownIsGood: config.deltaDownIsGood }),
		...(config.valueRow !== undefined && { valueRow: config.valueRow }),
		...(config.tableRows !== undefined && { tableRows: config.tableRows }),
		...(config.tableSearch !== undefined && { tableSearch: config.tableSearch }),
		...(config.code !== undefined && { code: config.code }),
	};
}

export const DEFAULT_CUSTOM_CHART_CODE = `// rows: the cell's result rows, columns: their names, Plot: the Observable Plot API
return Plot.plot({
	marks: [
		Plot.dot(rows, { x: columns[0], y: columns[1], fill: 'var(--chart-1)' })
	]
});`;

function sanitizeColumn(column: string | null | undefined, columns: string[]): string | null {
	if (!column) return null;
	return columns.includes(column) ? column : null;
}

function uniqueColumns(columns: string[]): string[] {
	return Array.from(new Set(columns.filter(Boolean)));
}

function cardinality(rows: Record<string, unknown>[], col: string): number {
	return new Set(rows.map((r) => r[col])).size;
}

function splitSecondaryMetrics(
	xColumn: string,
	numCols: string[],
	rows: Record<string, unknown>[]
): { primary: string[]; secondary: string[] } {
	const metricCandidates = numCols.filter((col) => col !== xColumn);
	if (metricCandidates.length <= 2) return { primary: metricCandidates, secondary: [] };
	const xCardinality = xColumn ? cardinality(rows, xColumn) : 0;
	if (xCardinality < 18) return { primary: metricCandidates.slice(0, 4), secondary: [] };
	return {
		primary: metricCandidates.slice(0, 2),
		secondary: metricCandidates.slice(2, 4)
	};
}

export function inferSmartChartConfigForType(
	columns: string[],
	rows: Record<string, unknown>[],
	chartType: ChartType,
	currentConfig?: ChartConfig | null
): ChartConfig {
	const smart = inferSmartChartConfig(columns, rows);
	const base = normalizeChartConfig(currentConfig ?? smart);
	const kinds: Record<string, ColKind> = {};
	for (const col of columns) kinds[col] = detectColKind(rows, col);
	const dateCols = columns.filter((c) => kinds[c] === 'date');
	const numCols = columns.filter((c) => kinds[c] === 'numeric');
	const textCols = columns.filter((c) => kinds[c] === 'text');

	let xColumn = sanitizeColumn(base.xColumn, columns) ?? smart.xColumn;
	let yColumns = uniqueColumns(base.yColumns).filter((col) => columns.includes(col));
	let yColumnsSecondary = uniqueColumns(base.yColumnsSecondary ?? []).filter((col) => columns.includes(col));
	let colorColumn = sanitizeColumn(base.colorColumn ?? null, columns);
	let sizeColumn = sanitizeColumn(base.sizeColumn ?? null, columns);
	let seriesMode = base.seriesMode ?? 'auto';

	if (chartType === 'scatter' || chartType === 'bubble') {
		xColumn = numCols[0] ?? xColumn;
		yColumns = [numCols.find((col) => col !== xColumn) ?? numCols[1] ?? numCols[0]].filter(Boolean);
		yColumnsSecondary = [];
		if (chartType === 'bubble') {
			sizeColumn = numCols.find((col) => col !== xColumn && !yColumns.includes(col)) ?? sizeColumn;
		}
		seriesMode = 'auto';
	} else if (chartType === 'histogram') {
		xColumn = numCols[0] ?? xColumn;
		yColumns = [numCols[0]].filter(Boolean);
		yColumnsSecondary = [];
		sizeColumn = null;
		seriesMode = 'auto';
	} else if (chartType === 'custom') {
		if (!base.code) {
			return normalizeChartConfig({ ...base, chartType, code: DEFAULT_CUSTOM_CHART_CODE });
		}
	} else if (chartType === 'pie') {
		xColumn = textCols[0] ?? dateCols[0] ?? xColumn;
		yColumns = [numCols.find((col) => col !== xColumn) ?? numCols[0]].filter(Boolean);
		yColumnsSecondary = [];
		sizeColumn = null;
		seriesMode = 'auto';
	} else if (chartType === 'line' || chartType === 'area' || chartType === 'bar' || chartType === 'bar-horizontal') {
		const defaultX = chartType === 'bar' || chartType === 'bar-horizontal'
			? (xColumn ?? textCols[0] ?? dateCols[0])
			: (xColumn ?? dateCols[0] ?? textCols[0]);
		xColumn = defaultX;
		const split = splitSecondaryMetrics(xColumn, numCols, rows);
		yColumns = split.primary.length > 0 ? split.primary : yColumns;
		yColumnsSecondary = (chartType === 'line' || chartType === 'area') ? split.secondary : [];
		sizeColumn = null;
		if (chartType === 'bar' || chartType === 'bar-horizontal') {
			seriesMode = base.seriesMode === 'stacked' ? 'stacked' : 'grouped';
		} else if (chartType === 'area') {
			seriesMode = base.seriesMode === 'grouped' ? 'grouped' : (yColumns.length > 1 ? 'stacked' : 'auto');
		} else {
			seriesMode = base.seriesMode ?? 'grouped';
		}
	}

	if (!colorColumn) {
		const candidate = textCols.find((col) => col !== xColumn && cardinality(rows, col) <= Math.min(20, rows.length / 2));
		colorColumn = candidate ?? null;
	}

	return normalizeChartConfig({
		...base,
		chartType,
		xColumn,
		yColumns,
		yColumnsSecondary,
		colorColumn,
		sizeColumn,
		seriesMode
	});
}

export function inferSmartChartConfig(
	columns: string[],
	rows: Record<string, unknown>[]
): ChartConfig {
	const base = normalizeChartConfig(inferChartConfig(columns, rows));
	if (columns.length === 0) return base;
	// Don't override table or single-row KPI fallbacks from base inference.
	if (base.chartType === 'table') return base;
	if (base.chartType === 'big-value' && rows.length === 1) return base;

	const kinds: Record<string, ColKind> = {};
	for (const col of columns) kinds[col] = detectColKind(rows, col);

	const dateCols = columns.filter((c) => kinds[c] === 'date');
	const numCols = columns.filter((c) => kinds[c] === 'numeric');
	const textCols = columns.filter((c) => kinds[c] === 'text');

	const intelligent = recommendIntelligentChartTypes({ columns, rows })[0];
	const recommended = intelligent?.chartType ?? recommendChartTypes(columns, rows)[0]?.chartType ?? base.chartType;
	const intelligentX = intelligent?.xColumn && columns.includes(intelligent.xColumn) ? intelligent.xColumn : null;
	const intelligentY = (intelligent?.yColumns ?? []).filter((column) => columns.includes(column));
	const intelligentColor = intelligent?.colorColumn && columns.includes(intelligent.colorColumn)
		? intelligent.colorColumn
		: null;
	const intelligentSize = intelligent?.sizeColumn && columns.includes(intelligent.sizeColumn)
		? intelligent.sizeColumn
		: null;
	let xColumn = base.xColumn;
	let yColumns = [...base.yColumns];
	let colorColumn = base.colorColumn;
	let sizeColumn = base.sizeColumn ?? null;
	let seriesMode = base.seriesMode ?? 'auto';
	let yColumnsSecondary: string[] = base.yColumnsSecondary ?? [];

	if (intelligentX) {
		xColumn = intelligentX;
	}
	if (intelligentY.length > 0) {
		yColumns = intelligentY;
	}
	if (intelligentColor) {
		colorColumn = intelligentColor;
	}
	if (intelligentSize) {
		sizeColumn = intelligentSize;
	}
	if (intelligent?.seriesMode) {
		seriesMode = intelligent.seriesMode;
	}

	if (intelligent?.yColumns && intelligent.yColumns.length >= 3) {
		yColumnsSecondary = intelligent.yColumns.slice(2, 4).filter((col) => columns.includes(col));
	}

	if ((recommended === 'scatter' || recommended === 'bubble') && numCols.length >= 2) {
		xColumn = intelligentX ?? numCols[0];
		yColumns = intelligentY.length > 0 ? intelligentY.slice(0, 1) : [numCols[1]];
		if (recommended === 'bubble') {
			sizeColumn = intelligentSize ?? numCols[2] ?? sizeColumn ?? null;
		}
	} else if (recommended === 'histogram' && numCols.length >= 1) {
		xColumn = numCols[0];
		yColumns = [numCols[0]];
	} else if (recommended === 'pie') {
		xColumn = intelligentX ?? textCols[0] ?? dateCols[0] ?? base.xColumn;
		yColumns = intelligentY.length > 0 ? intelligentY.slice(0, 1) : (numCols.length > 0 ? [numCols.find((col) => col !== xColumn) ?? numCols[0]] : []);
	} else if ((recommended === 'line' || recommended === 'area') && numCols.length > 0) {
		xColumn = intelligentX ?? dateCols[0] ?? textCols[0] ?? numCols[0] ?? base.xColumn;
		if (intelligentY.length > 0) {
			yColumns = intelligentY.slice(0, 4);
			yColumnsSecondary = intelligentY.slice(2, 4);
		} else {
			const split = splitSecondaryMetrics(xColumn, numCols, rows);
			yColumns = split.primary.slice(0, 4);
			yColumnsSecondary = split.secondary.slice(0, 2);
		}
		if (yColumns.length === 0 && numCols.length > 0) {
			yColumns = [numCols[0]];
		}
		seriesMode = recommended === 'area' && yColumns.length > 1 ? 'stacked' : seriesMode;
	} else if ((recommended === 'bar' || recommended === 'bar-horizontal') && numCols.length > 0) {
		xColumn = intelligentX ?? textCols[0] ?? dateCols[0] ?? base.xColumn;
		yColumns = intelligentY.length > 0 ? intelligentY.slice(0, 4) : numCols.filter((col) => col !== xColumn).slice(0, 4);
		yColumnsSecondary = [];
		if (yColumns.length === 0) yColumns = [numCols[0]];
		seriesMode = intelligent?.seriesMode ?? 'grouped';
	}

	return normalizeChartConfig({
		...base,
		chartType: recommended,
		xColumn,
		yColumns,
		yColumnsSecondary,
		colorColumn,
		sizeColumn,
		seriesMode,
		recommendation: intelligent
			? {
				reason: intelligent.reason,
				confidence: intelligent.confidence,
				signature: intelligent.signature
			}
			: null
	});
}

export function recommendChartTypes(
	columns: string[],
	rows: Record<string, unknown>[]
): ChartRecommendation[] {
	if (columns.length === 0) return [];

	const intelligent = recommendIntelligentChartTypes({ columns, rows });
	if (intelligent.length > 0) {
		return intelligent.map((item) => ({
			chartType: item.chartType,
			reason: item.reason,
			confidence: item.confidence
		}));
	}

	const kinds: Record<string, ColKind> = {};
	for (const col of columns) kinds[col] = detectColKind(rows, col);

	const dateCols = columns.filter((c) => kinds[c] === 'date');
	const numCols = columns.filter((c) => kinds[c] === 'numeric');
	const textCols = columns.filter((c) => kinds[c] === 'text');

	const recommendations: ChartRecommendation[] = [];
	const add = (chartType: ChartType, reason: string, confidence: number) => {
		if (recommendations.some((item) => item.chartType === chartType)) return;
		recommendations.push({ chartType, reason, confidence });
	};

	if (dateCols.length > 0 && numCols.length > 0) {
		add('line', 'Time-series trend across date axis', 0.95);
		add('area', 'Emphasize cumulative movement over time', 0.82);
	}

	if (textCols.length > 0 && numCols.length > 0) {
		add('bar', 'Compare metric across categories', 0.9);
		add('bar-horizontal', 'Improve readability for long labels', 0.78);
	}

	if (numCols.length >= 2 && dateCols.length === 0) {
		add('scatter', 'Reveal relationships between measures', 0.86);
	}

	if (numCols.length === 1) {
		add('histogram', 'Inspect distribution of a single measure', 0.74);
	}

	if (textCols.length > 0 && numCols.length === 1 && rows.length > 0) {
		const sampleText = textCols[0];
		const cardinality = new Set(rows.map((row) => row[sampleText])).size;
		if (cardinality <= 8) {
			add('pie', 'Show part-to-whole split for low-cardinality categories', 0.68);
		}
	}

	const fallback = inferChartConfig(columns, rows).chartType;
	add(fallback, 'General-purpose default based on column types', 0.6);

	return recommendations.sort((a, b) => b.confidence - a.confidence).slice(0, 4);
}
