import { detectColumnFormat, type ColumnFormat } from '$lib/services/column-format';
import type { ColumnFormatKind } from '$lib/services/column-format';

export type ReportTableAlignment = 'left' | 'right' | 'center';

export interface ReportTableColumn {
	/** Column id used to address row values. */
	id: string;
	/** Label displayed in headers (defaults to `id`). */
	label: string;
	/** Value formatting kind inferred from the dataset. */
	format: ColumnFormat;
	align: ReportTableAlignment;
	/** Optional per-column description (for authoring UX). */
	description?: string;
}

export interface ReportTableModel {
	columns: ReportTableColumn[];
	rows: Record<string, unknown>[];
	/**
	 * Optional metadata for UI/exports (e.g. whether the dataset was capped).
	 * Keep this generic so both interactive + static renderers can share it.
	 */
	meta?: {
		name?: string;
		truncated?: boolean;
	};
}

function inferAlignment(kind: ColumnFormatKind): ReportTableAlignment {
	if (kind === 'number' || kind === 'currency' || kind === 'percentage') return 'right';
	if (kind === 'boolean') return 'center';
	return 'left';
}

export function buildReportTableModel(
	rows: Record<string, unknown>[],
	columns: string[],
	options: {
		name?: string;
		columnLabels?: Record<string, string>;
		formatOverrides?: Record<string, ColumnFormat>;
	} = {}
): ReportTableModel {
	const columnLabels = options.columnLabels ?? {};
	const formatOverrides = options.formatOverrides ?? {};

	const colDefs: ReportTableColumn[] = columns.map((col) => {
		const format = formatOverrides[col] ?? detectColumnFormat(rows, col);
		return {
			id: col,
			label: columnLabels[col] ?? col,
			format,
			align: inferAlignment(format.kind)
		};
	});

	return {
		columns: colDefs,
		rows,
		meta: {
			name: options.name
		}
	};
}

export function getReportTableColumn(
	model: ReportTableModel,
	colId: string
): ReportTableColumn | undefined {
	return model.columns.find((c) => c.id === colId);
}

