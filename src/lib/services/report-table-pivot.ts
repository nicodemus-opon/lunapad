import { coerceNumber } from '$lib/utils';
import type { ColumnFormat, ColumnFormatKind } from '$lib/services/column-format';
import type { TableAggKind } from './report-table-summary';

export interface TablePivotSpec {
	/** Row identifiers / group-by columns. */
	index: string[];
	/** Column whose distinct values become pivoted output columns. */
	pivotBy: string;
	/** Column whose values are aggregated into the pivot cells. */
	valueCol: string;
	agg: TableAggKind;
	/** Optional rounding for numeric outputs. */
	round?: number;
	/** Optional declarative formatting for all generated pivot columns. */
	valueFormatKind?: ColumnFormatKind;
	/** Only used when `valueFormatKind` is `currency`. */
	valueCurrencySymbol?: string;
	/** Max number of pivot columns (to keep output bounded). */
	maxPivotColumns?: number;
}

function roundMaybe(v: number | null, round?: number): number | null {
	if (v === null) return null;
	if (round === undefined) return v;
	return Number(v.toFixed(round));
}

function aggregate(values: unknown[], agg: TableAggKind): number | null {
	if (agg === 'count') {
		return values.filter((v) => v !== null && v !== undefined).length;
	}

	const nums = values.map((v) => coerceNumber(v)).filter((v): v is number => v !== null);
	if (nums.length === 0) return null;

	switch (agg) {
		case 'sum':
			return nums.reduce((a, b) => a + b, 0);
		case 'avg':
			return nums.reduce((a, b) => a + b, 0) / nums.length;
		case 'min':
			return Math.min(...nums);
		case 'max':
			return Math.max(...nums);
		default:
			return null;
	}
}

export function pivotTable(
	rows: Record<string, unknown>[],
	spec: TablePivotSpec
): {
	columns: string[];
	rows: Record<string, unknown>[];
	formatOverrides?: Record<string, ColumnFormat>;
} {
	const {
		index,
		pivotBy,
		valueCol,
		agg,
		round,
		valueFormatKind,
		valueCurrencySymbol,
		maxPivotColumns = 50
	} = spec;

	if (!index.length) throw new Error('pivotTable requires non-empty index');

	// Preserve order of first appearance for pivot columns.
	const pivotValues: string[] = [];
	const pivotValueSet = new Set<string>();

	for (const r of rows) {
		const pv = r[pivotBy];
		if (pv === null || pv === undefined) continue;
		const key = String(pv);
		if (pivotValueSet.has(key)) continue;
		pivotValueSet.add(key);
		pivotValues.push(key);
		if (pivotValues.length >= maxPivotColumns) break;
	}

	const groups = new Map<
		string,
		{
			indexValues: Record<string, unknown>;
			cellValues: Record<string, unknown[]>;
		}
	>();

	for (const r of rows) {
		const indexKey = index.map((c) => String(r[c] ?? '__null__')).join('\u0001');
		const pv = r[pivotBy];
		if (pv === null || pv === undefined) continue;

		const pivotKey = String(pv);
		if (!pivotValueSet.has(pivotKey)) continue;

		const g = groups.get(indexKey);
		if (!g) {
			const indexValues: Record<string, unknown> = {};
			for (const c of index) indexValues[c] = r[c];
			groups.set(indexKey, {
				indexValues,
				cellValues: { [pivotKey]: [r[valueCol]] }
			});
			continue;
		}

		if (!g.cellValues[pivotKey]) g.cellValues[pivotKey] = [];
		g.cellValues[pivotKey].push(r[valueCol]);
	}

	const outRows: Record<string, unknown>[] = [];
	for (const { indexValues, cellValues } of groups.values()) {
		const row: Record<string, unknown> = { ...indexValues };
		for (const pv of pivotValues) {
			const values = cellValues[pv] ?? [];
			row[pv] = roundMaybe(aggregate(values, agg), round);
		}
		outRows.push(row);
	}

	const formatOverrides =
		valueFormatKind != null
			? Object.fromEntries(
					pivotValues.map((pv) => [
						pv,
						{
							kind: valueFormatKind,
							currencySymbol: valueFormatKind === 'currency' ? valueCurrencySymbol : undefined
						}
					])
				)
			: undefined;

	return {
		columns: [...index, ...pivotValues],
		rows: outRows,
		formatOverrides
	};
}

