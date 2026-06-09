export type SemanticColumnKind = 'numeric' | 'date' | 'boolean' | 'text';

export interface SemanticDeriveColumn {
	name: string;
	kind: SemanticColumnKind;
	semanticType?: string;
	confidence?: number;
	nullRatio: number;
	distinctCount: number;
}

export type DerivePattern =
	| 'composed_metric'
	| 'flow_delta'
	| 'efficiency_ratio'
	| 'temporal_metric'
	| 'segment_metric';

export type DeriveExpressionClass =
	| 'multiply'
	| 'subtract'
	| 'divide'
	| 'bucket_aggregate'
	| 'group_aggregate';

export interface SemanticDeriveCandidate {
	pattern: DerivePattern;
	expressionClass: DeriveExpressionClass;
	outputName: string;
	leftColumn: string;
	rightColumn: string;
	quality: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function isIdentifierLikeName(name: string): boolean {
	const lowered = name.trim().toLowerCase();
	return /(^id$|_id$|uuid|guid|identifier|\bpk\b|\bfk\b)/i.test(lowered);
}

function isTemporalLikeName(name: string): boolean {
	return /(date|time|timestamp|_at$|created|updated|event)/i.test(name);
}

function semanticScore(column: SemanticDeriveColumn): number {
	const confidence = clamp(column.confidence ?? 0.45, 0, 1);
	const quality = (1 - clamp(column.nullRatio, 0, 1)) * 0.56 + confidence * 0.44;
	const cardinality = (() => {
		if (column.distinctCount <= 1) return 0.2;
		if (column.distinctCount <= 6) return 0.6;
		if (column.distinctCount <= 600) return 1;
		return 0.82;
	})();
	return clamp(quality * 0.78 + cardinality * 0.22, 0, 1);
}

function semanticMatch(column: SemanticDeriveColumn, semanticTypes: string[], fallbackNamePattern: RegExp): boolean {
	const semantic = (column.semanticType ?? '').trim().toLowerCase();
	if (semantic && semanticTypes.includes(semantic)) return true;
	return fallbackNamePattern.test(column.name);
}

function bestCandidate(
	columns: SemanticDeriveColumn[],
	semanticTypes: string[],
	fallbackNamePattern: RegExp,
	exclude = new Set<string>()
): SemanticDeriveColumn | null {
	const ranked = columns
		.filter((column) => !exclude.has(column.name))
		.filter((column) => column.kind === 'numeric' || semanticTypes.includes((column.semanticType ?? '').toLowerCase()))
		.filter((column) => !isIdentifierLikeName(column.name))
		.filter((column) => semanticMatch(column, semanticTypes, fallbackNamePattern))
		.sort((a, b) => semanticScore(b) - semanticScore(a));
	return ranked[0] ?? null;
}

function quality(left: SemanticDeriveColumn, right: SemanticDeriveColumn): number {
	const leftScore = semanticScore(left);
	const rightScore = semanticScore(right);
	const sameKindBonus = left.kind === right.kind ? 0.05 : 0;
	return clamp((leftScore + rightScore) / 2 + sameKindBonus, 0, 1);
}

function addCandidate(
	out: SemanticDeriveCandidate[],
	seen: Set<string>,
	candidate: SemanticDeriveCandidate | null
): void {
	if (!candidate) return;
	const key = `${candidate.pattern}|${candidate.leftColumn}|${candidate.rightColumn}`;
	if (seen.has(key)) return;
	seen.add(key);
	out.push(candidate);
}

export function findSemanticDeriveCandidates(columns: SemanticDeriveColumn[]): SemanticDeriveCandidate[] {
	if (columns.length === 0) return [];
	const candidates: SemanticDeriveCandidate[] = [];
	const seen = new Set<string>();

	const multiplicativeLeft = bestCandidate(
		columns,
		['unit_price', 'currency_amount', 'amount', 'metric', 'inflow', 'outflow'],
		/price|unit.?price|cost|amount|rate|fee|charge|value|revenue|sales/i
	);
	const multiplicativeRight = bestCandidate(
		columns,
		['quantity', 'count', 'volume_measure', 'denominator'],
		/units?|qty|quantit|count|sold|volume|items?|pieces?/i,
		new Set(multiplicativeLeft ? [multiplicativeLeft.name] : [])
	);
	addCandidate(
		candidates,
		seen,
		multiplicativeLeft && multiplicativeRight
			? {
				pattern: 'composed_metric',
				expressionClass: 'multiply',
				outputName: 'revenue',
				leftColumn: multiplicativeLeft.name,
				rightColumn: multiplicativeRight.name,
				quality: quality(multiplicativeLeft, multiplicativeRight)
			}
			: null
	);

	const inflow = bestCandidate(columns, ['inflow'], /paid\s*in|inflow|deposit|credited|received|credit/i);
	const outflow = bestCandidate(
		columns,
		['outflow'],
		/withdrawn|outflow|debited|spent|payment|charge|debit/i,
		new Set(inflow ? [inflow.name] : [])
	);
	addCandidate(
		candidates,
		seen,
		inflow && outflow
			? {
				pattern: 'flow_delta',
				expressionClass: 'subtract',
				outputName: 'net_flow',
				leftColumn: inflow.name,
				rightColumn: outflow.name,
				quality: quality(inflow, outflow)
			}
			: null
	);

	const numerator = bestCandidate(
		columns,
		['numerator', 'metric', 'amount', 'currency_amount', 'inflow'],
		/numerator|success|wins?|converted|completed|revenue|sales|amount/i
	);
	const denominator = bestCandidate(
		columns,
		['denominator', 'count', 'quantity', 'volume_measure'],
		/denominator|denom|total|base|attempts?|eligible|population|count|qty|quantity/i,
		new Set(numerator ? [numerator.name] : [])
	);
	addCandidate(
		candidates,
		seen,
		numerator && denominator
			? {
				pattern: 'efficiency_ratio',
				expressionClass: 'divide',
				outputName: 'efficiency_ratio',
				leftColumn: numerator.name,
				rightColumn: denominator.name,
				quality: quality(numerator, denominator)
			}
			: null
	);

	const temporal = bestCandidate(
		columns,
		['event_time', 'updated_at', 'created_at', 'date'],
		/date|time|timestamp|_at$|created|updated|event/i
	);
	const temporalMetric = bestCandidate(
		columns,
		['unit_price', 'currency_amount', 'amount', 'metric', 'quantity', 'count', 'inflow', 'outflow'],
		/amount|price|cost|revenue|value|qty|count|volume|inflow|outflow/i,
		new Set(temporal ? [temporal.name] : [])
	);
	addCandidate(
		candidates,
		seen,
		temporal && temporalMetric
			? {
				pattern: 'temporal_metric',
				expressionClass: 'bucket_aggregate',
				outputName: 'metric_over_time',
				leftColumn: temporal.name,
				rightColumn: temporalMetric.name,
				quality: quality(temporal, temporalMetric)
			}
			: null
	);

	const segment = bestCandidate(
		columns,
		['category', 'status', 'region', 'country', 'city', 'entity_name'],
		/category|segment|group|channel|region|country|city|status|type|customer|vendor|merchant|product/i
	);
	const segmentedMetric = bestCandidate(
		columns,
		['unit_price', 'currency_amount', 'amount', 'metric', 'quantity', 'count', 'inflow', 'outflow'],
		/amount|price|cost|revenue|value|qty|count|volume|inflow|outflow/i,
		new Set(segment ? [segment.name] : [])
	);
	addCandidate(
		candidates,
		seen,
		segment && segmentedMetric
			? {
				pattern: 'segment_metric',
				expressionClass: 'group_aggregate',
				outputName: 'metric_by_segment',
				leftColumn: segment.name,
				rightColumn: segmentedMetric.name,
				quality: quality(segment, segmentedMetric)
			}
			: null
	);

	return candidates.sort((a, b) => b.quality - a.quality);
}

export function findTopDeriveCandidate(
	columns: SemanticDeriveColumn[],
	pattern: DerivePattern
): SemanticDeriveCandidate | null {
	return findSemanticDeriveCandidates(columns).find((candidate) => candidate.pattern === pattern) ?? null;
}
