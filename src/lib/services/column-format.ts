import { coerceNumber } from '$lib/utils';

export type ColumnFormatKind =
	| 'boolean'
	| 'id'
	| 'email'
	| 'url'
	| 'datetime'
	| 'date'
	| 'percentage'
	| 'currency'
	| 'number'
	| 'category'
	| 'text';

export interface ColumnFormat {
	kind: ColumnFormatKind;
	/** For 'category': stable palette index 0-4, derived from a hash of the column name. */
	paletteSeed?: number;
	/** For 'currency': detected symbol, default '$'. */
	currencySymbol?: string;
}

const ID_NAME_RE = /(^|_)(id|uuid|guid)$/i;
const EMAIL_NAME_RE = /email/i;
const EMAIL_VALUE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const URL_NAME_RE = /url|link|website|^uri$/i;
const URL_VALUE_RE = /^(https?:\/\/|www\.)/i;
const DATETIME_VALUE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;
const EPOCH_MS_RE = /^1\d{12}$/;
const EPOCH_S_RE = /^1\d{9}$/;
const PERCENTAGE_NAME_RE = /percent|_?pct$/i;
const PERCENTAGE_VALUE_RE = /%$/;
const CURRENCY_NAME_RE = /amount|price|cost|revenue|sales|income|fee|balance|salary|paid/i;
const CURRENCY_VALUE_RE = /[$€£¥₦₵₹]/;

function ratio(hits: number, total: number): number {
	return total > 0 ? hits / total : 0;
}

function paletteSeedFor(col: string): number {
	let h = 0;
	for (let i = 0; i < col.length; i++) h = (h * 31 + col.charCodeAt(i)) | 0;
	return Math.abs(h) % 5;
}

function detectCurrencySymbol(samples: unknown[]): string | undefined {
	const counts = new Map<string, number>();
	for (const v of samples) {
		const m = String(v).match(CURRENCY_VALUE_RE);
		if (m) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
	}
	let best: string | undefined;
	let bestCount = 0;
	for (const [sym, count] of counts) {
		if (count > bestCount) {
			best = sym;
			bestCount = count;
		}
	}
	return best;
}

function isEpochLike(v: unknown): boolean {
	const s = String(v).trim();
	return EPOCH_MS_RE.test(s) || EPOCH_S_RE.test(s);
}

export function detectColumnFormat(rows: Record<string, unknown>[], col: string): ColumnFormat {
	const samples = rows
		.map((r) => r[col])
		.filter((v) => v !== null && v !== undefined)
		.slice(0, 50);

	if (samples.length === 0) return { kind: 'text' };

	// 1. boolean — strict, no string coercion
	if (samples.every((v) => typeof v === 'boolean')) return { kind: 'boolean' };

	const stringSamples = samples.map((v) => String(v).trim());

	// 2. id — name-based, gated by cardinality so it doesn't misfire on small results
	if (ID_NAME_RE.test(col)) {
		const nonNull = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
		const distinct = new Set(nonNull.map(String)).size;
		const cardinalityRatio = ratio(distinct, nonNull.length);
		if (rows.length < 5 || cardinalityRatio >= 0.9) return { kind: 'id' };
	}

	// 3. email
	const emailHits = stringSamples.filter((s) => EMAIL_VALUE_RE.test(s)).length;
	if (EMAIL_NAME_RE.test(col) || ratio(emailHits, stringSamples.length) >= 0.7) {
		return { kind: 'email' };
	}

	// 4. url
	const urlHits = stringSamples.filter((s) => URL_VALUE_RE.test(s)).length;
	if (URL_NAME_RE.test(col) || ratio(urlHits, stringSamples.length) >= 0.7) {
		return { kind: 'url' };
	}

	// 5. datetime / date
	const isDateInstance = samples.some((v) => v instanceof Date);
	const dateHits = stringSamples.filter((s) => DATE_PREFIX_RE.test(s)).length;
	const epochHits = stringSamples.filter((s) => isEpochLike(s)).length;
	if (isDateInstance || ratio(dateHits, stringSamples.length) >= 0.7 || ratio(epochHits, stringSamples.length) >= 0.7) {
		const hasTimeComponent =
			samples.some((v) => v instanceof Date && (v.getUTCHours() !== 0 || v.getUTCMinutes() !== 0)) ||
			stringSamples.some((s) => DATETIME_VALUE_RE.test(s)) ||
			ratio(epochHits, stringSamples.length) >= 0.7;
		return { kind: hasTimeComponent ? 'datetime' : 'date' };
	}

	// 6. percentage — checked before currency/number so '%' isn't claimed as a plain number
	const percentHits = stringSamples.filter((s) => PERCENTAGE_VALUE_RE.test(s)).length;
	if (PERCENTAGE_NAME_RE.test(col) || ratio(percentHits, stringSamples.length) >= 0.7) {
		return { kind: 'percentage' };
	}

	// 7. currency
	const currencyValueHits = stringSamples.filter((s) => CURRENCY_VALUE_RE.test(s)).length;
	const numericHits = samples.filter((v) => coerceNumber(v) !== null).length;
	const looksNumericEnough = ratio(numericHits, samples.length) >= 0.7;
	if (
		looksNumericEnough &&
		(CURRENCY_NAME_RE.test(col) || ratio(currencyValueHits, stringSamples.length) >= 0.7)
	) {
		return { kind: 'currency', currencySymbol: detectCurrencySymbol(samples) ?? '$' };
	}

	// 8. number
	if (looksNumericEnough) return { kind: 'number' };

	// 9. category — low-cardinality text relative to row count
	const nonNull = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
	const distinct = new Set(nonNull.map(String)).size;
	if (distinct <= 20 && ratio(distinct, nonNull.length) <= 0.5) {
		return { kind: 'category', paletteSeed: paletteSeedFor(col) };
	}

	// 10. text — fallback
	return { kind: 'text' };
}

export function truncateMiddle(s: string, edge = 6): string {
	if (s.length <= edge * 2 + 1) return s;
	return `${s.slice(0, edge)}…${s.slice(-edge)}`;
}
