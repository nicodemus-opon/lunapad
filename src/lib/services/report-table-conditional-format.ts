import { coerceNumber } from '$lib/utils';

export type ConditionalTone = 'positive' | 'negative' | 'warning' | 'info' | 'neutral';
export type ConditionalIcon = 'up' | 'down' | 'flat' | 'alert' | 'check';
export type ConditionalRuleType = 'threshold' | 'colorScale' | 'dataBar' | 'iconSet';

export type ThresholdOp =
	| '<'
	| '<='
	| '='
	| '!='
	| '>='
	| '>'
	| 'between'
	| 'contains'
	| 'is-null'
	| 'is-not-null';

export interface ThresholdRule {
	id: string;
	type: 'threshold';
	op: ThresholdOp;
	value?: string | number | boolean | null;
	value2?: string | number | boolean | null;
	tone?: ConditionalTone;
	icon?: ConditionalIcon;
}

export interface ColorScaleRule {
	id: string;
	type: 'colorScale';
	minColor?: ConditionalTone;
	midColor?: ConditionalTone;
	maxColor?: ConditionalTone;
	min?: number | null;
	max?: number | null;
	mid?: number | null;
}

export interface DataBarRule {
	id: string;
	type: 'dataBar';
	tone?: ConditionalTone;
	/** Optional explicit domain */
	min?: number | null;
	max?: number | null;
}

export interface IconSetRule {
	id: string;
	type: 'iconSet';
	negativeTone?: ConditionalTone;
	positiveTone?: ConditionalTone;
	neutralTone?: ConditionalTone;
}

export type ReportTableConditionalRule = ThresholdRule | ColorScaleRule | DataBarRule | IconSetRule;

export interface CellConditionalStyle {
	tone?: ConditionalTone;
	textTone?: ConditionalTone;
	backgroundAlpha?: number;
	icon?: ConditionalIcon;
	dataBar?: {
		percent: number;
		direction: 'positive' | 'negative';
	};
}

export type ColumnConditionalRules = Record<string, ReportTableConditionalRule[]>;

export interface NumericDomain {
	min: number;
	max: number;
}

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

function computeNumericDomain(rows: Record<string, unknown>[], col: string): NumericDomain | null {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const row of rows) {
		const n = coerceNumber(row[col]);
		if (n === null) continue;
		if (n < min) min = n;
		if (n > max) max = n;
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
	return { min, max };
}

function toComparableString(v: unknown): string {
	if (v === null || v === undefined) return '';
	return String(v).trim().toLowerCase();
}

function thresholdMatches(value: unknown, rule: ThresholdRule): boolean {
	if (rule.op === 'is-null') return value === null || value === undefined;
	if (rule.op === 'is-not-null') return value !== null && value !== undefined;

	if (value === null || value === undefined) return false;

	if (rule.op === 'contains') {
		const hay = toComparableString(value);
		const needle = toComparableString(rule.value);
		return needle.length > 0 && hay.includes(needle);
	}

	const valueNum = coerceNumber(value);
	const testNum = coerceNumber(rule.value);
	const testNum2 = coerceNumber(rule.value2);

	if (valueNum !== null && testNum !== null) {
		switch (rule.op) {
			case '<':
				return valueNum < testNum;
			case '<=':
				return valueNum <= testNum;
			case '=':
				return valueNum === testNum;
			case '!=':
				return valueNum !== testNum;
			case '>=':
				return valueNum >= testNum;
			case '>':
				return valueNum > testNum;
			case 'between':
				if (testNum2 === null) return false;
				return valueNum >= Math.min(testNum, testNum2) && valueNum <= Math.max(testNum, testNum2);
			default:
				return false;
		}
	}

	const v = toComparableString(value);
	const t = toComparableString(rule.value);
	switch (rule.op) {
		case '=':
			return v === t;
		case '!=':
			return v !== t;
		default:
			return false;
	}
}

function toneForScale(
	normalized: number,
	minColor: ConditionalTone,
	midColor: ConditionalTone,
	maxColor: ConditionalTone
): ConditionalTone {
	if (normalized <= 0.33) return minColor;
	if (normalized >= 0.67) return maxColor;
	return midColor;
}

function mergeStyles(base: CellConditionalStyle, incoming: CellConditionalStyle): CellConditionalStyle {
	return {
		tone: incoming.tone ?? base.tone,
		textTone: incoming.textTone ?? base.textTone,
		backgroundAlpha: incoming.backgroundAlpha ?? base.backgroundAlpha,
		icon: incoming.icon ?? base.icon,
		dataBar: incoming.dataBar ?? base.dataBar
	};
}

export function evaluateConditionalCellStyle(
	value: unknown,
	rules: ReportTableConditionalRule[] | undefined,
	ctx: {
		rows: Record<string, unknown>[];
		columnId: string;
		domainCache?: Map<string, NumericDomain | null>;
	}
): CellConditionalStyle | null {
	if (!rules || rules.length === 0) return null;

	let style: CellConditionalStyle = {};
	const domainCache = ctx.domainCache ?? new Map<string, NumericDomain | null>();

	for (const rule of rules) {
		if (rule.type === 'threshold') {
			if (!thresholdMatches(value, rule)) continue;
			style = mergeStyles(style, {
				tone: rule.tone ?? style.tone,
				textTone: rule.tone ?? style.textTone,
				backgroundAlpha: 0.14,
				icon: rule.icon
			});
			continue;
		}

		const n = coerceNumber(value);
		if (n === null) continue;

		let domain = domainCache.get(ctx.columnId);
		if (domain === undefined) {
			domain = computeNumericDomain(ctx.rows, ctx.columnId);
			domainCache.set(ctx.columnId, domain);
		}
		if (!domain) continue;

		if (rule.type === 'colorScale') {
			const min = rule.min ?? domain.min;
			const max = rule.max ?? domain.max;
			if (max === min) continue;
			const normalized = clamp01((n - min) / (max - min));
			const tone = toneForScale(
				normalized,
				rule.minColor ?? 'negative',
				rule.midColor ?? 'warning',
				rule.maxColor ?? 'positive'
			);
			style = mergeStyles(style, {
				tone,
				textTone: tone,
				backgroundAlpha: 0.12 + normalized * 0.1
			});
			continue;
		}

		if (rule.type === 'dataBar') {
			const min = rule.min ?? domain.min;
			const max = rule.max ?? domain.max;
			const extent = Math.max(Math.abs(min), Math.abs(max), 1);
			const percent = clamp01(Math.abs(n) / extent);
			style = mergeStyles(style, {
				tone: rule.tone ?? (n < 0 ? 'negative' : 'positive'),
				dataBar: {
					percent,
					direction: n < 0 ? 'negative' : 'positive'
				}
			});
			continue;
		}

		if (rule.type === 'iconSet') {
			const icon: ConditionalIcon = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
			const tone =
				n > 0
					? (rule.positiveTone ?? 'positive')
					: n < 0
						? (rule.negativeTone ?? 'negative')
						: (rule.neutralTone ?? 'neutral');
			style = mergeStyles(style, {
				tone,
				textTone: tone,
				icon
			});
		}
	}

	return Object.keys(style).length ? style : null;
}

export function conditionalToneToCssVar(tone: ConditionalTone): string {
	switch (tone) {
		case 'positive':
			return 'var(--table-positive, oklch(0.73 0.17 150))';
		case 'negative':
			return 'var(--table-negative, oklch(0.67 0.2 25))';
		case 'warning':
			return 'var(--warning)';
		case 'info':
			return 'var(--primary)';
		case 'neutral':
		default:
			return 'var(--muted-foreground)';
	}
}

export function defaultConditionalRulesForColumn(col: string): ReportTableConditionalRule[] {
	const name = col.toLowerCase();
	if (/(amount|price|cost|revenue|income|balance|paid|withdrawn|delta|change|pct|percent|rate)/i.test(name)) {
		return [
			{
				id: `${col}:neg`,
				type: 'threshold',
				op: '<',
				value: 0,
				tone: 'negative',
				icon: 'down'
			},
			{
				id: `${col}:bar`,
				type: 'dataBar',
				tone: 'info'
			}
		];
	}
	return [
		{
			id: `${col}:null`,
			type: 'threshold',
			op: 'is-null',
			tone: 'warning',
			icon: 'alert'
		}
	];
}

