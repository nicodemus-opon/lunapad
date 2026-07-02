import { coerceNumber } from '$lib/utils';
import {
	type ColumnFormat,
	paletteSeedForValue,
	truncateMiddle
} from '$lib/services/column-format';

const CURRENCY_CODE_BY_SYMBOL: Record<string, string> = {
	$: 'USD',
	'€': 'EUR',
	'£': 'GBP',
	'¥': 'JPY',
	'₹': 'INR',
	'₦': 'NGN',
	'₵': 'GHS'
};

const dateFmt = new Intl.DateTimeFormat(undefined, {
	year: 'numeric',
	month: 'short',
	day: 'numeric'
});

const datetimeFmt = new Intl.DateTimeFormat(undefined, {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit'
});

export interface FormattedCell {
	/** Primary text to render in the table cell. */
	text: string;
	/**
	 * Optional category palette seed (for UI renderers that draw category markers).
	 * Derived from the (already truncated) plain text form.
	 */
	categorySeed?: number;
}

/**
 * Produces the "plain text" string used by UI renderers (and by export) so they can
 * safely render long objects without freezing the client.
 *
 * Mirrors the truncation strategy in `ResultTable.svelte`.
 */
export function formatCellPlainText(value: unknown, maxLen = 200): string {
	if (value === null || value === undefined) return '—';

	const s =
		value instanceof Date
			? value.toISOString()
			: typeof value === 'object'
				? JSON.stringify(value)
				: String(value);

	return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

/**
 * Produces an un-truncated full-value string suitable for detail panels, copying, or
 * export.
 */
export function formatFullValueText(value: unknown): string {
	if (value === null || value === undefined) return 'null';
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') return JSON.stringify(value, null, 2);
	return String(value);
}

function parseDate(v: unknown): Date | null {
	const d = v instanceof Date ? v : new Date(String(v));
	return Number.isNaN(d.getTime()) ? null : d;
}

function parseEpochDate(v: unknown): Date | null {
	const n = coerceNumber(v);
	if (n === null) return parseDate(v);
	const ms = n > 1e12 ? n : n * 1000;
	const d = new Date(ms);
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a cell for "display-grade" rendering (no icons), sharing the same heuristics as
 * `FormattedCell.svelte`.
 */
export function formatCellForDisplay(value: unknown, format: ColumnFormat): FormattedCell {
	if (value === null || value === undefined) return { text: '—' };

	const plainText = formatCellPlainText(value);

	switch (format.kind) {
		case 'boolean':
			return { text: value ? 'true' : 'false' };
		case 'id':
			return { text: truncateMiddle(plainText) };
		case 'email':
		case 'url':
			return { text: plainText };
		case 'date':
		case 'datetime': {
			const d = typeof value === 'number' ? parseEpochDate(value) : parseDate(value);
			if (!d) return { text: plainText };
			return {
				text: format.kind === 'datetime' ? datetimeFmt.format(d) : dateFmt.format(d)
			};
		}
		case 'percentage': {
			const n = coerceNumber(value);
			return { text: n === null ? plainText : `${n.toFixed(1)}%` };
		}
		case 'currency': {
			const n = coerceNumber(value);
			if (n === null) return { text: plainText };
			const code = CURRENCY_CODE_BY_SYMBOL[format.currencySymbol ?? '$'] ?? 'USD';
			return {
				text: new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n)
			};
		}
		case 'number': {
			const n = coerceNumber(value);
			return {
				text:
					n === null
						? plainText
						: new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)
			};
		}
		case 'category': {
			return { text: plainText, categorySeed: paletteSeedForValue(plainText) };
		}
		case 'text':
		default:
			return { text: plainText };
	}
}
