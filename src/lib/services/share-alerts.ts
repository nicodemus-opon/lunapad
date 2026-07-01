export type AlertOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

export interface ShareAlertRule {
	id: string;
	metricPath: string;
	operator: AlertOperator;
	threshold: number;
	webhookUrl?: string;
}

export function evaluateAlertRule(
	actual: number | null,
	operator: AlertOperator,
	threshold: number
): boolean {
	if (actual === null || Number.isNaN(actual)) return false;
	switch (operator) {
		case 'gt':
			return actual > threshold;
		case 'gte':
			return actual >= threshold;
		case 'lt':
			return actual < threshold;
		case 'lte':
			return actual <= threshold;
		case 'eq':
			return actual === threshold;
		default:
			return false;
	}
}

/** Resolve `$cell.field` or `cell.field` to a numeric value from snapshot rows. */
export function resolveMetricFromRows(
	metricPath: string,
	rowsByOutput: Map<string, Record<string, unknown>[]>
): number | null {
	const cleaned = metricPath.replace(/^\$/, '');
	const [outputName, ...rest] = cleaned.split('.');
	if (!outputName) return null;
	const field = rest.join('.') || 'value';
	const rows = rowsByOutput.get(outputName);
	if (!rows?.length) return null;
	const v = rows[0][field];
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}
