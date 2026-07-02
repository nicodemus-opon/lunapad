import { coerceNumber } from '$lib/utils';
import type { ColumnFormat, ColumnFormatKind } from '$lib/services/column-format';

export type TableAggKind = 'sum' | 'avg' | 'min' | 'max' | 'count';

export interface TableSummarySpec {
	/** Columns to group rows by. */
	groupBy: string[];
	/** Column whose values are aggregated into the summary output. */
	valueCol: string;
	agg: TableAggKind;
	/** Optional rounding for numeric outputs. */
	round?: number;
	/** Optional declarative formatting for the output aggregated column. */
	valueFormatKind?: ColumnFormatKind;
	/** Only used when `valueFormatKind` is `currency`. */
	valueCurrencySymbol?: string;
}

function roundMaybe(v: number | null, round?: number): number | null {
	if (v === null) return null;
	if (round === undefined) return v;
	return Number(v.toFixed(round));
}

function aggregate(values: unknown[], agg: TableAggKind): number | null {
	if (agg === 'count') {
		// Count all non-null/non-undefined values (numeric or not).
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

function formatOutputColName(agg: TableAggKind, valueCol: string): string {
	if (agg === 'count') return `count(${valueCol})`;
	return `${agg}(${valueCol})`;
}

export function summarizeTable(
	rows: Record<string, unknown>[],
	spec: TableSummarySpec
): {
	columns: string[];
	rows: Record<string, unknown>[];
	formatOverrides?: Record<string, ColumnFormat>;
} {
	const { groupBy, valueCol, agg, round, valueFormatKind, valueCurrencySymbol } = spec;
	if (!groupBy.length) throw new Error('summarizeTable requires non-empty groupBy');

	const outputValueCol = formatOutputColName(agg, valueCol);

	// group key -> { groupValues, valueSamples }
	const groups = new Map<string, { groupValues: Record<string, unknown>; valueSamples: unknown[] }>();

	for (const r of rows) {
		const keyParts = groupBy.map((c) => String(r[c] ?? '__null__'));
		const key = keyParts.join('\u0001');
		const existing = groups.get(key);
		if (!existing) {
			const groupValues: Record<string, unknown> = {};
			for (const c of groupBy) groupValues[c] = r[c];
			groups.set(key, { groupValues, valueSamples: [r[valueCol]] });
		} else {
			existing.valueSamples.push(r[valueCol]);
		}
	}

	const outRows: Record<string, unknown>[] = [];
	for (const { groupValues, valueSamples } of groups.values()) {
		const aggValue = aggregate(valueSamples, agg);
		outRows.push({
			...groupValues,
			[outputValueCol]: roundMaybe(aggValue, round)
		});
	}

	const formatOverrides =
		valueFormatKind != null
			? {
					[outputValueCol]: {
						kind: valueFormatKind,
						currencySymbol: valueFormatKind === 'currency' ? valueCurrencySymbol : undefined
					}
				}
			: undefined;

	return {
		columns: [...groupBy, outputValueCol],
		rows: outRows,
		formatOverrides
	};
}

