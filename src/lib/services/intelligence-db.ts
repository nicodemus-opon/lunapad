import { executeSQL, initDB, loadRowsForProfiling, dropProfileTable } from '$lib/services/duckdb';
import { BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';
import {
	getQuickChips,
	makePresetStages,
	recommendPresets,
	type CoercionDialect,
	type HydratedSuggestionMetadata,
	type PresetColumnProfile,
	type QuickChip,
	type StagePresetSuggestion
} from '$lib/services/stage-catalog';
import {
	findSemanticDeriveCandidates,
	findTopDeriveCandidate,
	type SemanticDeriveColumn
} from '$lib/services/semantic-derive';
import { hydrateSemanticTemplateBundles } from '$lib/services/semantic-template-bundles';
import type { UploadedTable } from '$lib/stores/notebook.svelte';
import type { ChartType, GUIPipelineStage, StageType } from '$lib/types/gui-pipeline';

const META_SCHEMA = '_lunapad_metadata';
let metaReady = false;

function quoteLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function nowMs(): number {
	return Date.now();
}

function normalizeKind(typeName: string): 'numeric' | 'date' | 'boolean' | 'text' {
	const lower = typeName.toLowerCase();
	if (/(tinyint|smallint|int|bigint|hugeint|decimal|numeric|double|float|real)/.test(lower)) return 'numeric';
	if (/(date|time|timestamp)/.test(lower)) return 'date';
	if (/(bool)/.test(lower)) return 'boolean';
	return 'text';
}

type ColumnSemanticType =
	| 'id'
	| 'foreign_key'
	| 'session_id'
	| 'source_id'
	| 'target_id'
	| 'parent_id'
	| 'entity_name'
	| 'category'
	| 'status'
	| 'flag'
	| 'event_type'
	| 'binary_outcome'
	| 'ordinal_rank'
	| 'created_at'
	| 'updated_at'
	| 'event_time'
	| 'date'
	| 'amount'
	| 'currency_amount'
	| 'unit_price'
	| 'inflow'
	| 'outflow'
	| 'numerator'
	| 'denominator'
	| 'currency_code'
	| 'percentage'
	| 'ratio'
	| 'count'
	| 'quantity'
	| 'volume_measure'
	| 'duration'
	| 'email'
	| 'phone'
	| 'url'
	| 'country'
	| 'region'
	| 'city'
	| 'latitude'
	| 'longitude'
	| 'postal_code'
	| 'geo_point'
	| 'media_url'
	| 'media_path'
	| 'media_extension'
	| 'json_blob'
	| 'description'
	| 'code'
	| 'metric'
	| 'text';

const GENERIC_PRESET_LABELS = new Set([
	'Temporal trend rollup',
	'Seasonal pattern detector',
	'Drift monitor'
]);

interface SemanticInference {
	semanticType: ColumnSemanticType;
	signature: string;
	confidence: number;
}

interface ColumnSemanticSnapshot {
	columnName: string;
	dataKind: 'numeric' | 'date' | 'boolean' | 'text';
	semanticType: ColumnSemanticType;
	confidence: number;
	nullRatio: number;
	distinctCount: number;
	sampleValues: string[];
}

interface SignatureEntry {
	type: 'column' | 'pair' | 'triplet' | 'quad' | 'semantic' | 'lexical' | 'schema' | 'derive';
	key: string;
}

export interface IntelligentChartRecommendation {
	chartType: ChartType;
	reason: string;
	confidence: number;
	signature?: string;
	xColumn?: string;
	yColumns?: string[];
	colorColumn?: string | null;
	sizeColumn?: string | null;
	seriesMode?: 'auto' | 'grouped' | 'stacked';
}

const DEFAULT_SEMANTIC_SYNONYMS: Array<{ token: string; canonical: string; semanticHint: ColumnSemanticType; weight: number }> = [
	{ token: 'gmv', canonical: 'revenue', semanticHint: 'amount', weight: 0.95 },
	{ token: 'arr', canonical: 'revenue', semanticHint: 'amount', weight: 0.92 },
	{ token: 'mrr', canonical: 'revenue', semanticHint: 'amount', weight: 0.92 },
	{ token: 'mrp', canonical: 'unit_price', semanticHint: 'unit_price', weight: 0.9 },
	{ token: 'amt', canonical: 'amount', semanticHint: 'amount', weight: 0.9 },
	{ token: 'qty', canonical: 'quantity', semanticHint: 'quantity', weight: 0.9 },
	{ token: 'vol', canonical: 'volume', semanticHint: 'volume_measure', weight: 0.86 },
	{ token: 'cnt', canonical: 'count', semanticHint: 'count', weight: 0.9 },
	{ token: 'in', canonical: 'inflow', semanticHint: 'inflow', weight: 0.75 },
	{ token: 'out', canonical: 'outflow', semanticHint: 'outflow', weight: 0.75 },
	{ token: 'ts', canonical: 'timestamp', semanticHint: 'date', weight: 0.86 },
	{ token: 'dt', canonical: 'date', semanticHint: 'date', weight: 0.86 },
	{ token: 'zip', canonical: 'postal_code', semanticHint: 'postal_code', weight: 0.84 },
	{ token: 'lat', canonical: 'latitude', semanticHint: 'latitude', weight: 0.86 },
	{ token: 'lon', canonical: 'longitude', semanticHint: 'longitude', weight: 0.86 },
	{ token: 'geo', canonical: 'region', semanticHint: 'region', weight: 0.84 },
	{ token: 'lng', canonical: 'longitude', semanticHint: 'longitude', weight: 0.84 },
	{ token: 'img', canonical: 'image', semanticHint: 'media_url', weight: 0.82 },
	{ token: 'photo', canonical: 'image', semanticHint: 'media_url', weight: 0.8 },
	{ token: 'thumb', canonical: 'thumbnail', semanticHint: 'media_url', weight: 0.8 },
	{ token: 'asset', canonical: 'asset_path', semanticHint: 'media_path', weight: 0.8 },
	{ token: 'evt', canonical: 'event', semanticHint: 'event_type', weight: 0.8 },
	{ token: 'sid', canonical: 'session', semanticHint: 'session_id', weight: 0.83 },
	{ token: 'cust', canonical: 'customer', semanticHint: 'entity_name', weight: 0.8 },
	{ token: 'acct', canonical: 'account', semanticHint: 'entity_name', weight: 0.78 },
	{ token: 'churn', canonical: 'status', semanticHint: 'status', weight: 0.75 },
	{ token: 'urn', canonical: 'status', semanticHint: 'status', weight: 0.73 }
];

const IDENTIFIER_TOKENS = new Set(['id', 'uuid', 'guid', 'identifier', 'key', 'pk', 'fk', 'no', 'nr', 'ref', 'code', 'sku', 'serial']);

const COLUMN_SEMANTIC_CATALOG: Array<{
	type: ColumnSemanticType;
	kinds: Array<'numeric' | 'date' | 'boolean' | 'text'>;
	namePatterns: RegExp[];
	samplePatterns?: RegExp[];
	priority: number;
}> = [
	{ type: 'id', kinds: ['numeric', 'text'], namePatterns: [/^id$/i, /(^|_)(id|uuid|guid|identifier)$/i], priority: 120 },
	{ type: 'session_id', kinds: ['numeric', 'text'], namePatterns: [/(^|_)(session|sess|visit)_id$/i], priority: 119 },
	{ type: 'source_id', kinds: ['numeric', 'text'], namePatterns: [/(^|_)(source|src|from)_id$/i], priority: 118 },
	{ type: 'target_id', kinds: ['numeric', 'text'], namePatterns: [/(^|_)(target|dst|to)_id$/i], priority: 118 },
	{ type: 'parent_id', kinds: ['numeric', 'text'], namePatterns: [/(^|_)(parent|ancestor|root)_id$/i], priority: 118 },
	{ type: 'foreign_key', kinds: ['numeric', 'text'], namePatterns: [/_id$/i, /(^|_)(fk|foreign|key|ref|reference)$/i, /(customer|account|company|collection|user|owner|parent)_id$/i], priority: 116 },
	{ type: 'created_at', kinds: ['date', 'text', 'numeric'], namePatterns: [/created(_at|at)?$/i, /ingested(_at|at)?$/i, /(inserted|loaded)(_at|at)?$/i, /created/i], priority: 115 },
	{ type: 'updated_at', kinds: ['date', 'text', 'numeric'], namePatterns: [/updated(_at|at)?$/i, /modified(_at|at)?$/i, /(changed|edited)(_at|at)?$/i], priority: 114 },
	{ type: 'event_time', kinds: ['date', 'text', 'numeric'], namePatterns: [/event(_at|at|_time|time)?$/i, /occurred(_at|at)?$/i, /happened(_at|at)?$/i, /completion.?time/i, /timestamp/i], samplePatterns: [/^\d{4}-\d{2}-\d{2}/, /^1\d{12}$/, /^1\d{9}$/], priority: 113 },
	{ type: 'event_type', kinds: ['text'], namePatterns: [/event(_type|type)?$/i, /action(_type)?$/i, /verb$/i, /activity(_type)?$/i], priority: 96 },
	{ type: 'date', kinds: ['date', 'text', 'numeric'], namePatterns: [/date|time|timestamp|day|week|month|year/i], samplePatterns: [/^\d{4}-\d{2}-\d{2}/, /^1\d{12}$/, /^1\d{9}$/], priority: 110 },
	{ type: 'email', kinds: ['text'], namePatterns: [/email/i], samplePatterns: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/i], priority: 109 },
	{ type: 'phone', kinds: ['text'], namePatterns: [/phone|mobile|tel/i], samplePatterns: [/^\+?[0-9().\-\s]{7,}$/], priority: 108 },
	{ type: 'postal_code', kinds: ['text', 'numeric'], namePatterns: [/zip|postal|postcode/i], samplePatterns: [/^[A-Z0-9\-\s]{3,12}$/i], priority: 107 },
	{ type: 'latitude', kinds: ['numeric', 'text'], namePatterns: [/(^|_)(lat|latitude)$/i], samplePatterns: [/^-?(?:[0-8]?\d(?:\.\d+)?|90(?:\.0+)?)$/], priority: 104 },
	{ type: 'longitude', kinds: ['numeric', 'text'], namePatterns: [/(^|_)(lon|lng|longitude|long)$/i], samplePatterns: [/^-?(?:1[0-7]\d(?:\.\d+)?|[0-9]?\d(?:\.\d+)?|180(?:\.0+)?)$/], priority: 104 },
	{ type: 'geo_point', kinds: ['text', 'numeric'], namePatterns: [/lat|lng|lon|long|latitude|longitude|geopoint|geo_point/i], priority: 106 },
	{ type: 'media_url', kinds: ['text'], namePatterns: [/image(_url)?|thumbnail(_url)?|avatar(_url)?|media(_url)?|video(_url)?|audio(_url)?|cdn(_url)?/i], samplePatterns: [/^https?:\/\//i, /^s3:\/\//i, /^gs:\/\//i], priority: 112 },
	{ type: 'media_path', kinds: ['text'], namePatterns: [/file(_path)?|asset(_path)?|object_key|blob_key|media_path|image_path|video_path|audio_path/i], samplePatterns: [/\.(png|jpe?g|gif|webp|svg|mp4|mov|mp3|wav|pdf|docx?)$/i, /\//], priority: 94 },
	{ type: 'media_extension', kinds: ['text'], namePatterns: [/ext|extension|file_type|mime|mime_type/i], samplePatterns: [/^(png|jpe?g|gif|webp|svg|mp4|mov|mp3|wav|pdf|docx?)$/i], priority: 92 },
	{ type: 'url', kinds: ['text'], namePatterns: [/url|link|website|uri|slug/i], samplePatterns: [/^https?:\/\//i, /^www\./i], priority: 97 },
	{ type: 'country', kinds: ['text'], namePatterns: [/country|nation/i], priority: 106 },
	{ type: 'region', kinds: ['text'], namePatterns: [/region|state|province|territory|district/i], priority: 105 },
	{ type: 'city', kinds: ['text'], namePatterns: [/city|town|municipality/i], priority: 104 },
	{ type: 'currency_code', kinds: ['text'], namePatterns: [/currency|ccy|iso_currency/i], samplePatterns: [/^[A-Z]{3}$/], priority: 103 },
	{ type: 'inflow', kinds: ['numeric', 'text'], namePatterns: [/inflow|paid\s*in|deposit|credited|credit(_amount)?|received/i], priority: 103 },
	{ type: 'outflow', kinds: ['numeric', 'text'], namePatterns: [/outflow|withdrawn|debit(ed)?|spent|payment|charge(d)?|fee(_amount)?/i], priority: 103 },
	{ type: 'unit_price', kinds: ['numeric', 'text'], namePatterns: [/unit.?price|price_per|per_unit|cost_per|rate_per/i], priority: 103 },
	{ type: 'currency_amount', kinds: ['numeric', 'text'], namePatterns: [/amount|revenue|sales|income|gmv|arr|mrr|acv|balance/i], priority: 102 },
	{ type: 'amount', kinds: ['numeric', 'text'], namePatterns: [/amount|price|cost|revenue|sales|income|fee|balance|paid|withdrawn|withdrawal|deposit|credited|debited|disbursed|remitted|gmv|arr|mrr|acv/i], priority: 102 },
	{ type: 'percentage', kinds: ['numeric', 'text'], namePatterns: [/percent|pct/i], priority: 101 },
	{ type: 'numerator', kinds: ['numeric', 'text'], namePatterns: [/numerator|num(erator)?_value|success|wins?|converted|completed/i], priority: 101 },
	{ type: 'denominator', kinds: ['numeric', 'text'], namePatterns: [/denominator|denom|total|base|attempts?|eligible|population/i], priority: 100 },
	{ type: 'ratio', kinds: ['numeric', 'text'], namePatterns: [/ratio|rate|per_/i], priority: 100 },
	{ type: 'count', kinds: ['numeric', 'text'], namePatterns: [/count|num|total|records|rows|visits|sessions|hits/i], priority: 98 },
	{ type: 'quantity', kinds: ['numeric', 'text'], namePatterns: [/qty|quantity|units|volume|stock/i], priority: 97 },
	{ type: 'volume_measure', kinds: ['numeric', 'text'], namePatterns: [/volume|liters?|gallons?|kg|grams?|tons?|units?_volume/i], priority: 97 },
	{ type: 'duration', kinds: ['numeric', 'text'], namePatterns: [/duration|latency|seconds|minutes|hours|ms|millis|elapsed/i], priority: 96 },
	{ type: 'status', kinds: ['text'], namePatterns: [/status|state|lifecycle|phase|stage|transaction.?status/i], priority: 95 },
	{ type: 'binary_outcome', kinds: ['boolean', 'text', 'numeric'], namePatterns: [/is_(converted|churned|fraud|active|success|recovered)|converted|churned|recovered|approved|rejected|won|lost/i], priority: 92 },
	{ type: 'flag', kinds: ['boolean', 'text'], namePatterns: [/is_|has_|flag|enabled|active/i], priority: 94 },
	{ type: 'ordinal_rank', kinds: ['numeric', 'text'], namePatterns: [/rank|rating|grade|tier|severity|priority|satisfaction|nps|score_band/i], priority: 91 },
	{ type: 'category', kinds: ['text'], namePatterns: [/category|segment|type|group|channel|source|bucket|genre|sub_?genre|mood|style|tag|tags/i], priority: 93 },
	{ type: 'entity_name', kinds: ['text'], namePatterns: [/name|title|label|customer|account|company|vendor|product|merchant|payee|recipient/i], priority: 92 },
	{ type: 'description', kinds: ['text'], namePatterns: [/description|summary|notes|comment|detail(s)?|memo|narrative/i], priority: 91 },
	{ type: 'json_blob', kinds: ['text'], namePatterns: [/json|payload|metadata/i], samplePatterns: [/^\s*\{/, /^\s*\[/], priority: 90 },
	{ type: 'code', kinds: ['text'], namePatterns: [/code|sku|ref|reference|token|identifier|receipt|receipt.?no/i], priority: 89 },
	{ type: 'metric', kinds: ['numeric'], namePatterns: [/metric|score|index|kpi/i], priority: 88 }
];

function normalizeConfidence(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

function confidenceBucket(value: number): string {
	if (value >= 0.85) return 'very-high';
	if (value >= 0.7) return 'high';
	if (value >= 0.5) return 'medium';
	if (value >= 0.3) return 'low';
	return 'very-low';
}

function bucketNullRatio(value: number): string {
	if (value <= 0.01) return 'none';
	if (value <= 0.1) return 'low';
	if (value <= 0.35) return 'medium';
	return 'high';
}

function bucketDistinct(value: number): string {
	if (value <= 1) return 'single';
	if (value <= 10) return 'low';
	if (value <= 100) return 'medium';
	if (value <= 1000) return 'high';
	return 'very-high';
}

function tokenizeColumnName(name: string): string[] {
	const snake = name
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');

	return snake
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.split(/_+/)
		.filter(Boolean);
}

function isIdentifierLikeName(name: string): boolean {
	const tokens = tokenizeColumnName(name);
	if (tokens.length === 0) return false;
	const last = tokens[tokens.length - 1] ?? '';
	if (IDENTIFIER_TOKENS.has(last)) return true;
	return tokens.some((token) => token === 'uuid' || token === 'guid' || token === 'identifier');
}

function normalizedColumnName(name: string, synonyms: Map<string, { canonical: string; semanticHint: ColumnSemanticType; weight: number }>): string {
	const tokens = tokenizeColumnName(name);
	if (tokens.length === 0) return name.toLowerCase();
	return tokens.map((token) => synonyms.get(token)?.canonical ?? token).join('_');
}

function inferColumnSemantics(input: {
	columnName: string;
	dataKind: 'numeric' | 'date' | 'boolean' | 'text';
	samples: string[];
	nullRatio?: number;
	distinctCount?: number;
	synonyms?: Map<string, { canonical: string; semanticHint: ColumnSemanticType; weight: number }>;
}): SemanticInference {
	const synonyms = input.synonyms ?? new Map();
	const rawTokens = tokenizeColumnName(input.columnName);
	const normalizedName = normalizedColumnName(input.columnName, synonyms);
	const name = normalizedName.trim().toLowerCase();
	const normalizedTokens = tokenizeColumnName(name);
	const samples = input.samples.slice(0, 8);
	let bestType: ColumnSemanticType | null = null;
	let bestScore = -1;
	let bestConfidence = 0.25;

	if (isIdentifierLikeName(input.columnName)) {
		const tokens = tokenizeColumnName(input.columnName);
		const previousToken = tokens[tokens.length - 2] ?? '';
		const semanticType: ColumnSemanticType = previousToken === 'session' || previousToken === 'sess' || previousToken === 'visit'
			? 'session_id'
			: previousToken === 'source' || previousToken === 'src' || previousToken === 'from'
				? 'source_id'
				: previousToken === 'target' || previousToken === 'dst' || previousToken === 'to'
					? 'target_id'
					: previousToken === 'parent' || previousToken === 'ancestor' || previousToken === 'root'
						? 'parent_id'
						: tokens.length > 1
							? 'foreign_key'
							: 'id';
		const signature = `kind=${input.dataKind}|semantic=${semanticType}|shape=${samples.length === 0 ? 'none' : 'mixed'}|confidence=very-high`;
		return {
			semanticType,
			signature,
			confidence: 0.93
		};
	}

	for (const candidate of COLUMN_SEMANTIC_CATALOG) {
		if (!candidate.kinds.includes(input.dataKind)) continue;
		if (candidate.type === 'url' && /(image|thumbnail|avatar|media|video|audio|file|asset|object_key|blob_key)/i.test(name)) {
			continue;
		}

		const nameMatch = candidate.namePatterns.some((pattern) => pattern.test(name));
		const tokenMatch = normalizedTokens.some((token) =>
			candidate.namePatterns.some((pattern) => pattern.test(token))
		);
		const rawTokenMatch = rawTokens.some((token) =>
			candidate.namePatterns.some((pattern) => pattern.test(token))
		);
		if (!nameMatch && !tokenMatch && !rawTokenMatch) continue;

		let score = candidate.priority;
		let confidence = 0.45;
		if (tokenMatch || rawTokenMatch) confidence += 0.14;
		const matchedSynonyms = tokenizeColumnName(input.columnName).map((token) => synonyms.get(token)).filter(Boolean);
		if (matchedSynonyms.length > 0) {
			const synonymBoost = matchedSynonyms.reduce((acc, entry) => acc + (entry?.weight ?? 0), 0) / matchedSynonyms.length;
			confidence += synonymBoost * 0.2;
		}

		if (candidate.samplePatterns && candidate.samplePatterns.length > 0 && samples.length > 0) {
			const matches = samples.filter((sample) => candidate.samplePatterns?.some((pattern) => pattern.test(sample))).length;
			score += matches * 2;
			confidence += (matches / samples.length) * 0.35;
		}

		if (candidate.type === 'flag' && input.dataKind === 'boolean') confidence += 0.2;
		if (candidate.type === 'binary_outcome' && input.dataKind === 'boolean') confidence += 0.15;
		if (candidate.type === 'ordinal_rank' && input.dataKind === 'numeric') confidence += 0.08;
		if (candidate.type === 'event_type' && input.dataKind === 'text') confidence += 0.05;
		if ((candidate.type === 'media_url' || candidate.type === 'media_path' || candidate.type === 'media_extension') && input.dataKind === 'text') confidence += 0.05;
		if ((candidate.type === 'created_at' || candidate.type === 'updated_at' || candidate.type === 'event_time' || candidate.type === 'date') && input.dataKind === 'date') confidence += 0.15;
		if ((candidate.type === 'created_at' || candidate.type === 'updated_at' || candidate.type === 'event_time' || candidate.type === 'date') && input.dataKind === 'numeric') confidence += 0.1;
		if ((candidate.type === 'amount' || candidate.type === 'currency_amount' || candidate.type === 'unit_price' || candidate.type === 'count' || candidate.type === 'quantity' || candidate.type === 'volume_measure' || candidate.type === 'metric' || candidate.type === 'inflow' || candidate.type === 'outflow' || candidate.type === 'numerator' || candidate.type === 'denominator') && input.dataKind === 'numeric') confidence += 0.12;
		if (input.nullRatio !== undefined && input.nullRatio > 0.85 && candidate.type !== 'description') confidence -= 0.1;
		if (input.distinctCount !== undefined && input.distinctCount <= 1 && candidate.type === 'entity_name') confidence -= 0.2;
		if (input.distinctCount !== undefined && input.distinctCount <= 5 && candidate.type === 'category') confidence += 0.08;
		if (input.distinctCount !== undefined && candidate.type === 'ordinal_rank') {
			if (input.distinctCount >= 2 && input.distinctCount <= 12) confidence += 0.1;
			if (input.distinctCount > 150) confidence -= 0.25;
		}

		const boundedConfidence = normalizeConfidence(confidence);

		if (score > bestScore) {
			bestScore = score;
			bestType = candidate.type;
			bestConfidence = boundedConfidence;
		}
	}

	const semanticType = bestType ?? (input.dataKind === 'text' ? 'text' : 'metric');
	if (
		(bestType === 'metric' || bestType === 'amount' || bestType === 'count' || bestType === 'quantity') &&
		/(date|time|timestamp|completion\s*time|created|updated|occurred|event)/i.test(input.columnName)
	) {
		bestType = 'event_time';
		bestConfidence = Math.max(bestConfidence, 0.8);
	}
	const resolvedSemanticType = bestType ?? semanticType;
	if (!bestType) {
		bestConfidence = normalizeConfidence(input.dataKind === 'text' ? 0.4 : 0.55);
	}
	const sampleShape = samples.length === 0
		? 'none'
		: samples.every((sample) => /^\d+$/.test(sample))
			? 'int'
			: samples.every((sample) => /^\d+(\.\d+)?$/.test(sample))
				? 'float'
				: samples.every((sample) => /^\d{4}-\d{2}-\d{2}/.test(sample))
					? 'iso-date'
					: 'mixed';

	return {
		semanticType: resolvedSemanticType,
		signature: `kind=${input.dataKind}|semantic=${resolvedSemanticType}|shape=${sampleShape}|confidence=${confidenceBucket(bestConfidence)}`,
		confidence: bestConfidence
	};
}

function stageTypeSignature(stages: GUIPipelineStage[]): string {
	return stages.map((stage) => stage.type).join(' > ');
}

function combinations<T>(items: T[], size: number): T[][] {
	if (size <= 0 || items.length < size) return [];
	if (size === 1) return items.map((item) => [item]);
	const out: T[][] = [];
	for (let i = 0; i <= items.length - size; i++) {
		const head = items[i];
		const tails = combinations(items.slice(i + 1), size - 1);
		for (const tail of tails) out.push([head, ...tail]);
	}
	return out;
}

function addDeriveSignatures(columns: ColumnSemanticSnapshot[], pushSignature: (entry: SignatureEntry) => void): void {
	if (columns.length === 0) return;
	const deriveColumns: SemanticDeriveColumn[] = columns.map((column) => ({
		name: column.columnName,
		kind: column.dataKind,
		semanticType: column.semanticType,
		confidence: column.confidence,
		nullRatio: column.nullRatio,
		distinctCount: column.distinctCount
	}));
	const byName = new Map(columns.map((column) => [column.columnName, column]));

	for (const candidate of findSemanticDeriveCandidates(deriveColumns)) {
		const left = byName.get(candidate.leftColumn);
		const right = byName.get(candidate.rightColumn);
		if (!left || !right) continue;
		const confidence = confidenceBucket((left.confidence + right.confidence) / 2);
		pushSignature({
			type: 'derive',
			key: [
				'derive',
				`pattern=${candidate.pattern}`,
				`op=${candidate.expressionClass}`,
				`left_semantic=${left.semanticType}`,
				`right_semantic=${right.semanticType}`,
				`left_kind=${left.dataKind}`,
				`right_kind=${right.dataKind}`,
				`left_nulls=${bucketNullRatio(left.nullRatio)}`,
				`right_nulls=${bucketNullRatio(right.nullRatio)}`,
				`left_cardinality=${bucketDistinct(left.distinctCount)}`,
				`right_cardinality=${bucketDistinct(right.distinctCount)}`,
				`confidence=${confidence}`
			].join('|')
		});
	}
}

function buildExhaustiveSignatures(columns: ColumnSemanticSnapshot[]): SignatureEntry[] {
	if (columns.length === 0) return [];
	const sorted = [...columns].sort((a, b) => a.columnName.localeCompare(b.columnName));
	const signatures: SignatureEntry[] = [];
	const seen = new Set<string>();
	const pushSignature = (entry: SignatureEntry): void => {
		const key = `${entry.type}|${entry.key}`;
		if (seen.has(key)) return;
		seen.add(key);
		signatures.push(entry);
	};

	for (const column of sorted) {
		const sampleShape = column.sampleValues.length === 0
			? 'none'
			: column.sampleValues.every((value) => /^\d+$/.test(value))
				? 'int'
				: column.sampleValues.every((value) => /^\d+(\.\d+)?$/.test(value))
					? 'float'
					: column.sampleValues.every((value) => /^\d{4}-\d{2}-\d{2}/.test(value))
						? 'iso-date'
						: 'mixed';
		pushSignature({
			type: 'column',
			key: [
				'column',
				`name=${column.columnName.toLowerCase()}`,
				`kind=${column.dataKind}`,
				`semantic=${column.semanticType}`,
				`confidence=${confidenceBucket(column.confidence)}`,
				`nulls=${bucketNullRatio(column.nullRatio)}`,
				`cardinality=${bucketDistinct(column.distinctCount)}`,
				`shape=${sampleShape}`
			].join('|')
		});

		const tokens = tokenizeColumnName(column.columnName).sort();
		if (tokens.length > 0) {
			pushSignature({
				type: 'lexical',
				key: [
					'lexical',
					`token_count=${tokens.length}`,
					`tokens=${tokens.join('+')}`,
					`semantic=${column.semanticType}`,
					`kind=${column.dataKind}`
				].join('|')
			});
		}
	}

	for (const pair of combinations(sorted, 2)) {
		const pairSemantics = pair
			.map((entry) => `${entry.semanticType}:${entry.dataKind}`)
			.sort()
			.join('+');
		const pairNames = pair
			.map((entry) => entry.columnName.toLowerCase())
			.sort()
			.join('+');
		pushSignature({
			type: 'pair',
			key: [
				'pair',
				`columns=${pairNames}`,
				`types=${pairSemantics}`,
				`confidence=${confidenceBucket((pair[0].confidence + pair[1].confidence) / 2)}`
			].join('|')
		});

		pushSignature({
			type: 'semantic',
			key: [
				'semantic-pair',
				`semantics=${pair.map((entry) => entry.semanticType).sort().join('+')}`,
				`kinds=${pair.map((entry) => entry.dataKind).sort().join('+')}`,
				`confidence=${confidenceBucket((pair[0].confidence + pair[1].confidence) / 2)}`
			].join('|')
		});
	}

	for (const triplet of combinations(sorted, 3)) {
		const tripletSemantics = triplet
			.map((entry) => `${entry.semanticType}:${entry.dataKind}`)
			.sort()
			.join('+');
		const tripletNames = triplet
			.map((entry) => entry.columnName.toLowerCase())
			.sort()
			.join('+');
		pushSignature({
			type: 'triplet',
			key: [
				'triplet',
				`columns=${tripletNames}`,
				`types=${tripletSemantics}`,
				`confidence=${confidenceBucket(triplet.reduce((acc, entry) => acc + entry.confidence, 0) / triplet.length)}`
			].join('|')
		});

		pushSignature({
			type: 'semantic',
			key: [
				'semantic-triplet',
				`semantics=${triplet.map((entry) => entry.semanticType).sort().join('+')}`,
				`kinds=${triplet.map((entry) => entry.dataKind).sort().join('+')}`,
				`confidence=${confidenceBucket(triplet.reduce((acc, entry) => acc + entry.confidence, 0) / triplet.length)}`
			].join('|')
		});
	}

	for (const quad of combinations(sorted, 4)) {
		const quadSemantics = quad
			.map((entry) => `${entry.semanticType}:${entry.dataKind}`)
			.sort()
			.join('+');
		const quadNames = quad
			.map((entry) => entry.columnName.toLowerCase())
			.sort()
			.join('+');
		pushSignature({
			type: 'quad',
			key: [
				'quad',
				`columns=${quadNames}`,
				`types=${quadSemantics}`,
				`confidence=${confidenceBucket(quad.reduce((acc, entry) => acc + entry.confidence, 0) / quad.length)}`
			].join('|')
		});
	}

	addDeriveSignatures(sorted, pushSignature);

	const semanticSet = [...new Set(sorted.map((entry) => entry.semanticType))].sort().join('+');
	const kindSet = [...new Set(sorted.map((entry) => entry.dataKind))].sort().join('+');
	const avgConfidence = sorted.reduce((acc, entry) => acc + entry.confidence, 0) / sorted.length;
	pushSignature({
		type: 'schema',
		key: [
			'schema',
			`semantics=${semanticSet || 'none'}`,
			`kinds=${kindSet || 'none'}`,
			`columns=${sorted.length}`,
			`confidence=${confidenceBucket(avgConfidence)}`
		].join('|')
	});

	return signatures;
}

async function getSemanticSynonyms(connectionId: string): Promise<Map<string, { canonical: string; semanticHint: ColumnSemanticType; weight: number }>> {
	const result = await executeSQL(`
		SELECT token, canonical, semantic_hint, weight
		FROM ${META_SCHEMA}.semantic_synonyms
		WHERE connection_id = ${quoteLiteral(connectionId)}
		ORDER BY weight DESC
	`);
	const map = new Map<string, { canonical: string; semanticHint: ColumnSemanticType; weight: number }>();
	for (const row of result.rows as Array<{ token?: string; canonical?: string; semantic_hint?: ColumnSemanticType; weight?: number }>) {
		const token = (row.token ?? '').trim().toLowerCase();
		if (!token) continue;
		map.set(token, {
			canonical: (row.canonical ?? token).trim().toLowerCase() || token,
			semanticHint: (row.semantic_hint ?? 'text') as ColumnSemanticType,
			weight: Number(row.weight ?? 0.5)
		});
	}
	return map;
}

async function ensureDefaultSemanticSynonyms(connectionId: string): Promise<void> {
	for (const entry of DEFAULT_SEMANTIC_SYNONYMS) {
		await run(`
			INSERT INTO ${META_SCHEMA}.semantic_synonyms (
				connection_id, token, canonical, semantic_hint, weight, last_seen_ms
			)
			VALUES (
				${quoteLiteral(connectionId)},
				${quoteLiteral(entry.token)},
				${quoteLiteral(entry.canonical)},
				${quoteLiteral(entry.semanticHint)},
				${entry.weight},
				${nowMs()}
			)
			ON CONFLICT (connection_id, token) DO UPDATE SET
				canonical = EXCLUDED.canonical,
				semantic_hint = EXCLUDED.semantic_hint,
				weight = GREATEST(${META_SCHEMA}.semantic_synonyms.weight, EXCLUDED.weight),
				last_seen_ms = EXCLUDED.last_seen_ms
		`);
	}
}

async function upsertSignatureUsage(input: {
	connectionId: string;
	relationName: string;
	entries: SignatureEntry[];
}): Promise<void> {
	const ts = nowMs();
	for (const entry of input.entries) {
		await run(`
			INSERT INTO ${META_SCHEMA}.signature_usage (
				connection_id, relation_name, signature_type, signature_key, usage_count, last_seen_ms
			)
			VALUES (
				${quoteLiteral(input.connectionId)},
				${quoteLiteral(input.relationName)},
				${quoteLiteral(entry.type)},
				${quoteLiteral(entry.key)},
				1,
				${ts}
			)
			ON CONFLICT (connection_id, relation_name, signature_type, signature_key) DO UPDATE SET
				usage_count = ${META_SCHEMA}.signature_usage.usage_count + 1,
				last_seen_ms = EXCLUDED.last_seen_ms
		`);
	}
}

export async function registerSemanticSynonyms(input: {
	connectionId: string;
	entries: Array<{ token: string; canonical: string; semanticHint: ColumnSemanticType; weight?: number }>;
}): Promise<void> {
	await ensureIntelligenceMetaTables();
	for (const entry of input.entries) {
		const token = entry.token.trim().toLowerCase();
		const canonical = entry.canonical.trim().toLowerCase();
		if (!token || !canonical) continue;
		await run(`
			INSERT INTO ${META_SCHEMA}.semantic_synonyms (
				connection_id, token, canonical, semantic_hint, weight, last_seen_ms
			)
			VALUES (
				${quoteLiteral(input.connectionId)},
				${quoteLiteral(token)},
				${quoteLiteral(canonical)},
				${quoteLiteral(entry.semanticHint)},
				${entry.weight ?? 0.75},
				${nowMs()}
			)
			ON CONFLICT (connection_id, token) DO UPDATE SET
				canonical = EXCLUDED.canonical,
				semantic_hint = EXCLUDED.semantic_hint,
				weight = EXCLUDED.weight,
				last_seen_ms = EXCLUDED.last_seen_ms
		`);
	}
}

export async function refreshSemanticMetadataBackfill(input: {
	connectionId: string;
	relationName?: string;
}): Promise<void> {
	await ensureIntelligenceMetaTables();
	await ensureDefaultSemanticSynonyms(input.connectionId);
	const synonyms = await getSemanticSynonyms(input.connectionId);

	const relationPredicate = input.relationName
		? `AND relation_name = ${quoteLiteral(input.relationName)}`
		: '';
	const profileResult = await executeSQL(`
		SELECT relation_name, column_name, data_kind, null_ratio, distinct_count, sample_values_json
		FROM ${META_SCHEMA}.column_profiles
		WHERE connection_id = ${quoteLiteral(input.connectionId)}
		  ${relationPredicate}
		ORDER BY relation_name, column_name
	`);

	const relationSnapshots = new Map<string, ColumnSemanticSnapshot[]>();
	for (const row of profileResult.rows as Array<{
		relation_name?: string;
		column_name?: string;
		data_kind?: 'numeric' | 'date' | 'boolean' | 'text';
		null_ratio?: number;
		distinct_count?: number;
		sample_values_json?: string;
	}>) {
		const relationName = (row.relation_name ?? '').trim();
		const columnName = (row.column_name ?? '').trim();
		if (!relationName || !columnName) continue;

		const dataKind = (row.data_kind ?? 'text') as 'numeric' | 'date' | 'boolean' | 'text';
		const nullRatio = Number(row.null_ratio ?? 0);
		const distinctCount = Number(row.distinct_count ?? 0);
		const sampleValues = parseSampleValues(row.sample_values_json ?? '[]');
		const inferred = inferColumnSemantics({
			columnName,
			dataKind,
			samples: sampleValues,
			nullRatio,
			distinctCount,
			synonyms
		});

		await run(`
			UPDATE ${META_SCHEMA}.column_profiles
			SET semantic_type = ${quoteLiteral(inferred.semanticType)},
				semantic_signature = ${quoteLiteral(inferred.signature)},
				semantic_confidence = ${inferred.confidence},
				last_seen_ms = ${nowMs()}
			WHERE connection_id = ${quoteLiteral(input.connectionId)}
			  AND relation_name = ${quoteLiteral(relationName)}
			  AND column_name = ${quoteLiteral(columnName)}
		`);

		const bucket = relationSnapshots.get(relationName) ?? [];
		bucket.push({
			columnName,
			dataKind,
			semanticType: inferred.semanticType,
			confidence: inferred.confidence,
			nullRatio,
			distinctCount,
			sampleValues
		});
		relationSnapshots.set(relationName, bucket);
	}

	for (const [relationName, snapshots] of relationSnapshots.entries()) {
		await upsertSignatureUsage({
			connectionId: input.connectionId,
			relationName,
			entries: buildExhaustiveSignatures(snapshots)
		});
	}
}

function extractPrimaryColumn(stage: GUIPipelineStage): string {
	switch (stage.type) {
		case 'append':
			return '';
		case 'filter':
			return stage.conditions[0]?.column ?? '';
		case 'sort':
			return stage.keys[0]?.column ?? '';
		case 'group':
			return stage.by[0] ?? stage.aggregations[0]?.column ?? '';
		case 'derive':
			return stage.columns[0]?.expr.mode === 'binary'
				? (stage.columns[0].expr.left?.kind === 'column' ? stage.columns[0].expr.left.value : '')
				: stage.columns[0]?.expr.mode === 'func' && stage.columns[0].expr.args?.[0]?.kind === 'column'
					? stage.columns[0].expr.args[0].value
					: '';
		case 'select':
			return stage.columns[0] ?? '';
		case 'join':
			return stage.conditions[0]?.left ?? '';
		case 'window':
			return stage.sortKeys[0]?.column ?? stage.derives[0]?.name ?? '';
		case 'loop':
			return '';
		default:
			return '';
	}
}

async function run(sql: string): Promise<void> {
	await executeSQL(sql);
}

export async function ensureIntelligenceMetaTables(): Promise<void> {
	if (metaReady) return;
	await initDB();
	await run(`CREATE SCHEMA IF NOT EXISTS ${META_SCHEMA}`);
	await run(`
		CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.table_profiles (
			connection_id VARCHAR,
			relation_name VARCHAR,
			source_kind VARCHAR,
			row_count BIGINT,
			column_count INTEGER,
			last_seen_ms BIGINT,
			PRIMARY KEY (connection_id, relation_name)
		)
	`);
	await run(`
		CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.column_profiles (
			connection_id VARCHAR,
			relation_name VARCHAR,
			column_name VARCHAR,
			data_kind VARCHAR,
			semantic_type VARCHAR,
			semantic_signature VARCHAR,
			semantic_confidence DOUBLE,
			null_ratio DOUBLE,
			distinct_count BIGINT,
			sample_values_json VARCHAR,
			last_seen_ms BIGINT,
			seen_count BIGINT,
			PRIMARY KEY (connection_id, relation_name, column_name)
		)
	`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS semantic_type VARCHAR`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS semantic_signature VARCHAR`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS semantic_confidence DOUBLE`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS min_val VARCHAR`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS max_val VARCHAR`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS mean_val DOUBLE`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS stddev_val DOUBLE`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS p50_val VARCHAR`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS p75_val VARCHAR`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS top_values_json VARCHAR`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS date_granularity VARCHAR`);
	await run(`ALTER TABLE ${META_SCHEMA}.column_profiles ADD COLUMN IF NOT EXISTS profile_source VARCHAR`);
	await run(`
		CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.cell_runs (
			run_id VARCHAR PRIMARY KEY,
			ts_ms BIGINT,
			notebook_id VARCHAR,
			cell_id VARCHAR,
			connection_id VARCHAR,
			status VARCHAR,
			runtime_ms DOUBLE,
			row_count BIGINT,
			column_count INTEGER,
			tables_touched_json VARCHAR,
			result_columns_json VARCHAR,
			stage_types_json VARCHAR,
			pipeline_signature VARCHAR
		)
	`);
	await run(`
		CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.stage_usage (
			connection_id VARCHAR,
			pipeline_signature VARCHAR,
			stage_type VARCHAR,
			column_name VARCHAR,
			usage_count BIGINT,
			last_used_ms BIGINT,
			PRIMARY KEY (connection_id, pipeline_signature, stage_type, column_name)
		)
	`);
	await run(`
		CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.stage_sequence_usage (
			connection_id VARCHAR,
			context_signature VARCHAR,
			next_stage VARCHAR,
			usage_count BIGINT,
			last_used_ms BIGINT,
			PRIMARY KEY (connection_id, context_signature, next_stage)
		)
	`);
	await run(`
		CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.signature_usage (
			connection_id VARCHAR,
			relation_name VARCHAR,
			signature_type VARCHAR,
			signature_key VARCHAR,
			usage_count BIGINT,
			last_seen_ms BIGINT,
			PRIMARY KEY (connection_id, relation_name, signature_type, signature_key)
		)
	`);
	await run(`
		CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.semantic_synonyms (
			connection_id VARCHAR,
			token VARCHAR,
			canonical VARCHAR,
			semantic_hint VARCHAR,
			weight DOUBLE,
			last_seen_ms BIGINT,
			PRIMARY KEY (connection_id, token)
		)
	`);
	await run(`
		CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.notebook_action_feedback (
			connection_id VARCHAR,
			notebook_id VARCHAR,
			cell_id VARCHAR,
			action_id VARCHAR,
			action_kind VARCHAR,
			feedback VARCHAR,
			feedback_count BIGINT,
			last_seen_ms BIGINT,
			PRIMARY KEY (connection_id, notebook_id, cell_id, action_id, feedback)
		)
	`);
	metaReady = true;
}

export async function recordNotebookActionFeedback(input: {
	connectionId: string;
	notebookId: string;
	cellId: string;
	actionId: string;
	actionKind: string;
	feedback: 'accepted' | 'dismissed';
}): Promise<void> {
	await ensureIntelligenceMetaTables();
	if (!input.connectionId || !input.notebookId || !input.cellId || !input.actionId) return;

	await run(`
		INSERT INTO ${META_SCHEMA}.notebook_action_feedback (
			connection_id, notebook_id, cell_id, action_id, action_kind, feedback, feedback_count, last_seen_ms
		)
		VALUES (
			${quoteLiteral(input.connectionId)},
			${quoteLiteral(input.notebookId)},
			${quoteLiteral(input.cellId)},
			${quoteLiteral(input.actionId)},
			${quoteLiteral(input.actionKind)},
			${quoteLiteral(input.feedback)},
			1,
			${nowMs()}
		)
		ON CONFLICT (connection_id, notebook_id, cell_id, action_id, feedback) DO UPDATE SET
			feedback_count = ${META_SCHEMA}.notebook_action_feedback.feedback_count + 1,
			last_seen_ms = EXCLUDED.last_seen_ms,
			action_kind = EXCLUDED.action_kind
	`);
}

export async function getNotebookActionFeedback(input: {
	connectionId: string;
	notebookId: string;
	cellId: string;
}): Promise<{ acceptedByActionId: Record<string, number>; dismissedByActionId: Record<string, number> }> {
	await ensureIntelligenceMetaTables();
	if (!input.connectionId || !input.notebookId || !input.cellId) {
		return { acceptedByActionId: {}, dismissedByActionId: {} };
	}

	const result = await executeSQL(`
		SELECT action_id, feedback, SUM(feedback_count) AS total_count
		FROM ${META_SCHEMA}.notebook_action_feedback
		WHERE connection_id = ${quoteLiteral(input.connectionId)}
		  AND notebook_id = ${quoteLiteral(input.notebookId)}
		  AND cell_id = ${quoteLiteral(input.cellId)}
		GROUP BY action_id, feedback
	`);

	const acceptedByActionId: Record<string, number> = {};
	const dismissedByActionId: Record<string, number> = {};
	for (const row of result.rows as Array<{ action_id?: string; feedback?: string; total_count?: number }>) {
		const actionId = `${row.action_id ?? ''}`.trim();
		if (!actionId) continue;
		const count = Number(row.total_count ?? 0);
		if (!Number.isFinite(count) || count <= 0) continue;
		if (row.feedback === 'accepted') acceptedByActionId[actionId] = count;
		if (row.feedback === 'dismissed') dismissedByActionId[actionId] = count;
	}

	return { acceptedByActionId, dismissedByActionId };
}

export async function recordUploadedTableMetadata(input: {
	connectionId: string;
	table: UploadedTable;
}): Promise<void> {
	await ensureIntelligenceMetaTables();
	await ensureDefaultSemanticSynonyms(input.connectionId);
	const synonyms = await getSemanticSynonyms(input.connectionId);
	const ts = nowMs();
	await run(`
		INSERT INTO ${META_SCHEMA}.table_profiles (
			connection_id, relation_name, source_kind, row_count, column_count, last_seen_ms
		)
		VALUES (
			${quoteLiteral(input.connectionId)},
			${quoteLiteral(input.table.name)},
			'uploaded',
			${input.table.rowCount},
			${input.table.columns.length},
			${ts}
		)
		ON CONFLICT (connection_id, relation_name) DO UPDATE SET
			source_kind = EXCLUDED.source_kind,
			row_count = EXCLUDED.row_count,
			column_count = EXCLUDED.column_count,
			last_seen_ms = EXCLUDED.last_seen_ms
	`);

	// Profile the uploaded table directly in DuckDB — it's already materialized
	const tableIdent = `"${input.table.name.replace(/"/g, '""')}"`;
	let richStats: Map<string, RichColumnStats> = new Map();
	try {
		richStats = await computeRichStatsFromDuckDB(tableIdent);
	} catch {
		// Fall back to empty stats
	}

	const snapshots: ColumnSemanticSnapshot[] = [];
	for (let i = 0; i < input.table.columns.length; i++) {
		const column = input.table.columns[i];
		const columnType = input.table.columnTypes[i] ?? 'unknown';
		const dataKind = normalizeKind(columnType);
		const rich = richStats.get(column);
		const samples = rich?.topValues?.map((t) => t.v) ?? [];
		const inferred = inferColumnSemantics({
			columnName: column,
			dataKind,
			samples,
			nullRatio: rich?.nullRatio,
			distinctCount: rich?.distinctCount,
			synonyms
		});
		snapshots.push({
			columnName: column,
			dataKind,
			semanticType: inferred.semanticType,
			confidence: inferred.confidence,
			nullRatio: rich?.nullRatio ?? 0,
			distinctCount: rich?.distinctCount ?? 0,
			sampleValues: samples
		});
		const topValuesJson = rich?.topValues ? JSON.stringify(rich.topValues) : null;
		await run(`
			INSERT INTO ${META_SCHEMA}.column_profiles (
				connection_id, relation_name, column_name, data_kind,
				semantic_type, semantic_signature, semantic_confidence,
				null_ratio, distinct_count, sample_values_json,
				min_val, max_val, mean_val, stddev_val, p50_val, p75_val,
				top_values_json, date_granularity, profile_source,
				last_seen_ms, seen_count
			)
			VALUES (
				${quoteLiteral(input.connectionId)},
				${quoteLiteral(input.table.name)},
				${quoteLiteral(column)},
				${quoteLiteral(dataKind)},
				${quoteLiteral(inferred.semanticType)},
				${quoteLiteral(inferred.signature)},
				${inferred.confidence},
				${rich?.nullRatio ?? 0},
				${rich?.distinctCount ?? 0},
				${quoteLiteral(JSON.stringify(samples))},
				${rich?.minVal != null ? quoteLiteral(rich.minVal) : 'NULL'},
				${rich?.maxVal != null ? quoteLiteral(rich.maxVal) : 'NULL'},
				${rich?.meanVal != null ? rich.meanVal : 'NULL'},
				${rich?.stddevVal != null ? rich.stddevVal : 'NULL'},
				${rich?.p50Val != null ? quoteLiteral(rich.p50Val) : 'NULL'},
				${rich?.p75Val != null ? quoteLiteral(rich.p75Val) : 'NULL'},
				${topValuesJson != null ? quoteLiteral(topValuesJson) : 'NULL'},
				${rich?.dateGranularity != null ? quoteLiteral(rich.dateGranularity) : 'NULL'},
				${richStats.size > 0 ? quoteLiteral('duckdb-rich') : quoteLiteral('bootstrap')},
				${ts},
				1
			)
			ON CONFLICT (connection_id, relation_name, column_name) DO UPDATE SET
				data_kind = EXCLUDED.data_kind,
				semantic_type = EXCLUDED.semantic_type,
				semantic_signature = EXCLUDED.semantic_signature,
				semantic_confidence = EXCLUDED.semantic_confidence,
				null_ratio = EXCLUDED.null_ratio,
				distinct_count = EXCLUDED.distinct_count,
				sample_values_json = EXCLUDED.sample_values_json,
				min_val = EXCLUDED.min_val,
				max_val = EXCLUDED.max_val,
				mean_val = EXCLUDED.mean_val,
				stddev_val = EXCLUDED.stddev_val,
				p50_val = EXCLUDED.p50_val,
				p75_val = EXCLUDED.p75_val,
				top_values_json = EXCLUDED.top_values_json,
				date_granularity = EXCLUDED.date_granularity,
				profile_source = EXCLUDED.profile_source,
				last_seen_ms = EXCLUDED.last_seen_ms,
				seen_count = ${META_SCHEMA}.column_profiles.seen_count + 1
		`);
	}

	await upsertSignatureUsage({
		connectionId: input.connectionId,
		relationName: input.table.name,
		entries: buildExhaustiveSignatures(snapshots)
	});
}

// ── DuckDB WASM-powered rich column profiling ────────────────────────────────

interface RichColumnStats {
	nullRatio: number;
	distinctCount: number;
	minVal?: string;
	maxVal?: string;
	meanVal?: number;
	stddevVal?: number;
	p50Val?: string;
	p75Val?: string;
	topValues?: Array<{ v: string; pct: number }>;
	dateGranularity?: 'day' | 'month' | 'year';
}

function inferDateGranularity(minStr: string, maxStr: string, approxUnique: number): 'day' | 'month' | 'year' {
	try {
		const spanDays = Math.max(1, (new Date(maxStr).getTime() - new Date(minStr).getTime()) / 86400000);
		const density = approxUnique / spanDays;
		if (density > 0.5) return 'day';
		if (density > 0.01) return 'month';
		return 'year';
	} catch {
		return 'month';
	}
}

/**
 * Run DuckDB SUMMARIZE + frequency queries against a table already in DuckDB.
 * @param tableIdent  SQL-quoted table identifier, e.g. `"_p_abc"` or `"employees"`
 */
async function computeRichStatsFromDuckDB(tableIdent: string): Promise<Map<string, RichColumnStats>> {
	const stats = new Map<string, RichColumnStats>();
	let summaryRows: Record<string, unknown>[] = [];

	try {
		const result = await executeSQL(`SUMMARIZE SELECT * FROM ${tableIdent}`);
		summaryRows = result.rows;
	} catch {
		return stats; // SUMMARIZE not available or table gone
	}

	for (const row of summaryRows) {
		const colName = String(row.column_name ?? '');
		if (!colName) continue;

		const colType = String(row.column_type ?? '').toUpperCase();
		const nullPct = Number(row.null_percentage ?? 0);
		const approxUnique = Number(row.approx_unique ?? 0);
		const minStr = row.min != null ? String(row.min) : undefined;
		const maxStr = row.max != null ? String(row.max) : undefined;
		const avgRaw = row.avg != null ? Number(row.avg) : undefined;
		const stdRaw = row.std != null ? Number(row.std) : undefined;
		const q50Str = row.q50 != null ? String(row.q50) : undefined;
		const q75Str = row.q75 != null ? String(row.q75) : undefined;

		const entry: RichColumnStats = {
			nullRatio: nullPct / 100,
			distinctCount: approxUnique,
			minVal: minStr,
			maxVal: maxStr,
			meanVal: avgRaw != null && !isNaN(avgRaw) ? avgRaw : undefined,
			stddevVal: stdRaw != null && !isNaN(stdRaw) ? stdRaw : undefined,
			p50Val: q50Str,
			p75Val: q75Str
		};

		const isDateLike = /DATE|TIMESTAMP|TIME/i.test(colType);
		if (isDateLike && minStr && maxStr && approxUnique > 0) {
			entry.dateGranularity = inferDateGranularity(minStr, maxStr, approxUnique);
		}

		stats.set(colName, entry);
	}

	// Frequency queries for low-cardinality non-numeric columns
	const NUMERIC_TYPES = /INTEGER|BIGINT|DOUBLE|FLOAT|DECIMAL|HUGEINT|REAL|TINYINT|SMALLINT/i;
	for (const row of summaryRows) {
		const colName = String(row.column_name ?? '');
		const colType = String(row.column_type ?? '');
		const approxUnique = Number(row.approx_unique ?? 0);
		if (!colName || NUMERIC_TYPES.test(colType) || approxUnique === 0 || approxUnique > 100) continue;

		try {
			const qCol = `"${colName.replace(/"/g, '""')}"`;
			const freqResult = await executeSQL(`
				SELECT ${qCol} AS v,
				       COUNT(*) * 1.0 / (SELECT COUNT(*) FROM ${tableIdent}) AS pct
				FROM ${tableIdent}
				WHERE ${qCol} IS NOT NULL
				GROUP BY ${qCol}
				ORDER BY COUNT(*) DESC
				LIMIT 15
			`);
			const entry = stats.get(colName);
			if (entry) {
				entry.topValues = freqResult.rows
					.filter((r) => r.v != null)
					.map((r) => ({ v: String(r.v), pct: Number(r.pct) }));
			}
		} catch {
			// Skip frequency on error for this column
		}
	}

	return stats;
}

function computeColumnStats(rows: Record<string, unknown>[], column: string): {
	nullRatio: number;
	distinctCount: number;
	samples: string[];
	kind: 'numeric' | 'date' | 'boolean' | 'text';
} {
	const values = rows.map((row) => row[column]);
	const present = values.filter((value) => value !== null && value !== undefined && value !== '');
	const nullRatio = values.length === 0 ? 0 : (values.length - present.length) / values.length;
	const distinctCount = new Set(present.map((value) => String(value))).size;
	const samples = [...new Set(present.slice(0, 5).map((value) => String(value)))];

	const numericHits = present.filter((value) => parseNumericLike(value) !== null).length;
	const dateHits = present.filter((value) => /^\d{4}-\d{2}-\d{2}/.test(String(value))).length;
	const boolHits = present.filter((value) => typeof value === 'boolean').length;
	let kind: 'numeric' | 'date' | 'boolean' | 'text' = 'text';
	if (present.length > 0 && boolHits / present.length >= 0.7) kind = 'boolean';
	else if (present.length > 0 && dateHits / present.length >= 0.7) kind = 'date';
	else if (present.length > 0 && numericHits / present.length >= 0.7) kind = 'numeric';

	return { nullRatio, distinctCount, samples, kind };
}

export async function recordCellExecutionMetadata(input: {
	runId: string;
	notebookId: string;
	cellId: string;
	connectionId: string;
	status: 'success' | 'error';
	runtimeMs: number | null;
	rowCount: number;
	columnCount: number;
	tablesTouched: string[];
	resultColumns: string[];
	resultRows: Record<string, unknown>[];
	outputName: string;
	stages: GUIPipelineStage[];
}): Promise<void> {
	await ensureIntelligenceMetaTables();
	await ensureDefaultSemanticSynonyms(input.connectionId);
	const synonyms = await getSemanticSynonyms(input.connectionId);
	const ts = nowMs();
	const pipelineSignature = stageTypeSignature(input.stages);
	const stageTypes = input.stages.map((stage) => stage.type);

	await run(`
		INSERT INTO ${META_SCHEMA}.cell_runs (
			run_id, ts_ms, notebook_id, cell_id, connection_id, status,
			runtime_ms, row_count, column_count, tables_touched_json,
			result_columns_json, stage_types_json, pipeline_signature
		)
		VALUES (
			${quoteLiteral(input.runId)},
			${ts},
			${quoteLiteral(input.notebookId)},
			${quoteLiteral(input.cellId)},
			${quoteLiteral(input.connectionId)},
			${quoteLiteral(input.status)},
			${input.runtimeMs ?? 'NULL'},
			${input.rowCount},
			${input.columnCount},
			${quoteLiteral(JSON.stringify(input.tablesTouched))},
			${quoteLiteral(JSON.stringify(input.resultColumns))},
			${quoteLiteral(JSON.stringify(stageTypes))},
			${quoteLiteral(pipelineSignature)}
		)
		ON CONFLICT (run_id) DO NOTHING
	`);

	await run(`
		INSERT INTO ${META_SCHEMA}.table_profiles (
			connection_id, relation_name, source_kind, row_count, column_count, last_seen_ms
		)
		VALUES (
			${quoteLiteral(input.connectionId)},
			${quoteLiteral(input.outputName)},
			'cell-result',
			${input.rowCount},
			${input.columnCount},
			${ts}
		)
		ON CONFLICT (connection_id, relation_name) DO UPDATE SET
			source_kind = EXCLUDED.source_kind,
			row_count = EXCLUDED.row_count,
			column_count = EXCLUDED.column_count,
			last_seen_ms = EXCLUDED.last_seen_ms
	`);

	// Try DuckDB WASM-powered rich profiling on the result rows (works for all connections)
	let cellRichStats: Map<string, RichColumnStats> = new Map();
	if (input.resultRows.length > 0 && input.resultColumns.length > 0) {
		const tempId = `cell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		try {
			await loadRowsForProfiling(tempId, input.resultRows);
			cellRichStats = await computeRichStatsFromDuckDB(`"_p_${tempId}"`);
		} catch {
			// Fall back to in-memory JS stats silently
		} finally {
			await dropProfileTable(tempId);
		}
	}

	const snapshots: ColumnSemanticSnapshot[] = [];
	for (const column of input.resultColumns) {
		const jsStats = computeColumnStats(input.resultRows, column);
		const rich = cellRichStats.get(column);
		// Prefer DuckDB stats when available; fall back to JS stats
		const nullRatio = rich?.nullRatio ?? jsStats.nullRatio;
		const distinctCount = rich?.distinctCount ?? jsStats.distinctCount;
		const samples = rich?.topValues?.map((t) => t.v) ?? jsStats.samples;
		const kind = jsStats.kind; // JS kind detection is reliable enough
		const inferred = inferColumnSemantics({
			columnName: column,
			dataKind: kind,
			samples,
			nullRatio,
			distinctCount,
			synonyms
		});
		snapshots.push({
			columnName: column,
			dataKind: kind,
			semanticType: inferred.semanticType,
			confidence: inferred.confidence,
			nullRatio,
			distinctCount,
			sampleValues: samples
		});
		const topValuesJson = rich?.topValues ? JSON.stringify(rich.topValues) : null;
		const profileSource = rich != null ? 'duckdb-rich' : 'in-memory';
		await run(`
			INSERT INTO ${META_SCHEMA}.column_profiles (
				connection_id, relation_name, column_name, data_kind,
				semantic_type, semantic_signature, semantic_confidence,
				null_ratio, distinct_count, sample_values_json,
				min_val, max_val, mean_val, stddev_val, p50_val, p75_val,
				top_values_json, date_granularity, profile_source,
				last_seen_ms, seen_count
			)
			VALUES (
				${quoteLiteral(input.connectionId)},
				${quoteLiteral(input.outputName)},
				${quoteLiteral(column)},
				${quoteLiteral(kind)},
				${quoteLiteral(inferred.semanticType)},
				${quoteLiteral(inferred.signature)},
				${inferred.confidence},
				${nullRatio},
				${distinctCount},
				${quoteLiteral(JSON.stringify(samples))},
				${rich?.minVal != null ? quoteLiteral(rich.minVal) : 'NULL'},
				${rich?.maxVal != null ? quoteLiteral(rich.maxVal) : 'NULL'},
				${rich?.meanVal != null ? rich.meanVal : 'NULL'},
				${rich?.stddevVal != null ? rich.stddevVal : 'NULL'},
				${rich?.p50Val != null ? quoteLiteral(rich.p50Val) : 'NULL'},
				${rich?.p75Val != null ? quoteLiteral(rich.p75Val) : 'NULL'},
				${topValuesJson != null ? quoteLiteral(topValuesJson) : 'NULL'},
				${rich?.dateGranularity != null ? quoteLiteral(rich.dateGranularity) : 'NULL'},
				${quoteLiteral(profileSource)},
				${ts},
				1
			)
			ON CONFLICT (connection_id, relation_name, column_name) DO UPDATE SET
				data_kind = EXCLUDED.data_kind,
				semantic_type = EXCLUDED.semantic_type,
				semantic_signature = EXCLUDED.semantic_signature,
				semantic_confidence = EXCLUDED.semantic_confidence,
				null_ratio = EXCLUDED.null_ratio,
				distinct_count = EXCLUDED.distinct_count,
				sample_values_json = EXCLUDED.sample_values_json,
				min_val = EXCLUDED.min_val,
				max_val = EXCLUDED.max_val,
				mean_val = EXCLUDED.mean_val,
				stddev_val = EXCLUDED.stddev_val,
				p50_val = EXCLUDED.p50_val,
				p75_val = EXCLUDED.p75_val,
				top_values_json = EXCLUDED.top_values_json,
				date_granularity = EXCLUDED.date_granularity,
				profile_source = EXCLUDED.profile_source,
				last_seen_ms = EXCLUDED.last_seen_ms,
				seen_count = ${META_SCHEMA}.column_profiles.seen_count + 1
		`);
	}

	const schemaSummary = buildExhaustiveSignatures(snapshots)
		.find((entry) => entry.type === 'schema')?.key ?? 'schema:none';

	await upsertSignatureUsage({
		connectionId: input.connectionId,
		relationName: input.outputName,
		entries: buildExhaustiveSignatures(snapshots)
	});

	for (let i = 0; i < input.stages.length; i++) {
		const prefix = stageTypeSignature(input.stages.slice(0, i));
		const prefixStages = input.stages.slice(0, i);
		const stage = input.stages[i];
		const column = extractPrimaryColumn(stage);
		await run(`
			INSERT INTO ${META_SCHEMA}.stage_usage (
				connection_id, pipeline_signature, stage_type, column_name, usage_count, last_used_ms
			)
			VALUES (
				${quoteLiteral(input.connectionId)},
				${quoteLiteral(prefix)},
				${quoteLiteral(stage.type)},
				${quoteLiteral(column)},
				1,
				${ts}
			)
			ON CONFLICT (connection_id, pipeline_signature, stage_type, column_name) DO UPDATE SET
				usage_count = ${META_SCHEMA}.stage_usage.usage_count + 1,
				last_used_ms = EXCLUDED.last_used_ms
		`);

		for (const contextSignature of stageContextSignatures(prefixStages, schemaSummary)) {
			await run(`
				INSERT INTO ${META_SCHEMA}.stage_sequence_usage (
					connection_id, context_signature, next_stage, usage_count, last_used_ms
				)
				VALUES (
					${quoteLiteral(input.connectionId)},
					${quoteLiteral(contextSignature)},
					${quoteLiteral(stage.type)},
					1,
					${ts}
				)
				ON CONFLICT (connection_id, context_signature, next_stage) DO UPDATE SET
					usage_count = ${META_SCHEMA}.stage_sequence_usage.usage_count + 1,
					last_used_ms = EXCLUDED.last_used_ms
			`);
		}
	}
}

interface UsageRow {
	pipeline_signature?: string;
	stage_type: StageType;
	column_name: string;
	usage_count: number;
	last_used_ms?: number;
}

interface ProfileRow {
	column_name: string;
	data_kind: 'numeric' | 'date' | 'boolean' | 'text';
	semantic_type?: ColumnSemanticType;
	semantic_signature?: string;
	semantic_confidence?: number;
	null_ratio: number;
	distinct_count: number;
	sample_values_json: string;
}

function buildPresetColumnProfiles(rows: ProfileRow[]): Partial<Record<string, PresetColumnProfile>> {
	const profiles: Partial<Record<string, PresetColumnProfile>> = {};
	for (const row of rows) {
		if (!row.column_name) continue;
		profiles[row.column_name] = {
			dataKind: row.data_kind,
			semanticType: row.semantic_type,
			confidence: row.semantic_confidence
		};
	}
	return profiles;
}

interface FilterChipSuggestion {
	label: string;
	stage: Extract<GUIPipelineStage, { type: 'filter' }>;
}

interface DeriveChipSuggestion {
	label: string;
	stage: Extract<GUIPipelineStage, { type: 'derive' }>;
	quality?: number;
}

interface ResultProfileRow extends ProfileRow {
	relation_name?: string;
	last_seen_ms?: number;
}

export interface LLMPlanningColumnContext {
	name: string;
	dataKind: 'numeric' | 'date' | 'boolean' | 'text';
	semanticType?: string;
	semanticConfidence?: number;
	nullRatio: number;
	distinctCount: number;
	sampleValues: string[];
	// Rich stats from DuckDB WASM profiling (present when profile_source = 'duckdb-rich')
	minVal?: string;
	maxVal?: string;
	meanVal?: number;
	p50Val?: string;
	p75Val?: string;
	topValues?: Array<{ v: string; pct: number }>;
	dateGranularity?: 'day' | 'month' | 'year';
}

export interface LLMPlanningContext {
	sourceTable: string | null;
	pipelineStageTypes: StageType[];
	columns: LLMPlanningColumnContext[];
}

type ColumnIntentRole = 'metric' | 'dimension' | 'filter';

interface ColumnImportance {
	column: string;
	row: ProfileRow;
	score: number;
}

type DiversityIntent = 'narrow' | 'summarize' | 'rank' | 'shape' | 'enrich' | 'sample';

interface DiversityCandidate<T> {
	item: T;
	score: number;
	typeKey: string;
	intent: DiversityIntent;
	semanticKey: string;
}

const suggestionHistory = new Map<string, Array<{ key: string; ts: number }>>();

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function humanizeColumnName(name: string, options: { stripAggregationPrefix?: boolean } = {}): string {
	const cleaned = name.trim().replace(/["`]/g, '');
	const spaced = cleaned
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_\.]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const words = spaced.split(' ').filter(Boolean);
	if (options.stripAggregationPrefix) {
		while (words.length > 1 && ['total', 'sum', 'avg', 'average', 'count', 'num', 'number'].includes(words[0].toLowerCase())) {
			words.shift();
		}
	}
	return words
		.map((word) => {
			if (/^[A-Z0-9]{2,}$/.test(word)) return word;
			return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
		})
		.join(' ');
}

function compactLabel(text: string, maxLength = 42): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxLength) return trimmed;
	const words = trimmed.split(/\s+/).filter(Boolean);
	let compact = '';
	for (const word of words) {
		const next = compact ? `${compact} ${word}` : word;
		if (next.length > maxLength - 3) break;
		compact = next;
	}
	if (compact.length >= 8) return `${compact.trim()}...`;
	return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function humanizeColumnLabel(
	name: string,
	options: { stripAggregationPrefix?: boolean; maxLength?: number } = {}
): string {
	return compactLabel(
		humanizeColumnName(name, { stripAggregationPrefix: options.stripAggregationPrefix }),
		options.maxLength ?? 24
	);
}

function humanizeColumnList(
	columns: Array<string | null | undefined>,
	options: { maxLength?: number; maxItems?: number } = {}
): string {
	const maxItems = options.maxItems ?? 2;
	const filtered = columns.filter((column): column is string => Boolean(column));
	const visible = filtered.slice(0, maxItems);
	const joined = visible
		.map((column) => humanizeColumnLabel(column, { stripAggregationPrefix: true, maxLength: 18 }))
		.join(' + ');
	const extraCount = filtered.length - visible.length;
	return compactLabel(extraCount > 0 ? `${joined} + ${extraCount} more` : joined, options.maxLength ?? 30);
}

function countRowsLabel(column: string): string {
	return compactLabel(`Count rows by ${humanizeColumnLabel(column, { stripAggregationPrefix: true, maxLength: 18 })}`, 38);
}

function stableHash(input: string): number {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function scoreNormalization(scores: number[]): { min: number; max: number } {
	if (scores.length === 0) return { min: 0, max: 1 };
	const min = Math.min(...scores);
	const max = Math.max(...scores);
	if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
		return { min: 0, max: 1 };
	}
	return { min, max };
}

function normalizedScore(score: number, range: { min: number; max: number }): number {
	if (range.max <= range.min) return 0.5;
	return clamp((score - range.min) / (range.max - range.min), 0, 1);
}

function getRecentHistory(namespace: string, now: number): Array<{ key: string; ts: number }> {
	const history = suggestionHistory.get(namespace) ?? [];
	const horizonMs = 8 * 60 * 60 * 1000;
	const recent = history.filter((entry) => now - entry.ts <= horizonMs);
	if (recent.length !== history.length) {
		suggestionHistory.set(namespace, recent);
	}
	return recent;
}

function pushHistory(namespace: string, keys: string[], now: number): void {
	if (keys.length === 0) return;
	const prior = suggestionHistory.get(namespace) ?? [];
	const merged = [...prior, ...keys.map((key) => ({ key, ts: now }))];
	const maxEntries = 30;
	suggestionHistory.set(namespace, merged.slice(-maxEntries));
}

function stageIntent(stage: GUIPipelineStage): DiversityIntent {
	switch (stage.type) {
		case 'append':
			return 'shape';
		case 'filter':
			return 'narrow';
		case 'group':
			return 'summarize';
		case 'sort':
			return 'rank';
		case 'select':
		case 'derive':
			return 'shape';
		case 'join':
			return 'enrich';
		case 'window':
			return 'summarize';
		case 'loop':
			return 'shape';
		case 'take':
			return 'sample';
		case 'from':
		case 'raw':
			return 'shape';
	}
}

function presetIntent(preset: StagePresetSuggestion): DiversityIntent {
	if (preset.preset.id === 'group-top') return 'summarize';
	if (preset.preset.id === 'top-metric') return 'rank';
	if (preset.preset.id === 'temporal-trend') return 'summarize';
	if (preset.preset.id === 'text-categorize') return 'shape';
	if (preset.preset.id === 'anomaly-scan') return 'narrow';
	if (preset.preset.id === 'frequency-ranking') return 'rank';
	if (preset.preset.id === 'cashflow-rollup') return 'summarize';
	if (preset.preset.id === 'dedup-latest') return 'shape';
	if (preset.preset.id === 'hierarchical-rollup') return 'summarize';
	if (preset.preset.id === 'contribution-total') return 'summarize';
	if (preset.preset.id === 'period-variance') return 'summarize';
	if (preset.preset.id === 'segment-anomaly') return 'narrow';
	if (preset.preset.id === 'null-hotspots') return 'narrow';
	if (preset.preset.id === 'duplicate-fingerprint') return 'narrow';
	if (preset.preset.id === 'cohort-retention') return 'summarize';
	if (preset.preset.id === 'funnel-dropoff') return 'summarize';
	if (preset.preset.id === 'outlier-explain') return 'narrow';
	if (preset.preset.id === 'seasonal-pattern') return 'summarize';
	if (preset.preset.id === 'efficiency-lens') return 'shape';
	if (preset.preset.id === 'drift-monitor') return 'narrow';
	if (preset.preset.id === 'append-union-stack') return 'enrich';
	if (preset.preset.id === 'window-rolling') return 'summarize';
	if (preset.preset.id === 'window-lag-delta') return 'narrow';
	if (preset.preset.id === 'loop-refine') return 'shape';
	return 'shape';
}

function diversifySuggestions<T>(input: {
	namespace: string;
	candidates: DiversityCandidate<T>[];
	limit: number;
	explorationStrength: number;
	now: number;
	minDistinctTypes?: number;
	minDistinctIntents?: number;
}): T[] {
	const pool = [...input.candidates];
	if (pool.length <= input.limit) {
		pushHistory(
			input.namespace,
			pool.map((candidate) => candidate.semanticKey),
			input.now
		);
		return pool.map((candidate) => candidate.item);
	}

	const minDistinctTypes = input.minDistinctTypes ?? 2;
	const minDistinctIntents = input.minDistinctIntents ?? 2;
	const scoreRange = scoreNormalization(pool.map((candidate) => candidate.score));
	const recent = getRecentHistory(input.namespace, input.now);
	const recentIndex = new Map<string, number>();
	for (let i = recent.length - 1; i >= 0; i--) {
		const entry = recent[i];
		if (!recentIndex.has(entry.key)) recentIndex.set(entry.key, i);
	}

	const selected: DiversityCandidate<T>[] = [];
	const selectedTypeCount = new Map<string, number>();
	const selectedIntentCount = new Map<DiversityIntent, number>();

	while (selected.length < input.limit && selected.length < pool.length) {
		let best: DiversityCandidate<T> | null = null;
		let bestScore = Number.NEGATIVE_INFINITY;

		for (const candidate of pool) {
			if (selected.some((entry) => entry.semanticKey === candidate.semanticKey)) continue;

			const base = normalizedScore(candidate.score, scoreRange);
			const selectedTypes = selectedTypeCount.size;
			const selectedIntents = selectedIntentCount.size;
			const typeSeenCount = selectedTypeCount.get(candidate.typeKey) ?? 0;
			const intentSeenCount = selectedIntentCount.get(candidate.intent) ?? 0;

			const recencyIdx = recentIndex.get(candidate.semanticKey);
			const recencyPenalty =
				recencyIdx === undefined
					? 0
					: Math.max(0, 1 - (recent.length - recencyIdx) / Math.max(1, recent.length));

			const typeCoverageBonus =
				typeSeenCount === 0 && selectedTypes < minDistinctTypes ? 0.22 : typeSeenCount === 0 ? 0.08 : 0;
			const intentCoverageBonus =
				intentSeenCount === 0 && selectedIntents < minDistinctIntents
					? 0.2
					: intentSeenCount === 0
						? 0.07
						: 0;
			const repetitionPenalty = typeSeenCount * 0.1 + intentSeenCount * 0.08;
			const noveltyBoost = (1 - recencyPenalty) * 0.13 * input.explorationStrength;
			const deterministicJitter =
				((stableHash(`${input.namespace}|${candidate.semanticKey}`) % 1000) / 1000 - 0.5) *
				(0.03 * input.explorationStrength);

			const composed =
				base * 0.72 +
				typeCoverageBonus +
				intentCoverageBonus +
				noveltyBoost +
				deterministicJitter -
				repetitionPenalty;

			if (composed > bestScore) {
				bestScore = composed;
				best = candidate;
			}
		}

		if (!best) break;
		selected.push(best);
		selectedTypeCount.set(best.typeKey, (selectedTypeCount.get(best.typeKey) ?? 0) + 1);
		selectedIntentCount.set(best.intent, (selectedIntentCount.get(best.intent) ?? 0) + 1);
	}

	pushHistory(
		input.namespace,
		selected.map((candidate) => candidate.semanticKey),
		input.now
	);

	return selected.map((candidate) => candidate.item);
}

function stageShapeSignature(stage: GUIPipelineStage): string {
	switch (stage.type) {
		case 'from':
			return `from:${stage.table ? 'bound' : 'empty'}:${stage.alias ? 'aliased' : 'plain'}`;
		case 'append':
			return `append:${stage.sources.length}`;
		case 'filter': {
			const ops = stage.conditions.map((condition) => condition.op).join(',') || 'none';
			return `filter:${stage.logic}:${stage.conditions.length}:${ops}`;
		}
		case 'select': {
			const bucket = stage.columns.length >= 10 ? 'wide' : stage.columns.length >= 4 ? 'mid' : 'narrow';
			return `select:${bucket}:${stage.columns.length}`;
		}
		case 'derive': {
			const modes = [...new Set(stage.columns.map((column) => column.expr.mode))].sort().join(',') || 'none';
			return `derive:${stage.columns.length}:${modes}`;
		}
		case 'group': {
			const funcs = stage.aggregations.map((agg) => agg.func).join(',') || 'none';
			return `group:${stage.by.length}:${stage.aggregations.length}:${funcs}`;
		}
		case 'window': {
			const dirs = stage.sortKeys.map((key) => key.dir).join(',') || 'none';
			const deriveModes = [...new Set(stage.derives.map((derive) => derive.expr.mode))].join(',') || 'none';
			return `window:${stage.frame}:${stage.sortKeys.length}:${dirs}:${stage.derives.length}:${deriveModes}`;
		}
		case 'loop':
			return `loop:${stage.body.trim().length > 0 ? 'filled' : 'empty'}`;
		case 'sort': {
			const dirs = stage.keys.map((key) => key.dir).join(',') || 'none';
			return `sort:${stage.keys.length}:${dirs}`;
		}
		case 'take':
			return `take:${stage.rangeFrom ? 'range' : 'limit'}:${stage.n ?? 0}:${stage.rangeFrom ?? ''}`;
		case 'join':
			return `join:${stage.joinType}:${stage.conditions.length}:${stage.alias ? 'aliased' : 'plain'}`;
		case 'raw':
			return `raw:${stage.prql.length > 0 ? 'filled' : 'empty'}`;
	}
}

function stageIntentPathSignature(stages: GUIPipelineStage[]): string {
	if (stages.length === 0) return 'root';
	return stages.map((stage) => stageIntent(stage)).join(' > ');
}

function stageShapePathSignature(stages: GUIPipelineStage[]): string {
	if (stages.length === 0) return 'root';
	return stages.map((stage) => stageShapeSignature(stage)).join(' > ');
}

function stageContextSignatures(stages: GUIPipelineStage[], schemaSignature: string): string[] {
	const typePath = stageTypeSignature(stages) || 'root';
	const shapePath = stageShapePathSignature(stages);
	const intentPath = stageIntentPathSignature(stages);
	const stageCount = stages.length;
	return [
		`pipeline=${typePath}|${schemaSignature}|variant=type`,
		`pipeline-shape=${shapePath}|${schemaSignature}|variant=shape`,
		`pipeline-intent=${intentPath}|${schemaSignature}|variant=intent`,
		`pipeline-depth=${stageCount}|${schemaSignature}|variant=depth`
	];
}

function hasUppercaseSignal(values: string[]): boolean {
	return values.some((value) => /[A-Z]/.test(value));
}

function hasWhitespaceSignal(values: string[]): boolean {
	return values.some((value) => /\s/.test(value));
}

function parseSampleValues(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((value) => String(value).trim())
			.filter(Boolean)
			.slice(0, 8);
	} catch {
		return [];
	}
}

function toSemanticDeriveColumns(profileRows: ProfileRow[]): SemanticDeriveColumn[] {
	return profileRows.map((row) => ({
		name: row.column_name,
		kind: row.data_kind,
		semanticType: row.semantic_type,
		confidence: Number(row.semantic_confidence ?? 0.45),
		nullRatio: Number(row.null_ratio ?? 0),
		distinctCount: Number(row.distinct_count ?? 0)
	}));
}

function parseNumericLike(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const isParenNegative = trimmed.startsWith('(') && trimmed.endsWith(')');
	const core = isParenNegative ? trimmed.slice(1, -1) : trimmed;
	const normalized = core.replace(/,/g, '').replace(/\s+/g, '');
	if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
	const parsed = Number(normalized);
	if (!Number.isFinite(parsed)) return null;
	return isParenNegative ? -parsed : parsed;
}

function pickFilterSampleValue(values: string[]): string {
	if (values.length === 0) return '';
	const lowered = values.map((value) => ({ value, lowered: value.toLowerCase() }));
	const preferred = ['active', 'open', 'enabled', 'true', 'yes'];
	for (const token of preferred) {
		const found = lowered.find((entry) => entry.lowered === token);
		if (found) return found.value;
	}
	return values[0] ?? '';
}

function pickNumericCutoff(values: string[]): string {
	const numeric = values
		.map((value) => parseNumericLike(value))
		.filter((value): value is number => value !== null)
		.sort((a, b) => a - b);
	if (numeric.length === 0) return '';
	const mid = Math.floor(numeric.length / 2);
	return String(numeric[mid] ?? numeric[0] ?? '');
}

function pickLatestDate(values: string[]): string {
	if (values.length === 0) return '';
	const onlyDates = values
		.map((value) => value.trim())
		.filter((value) => /^\d{4}-\d{2}-\d{2}/.test(value))
		.sort((a, b) => b.localeCompare(a));
	return onlyDates[0] ?? values[0] ?? '';
}

function buildTypeAwareFilter(profile: ProfileRow | undefined): FilterChipSuggestion | null {
	if (!profile?.column_name) return null;
	const values = parseSampleValues(profile.sample_values_json);
	const column = profile.column_name;
	const humanColumn = humanizeColumnLabel(column);
	const semantic = profile.semantic_type;

	if (semantic === 'status' || semantic === 'category') {
		if (profile.distinct_count < 2) return null;
		return {
			label: `Filter ${humanColumn}`,
			stage: {
				type: 'filter',
				conditions: [{ column, op: '==', value: '' }],
				logic: 'and'
			}
		};
	}

	if (semantic === 'flag') {
		const sample = pickFilterSampleValue(values) || 'true';
		return {
			label: `Keep ${humanColumn}`,
			stage: {
				type: 'filter',
				conditions: [{ column, op: '==', value: sample }],
				logic: 'and'
			}
		};
	}

	if (profile.data_kind === 'date') {
		const sample = pickLatestDate(values);
		return {
			label: sample ? compactLabel(`Recent ${humanColumn} from ${sample}`, 42) : `Filter ${humanColumn}`,
			stage: {
				type: 'filter',
				conditions: [{ column, op: '>=', value: sample }],
				logic: 'and'
			}
		};
	}

	if (profile.data_kind === 'boolean') {
		const sample = pickFilterSampleValue(values) || 'true';
		return {
			label: `Filter ${humanColumn}`,
			stage: {
				type: 'filter',
				conditions: [{ column, op: '==', value: sample }],
				logic: 'and'
			}
		};
	}

	if (profile.data_kind === 'numeric') {
		const sample = pickNumericCutoff(values);
		return {
			label: sample ? compactLabel(`${humanColumn} >= ${sample}`, 42) : compactLabel(`High ${humanColumn}`, 42),
			stage: {
				type: 'filter',
				conditions: [{ column, op: '>=', value: sample }],
				logic: 'and'
			}
		};
	}

	const sample = pickFilterSampleValue(values);
	return {
		label: `Filter ${humanColumn}`,
		stage: {
			type: 'filter',
			conditions: [{ column, op: '==', value: '' }],
			logic: 'and'
		}
	};
}

function buildSmarterDerive(profileRows: ProfileRow[]): DeriveChipSuggestion | null {
	const textLength = profileRows.find((row) => {
		if (row.data_kind !== 'text' || row.null_ratio > 0.85) return false;
		const semantic = row.semantic_type ?? 'text';
		if (semantic === 'url' || semantic === 'email' || semantic === 'phone') return false;
		const samples = parseSampleValues(row.sample_values_json);
		if (samples.length === 0) return /(text|description|content|summary|notes|body)/i.test(row.column_name);
		const avgLen = samples.reduce((acc, sample) => acc + sample.length, 0) / samples.length;
		return avgLen >= 50;
	});
	if (textLength?.column_name) {
		const column = textLength.column_name;
		return {
			label: compactLabel(`Measure ${humanizeColumnLabel(column)} length`, 42),
			stage: {
				type: 'derive',
				columns: [
					{
						name: `${column.replace(/\W+/g, '_')}_chars`,
						expr: { mode: 'func', func: 'length', args: [{ kind: 'column', value: column }] }
					}
				]
			}
		};
	}

	const percentage = profileRows.find(
		(row) =>
			(row.semantic_type === 'percentage' || row.semantic_type === 'ratio') &&
			row.null_ratio <= 0.7 &&
			(row.semantic_confidence ?? 0) >= 0.4
	);
	if (percentage?.column_name) {
		const column = percentage.column_name;
		const safe = column.replace(/\W+/g, '_');
		return {
			label: compactLabel(`Derive ${humanizeColumnLabel(column)} ratio`, 42),
			stage: {
				type: 'derive',
				columns: [
					{
						name: `${safe}_ratio`,
						expr: {
							mode: 'binary',
							left: { kind: 'column', value: column },
							op: '/',
							right: { kind: 'literal', value: '100' }
						}
					}
				]
			}
		};
	}

	const amount = profileRows.find(
		(row) => row.semantic_type === 'amount' && row.null_ratio <= 0.7 && (row.semantic_confidence ?? 0) >= 0.45
	);
	if (amount?.column_name) {
		const column = amount.column_name;
		const sampleValues = parseSampleValues(amount.sample_values_json);
		const hasFractional = sampleValues.some((value) => {
			const n = parseNumericLike(value);
			return n !== null && Math.floor(n) !== n;
		});
		if (!hasFractional) {
			return null;
		}
		return {
			label: compactLabel(`Round ${humanizeColumnLabel(column)} to 2 decimals`, 42),
			stage: {
				type: 'derive',
				columns: [
					{
						name: `${column.replace(/\W+/g, '_')}_rounded_2dp`,
						expr: { mode: 'func', func: 'round', args: [{ kind: 'column', value: column }] }
					}
				]
			}
		};
	}

	const numeric = profileRows.find(
		(row) =>
			row.data_kind === 'numeric' &&
			row.null_ratio <= 0.6 &&
			row.semantic_type !== 'id' &&
			row.semantic_type !== 'foreign_key' &&
			!isIdentifierLikeName(row.column_name)
	);
	if (numeric?.column_name) {
		const column = numeric.column_name;
		const sampleValues = parseSampleValues(numeric.sample_values_json);
		const hasFractional = sampleValues.some((value) => {
			const n = parseNumericLike(value);
			return n !== null && Math.floor(n) !== n;
		});
		const isCountLike = /(count|total|num|number|qty|quantity|jobs|visits|users|orders|records|rows)/i.test(column);
		const roundWorthy =
			hasFractional ||
			/(amount|price|cost|revenue|sales|avg|mean|ratio|rate|percent|pct|score|value|metric)/i.test(column);

		if (!roundWorthy && isCountLike) {
			return null;
		}

		return {
			label: compactLabel(`Round ${humanizeColumnLabel(column)}`, 42),
			stage: {
				type: 'derive',
				columns: [
					{
						name: `${column.replace(/\W+/g, '_')}_rounded`,
						expr: { mode: 'func', func: 'round', args: [{ kind: 'column', value: column }] }
					}
				]
			}
		};
	}

	const text = profileRows.find((row) => {
		if (
			row.data_kind !== 'text' ||
			row.null_ratio > 0.7 ||
			row.distinct_count < 2 ||
			(row.semantic_confidence ?? 0.5) < 0.35 ||
			row.semantic_type === 'description' ||
			row.semantic_type === 'json_blob'
		) {
			return false;
		}
		const samples = parseSampleValues(row.sample_values_json);
		return hasUppercaseSignal(samples) || hasWhitespaceSignal(samples);
	});
	if (text?.column_name) {
		const column = text.column_name;
		return {
			label: compactLabel(`Lowercase ${humanizeColumnLabel(column)}`, 42),
			stage: {
				type: 'derive',
				columns: [
					{
						name: `${column.replace(/\W+/g, '_')}_lower`,
						expr: { mode: 'func', func: 'lower', args: [{ kind: 'column', value: column }] }
					}
				]
			}
		};
	}

	return null;
}

function isPlaceholderValue(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (!normalized) return false;
	return /^(unavailable|unknown|n\/a|na|none|null|nil|undefined|missing|not available)$/.test(normalized);
}

function buildPlaceholderFilterSuggestions(profileRows: ProfileRow[]): FilterChipSuggestion[] {
	const suggestions: FilterChipSuggestion[] = [];
	for (const row of profileRows) {
		if (row.data_kind !== 'text' || row.null_ratio > 0.98) continue;
		const samples = parseSampleValues(row.sample_values_json);
		const placeholder = samples.find((value) => isPlaceholderValue(value));
		if (!placeholder) continue;
		suggestions.push({
			label: `Keep ${humanizeColumnName(row.column_name)} available`,
			stage: {
				type: 'filter',
				conditions: [{ column: row.column_name, op: '!=', value: placeholder }],
				logic: 'and'
			}
		});
	}
	return suggestions.slice(0, 2);
}

function buildDeriveCandidates(profileRows: ProfileRow[]): DeriveChipSuggestion[] {
	const candidates: DeriveChipSuggestion[] = [];
	const seen = new Set<string>();

	const add = (candidate: DeriveChipSuggestion | null) => {
		if (!candidate) return;
		const key = stageSemanticKey(candidate.stage);
		if (seen.has(key)) return;
		seen.add(key);
		candidates.push(candidate);
	};

	const semanticDerived = findSemanticDeriveCandidates(toSemanticDeriveColumns(profileRows));
	for (const candidate of semanticDerived) {
		if (candidate.expressionClass === 'bucket_aggregate' || candidate.expressionClass === 'group_aggregate') continue;
		const safeName = candidate.outputName.replace(/\W+/g, '_');
		if (candidate.expressionClass === 'multiply') {
			add({
				label: compactLabel(`Derive ${humanizeColumnLabel(candidate.outputName)} from ${humanizeColumnList([candidate.leftColumn, candidate.rightColumn], { maxLength: 26 })}`, 42),
				quality: candidate.quality,
				stage: {
					type: 'derive',
					columns: [
						{
							name: safeName,
							expr: {
								mode: 'binary',
								left: { kind: 'column', value: candidate.leftColumn },
								op: '*',
								right: { kind: 'column', value: candidate.rightColumn }
							}
						}
					]
				}
			});
		}
		if (candidate.expressionClass === 'subtract') {
			add({
				label: compactLabel(`Derive net flow from ${humanizeColumnList([candidate.leftColumn, candidate.rightColumn], { maxLength: 26 })}`, 42),
				quality: candidate.quality,
				stage: {
					type: 'derive',
					columns: [
						{
							name: safeName,
							expr: {
								mode: 'binary',
								left: { kind: 'column', value: candidate.leftColumn },
								op: '-',
								right: { kind: 'column', value: candidate.rightColumn }
							}
						}
					]
				}
			});
		}
		if (candidate.expressionClass === 'divide') {
			add({
				label: compactLabel(`Derive efficiency ratio from ${humanizeColumnList([candidate.leftColumn, candidate.rightColumn], { maxLength: 26 })}`, 42),
				quality: candidate.quality,
				stage: {
					type: 'derive',
					columns: [
						{
							name: safeName,
							expr: {
								mode: 'sstring',
								template: `${quotedSqlIdentifier(candidate.leftColumn)} / nullif(${quotedSqlIdentifier(candidate.rightColumn)}, 0)`
							}
						}
					]
				}
			});
		}
	}

	add(buildSmarterDerive(profileRows));

	const normalizedText = profileRows.find((row) => {
		if (row.data_kind !== 'text' || row.null_ratio > 0.7 || row.distinct_count < 2) return false;
		if (row.semantic_type === 'description' || row.semantic_type === 'json_blob') return false;
		const samples = parseSampleValues(row.sample_values_json);
		return samples.length > 0 && (hasUppercaseSignal(samples) || hasWhitespaceSignal(samples));
	});
	if (normalizedText?.column_name) {
		const column = normalizedText.column_name;
		add({
			label: compactLabel(`Lowercase ${humanizeColumnLabel(column)}`, 42),
			stage: {
				type: 'derive',
				columns: [
					{
						name: `${column.replace(/\W+/g, '_')}_lower`,
						expr: { mode: 'func', func: 'lower', args: [{ kind: 'column', value: column }] }
					}
				]
			}
		});
	}

	return candidates;
}

function pickCountDimension(profileRows: ProfileRow[], fallback: string | null): string | null {
	const preferred =
		profileRows.find((row) => /(genre|sub_?genre|mood|style|tag)/i.test(row.column_name) && row.distinct_count >= 2 && row.distinct_count <= 120 && row.null_ratio <= 0.8)?.column_name ??
		profileRows.find((row) => row.semantic_type === 'category' && row.distinct_count >= 2 && row.distinct_count <= 200)?.column_name ??
		profileRows.find((row) => row.semantic_type === 'status' && row.distinct_count >= 2 && row.distinct_count <= 200)?.column_name ??
		profileRows.find((row) => row.data_kind === 'text' && row.distinct_count >= 2 && row.distinct_count <= 250 && row.null_ratio <= 0.8)?.column_name ??
		profileRows.find((row) => /(type|category|segment|group)/i.test(row.column_name) && row.distinct_count >= 2 && row.distinct_count <= 500)?.column_name ??
		fallback;

	if (preferred) return preferred;

	return (
		profileRows.find((row) => row.data_kind === 'numeric' && /(collection|group|segment|bucket|partition)/i.test(row.column_name) && row.distinct_count >= 2 && row.distinct_count <= 200)?.column_name ??
		null
	);
}

const NON_METRIC_TYPES = new Set<ColumnSemanticType>([
	'id', 'foreign_key', 'created_at', 'updated_at', 'date',
	'event_time', 'event_type',
	'session_id', 'source_id', 'target_id', 'parent_id',
	'code', 'entity_name', 'status', 'flag', 'category',
	'description', 'json_blob', 'email', 'phone', 'url',
	'country', 'region', 'city', 'currency_code', 'postal_code', 'geo_point',
	'media_url', 'media_path', 'media_extension', 'latitude', 'longitude'
]);

function normalizedUsageScore(usage: number): number {
	if (!Number.isFinite(usage) || usage <= 0) return 0;
	return clamp(Math.log2(1 + usage) / 5, 0, 1);
}

function metricSemanticFit(row: ProfileRow): number {
	const semantic = row.semantic_type ?? 'text';
	if (semantic === 'unit_price') return 1;
	if (semantic === 'currency_amount') return 1;
	if (semantic === 'inflow' || semantic === 'outflow') return 0.96;
	if (semantic === 'numerator') return 0.92;
	if (semantic === 'denominator') return 0.84;
	if (semantic === 'amount') return 1;
	if (semantic === 'metric') return 0.66;
	if (semantic === 'volume_measure') return 0.85;
	if (semantic === 'quantity') return 0.88;
	if (semantic === 'ratio' || semantic === 'percentage') return 0.82;
	if (semantic === 'count') return 0.76;
	if (semantic === 'duration') return 0.72;
	if (semantic === 'session_id' || semantic === 'source_id' || semantic === 'target_id' || semantic === 'parent_id') return 0.04;
	if (semantic === 'ordinal_rank') return 0.38;
	if (semantic === 'binary_outcome') return 0.42;
	if (semantic === 'id' || semantic === 'foreign_key') return 0.04;
	if (semantic === 'created_at' || semantic === 'updated_at' || semantic === 'date') return 0.03;
	if (NON_METRIC_TYPES.has(semantic)) return 0.08;
	if (row.data_kind === 'numeric') return 0.62;
	return 0.18;
}

function dimensionSemanticFit(row: ProfileRow): number {
	const semantic = row.semantic_type ?? 'text';
	if (semantic === 'category' || semantic === 'status') return 1;
	if (semantic === 'region' || semantic === 'country' || semantic === 'city') return 0.95;
	if (semantic === 'postal_code') return 0.9;
	if (semantic === 'geo_point') return 0.84;
	if (semantic === 'entity_name') return 0.9;
	if (semantic === 'code') return 0.78;
	if (semantic === 'flag') return 0.74;
	if (semantic === 'id' || semantic === 'foreign_key') return 0.15;
	if (semantic === 'created_at' || semantic === 'updated_at' || semantic === 'date') return 0.12;
	if (semantic === 'description' || semantic === 'json_blob') return 0.22;
	if (row.data_kind === 'text') return 0.66;
	return 0.28;
}

function filterSemanticFit(row: ProfileRow): number {
	const semantic = row.semantic_type ?? 'text';
	if (semantic === 'flag') return 1;
	if (semantic === 'status' || semantic === 'category') return 0.95;
	if (semantic === 'event_time') return 0.68;
	if (semantic === 'updated_at' || semantic === 'created_at' || semantic === 'date') return 0.7;
	if (semantic === 'postal_code' || semantic === 'geo_point') return 0.78;
	if (semantic === 'region' || semantic === 'country' || semantic === 'city') return 0.82;
	if (semantic === 'entity_name') return 0.76;
	if (semantic === 'id' || semantic === 'foreign_key') return 0.2;
	if (semantic === 'description' || semantic === 'json_blob') return 0.18;
	if (row.data_kind === 'boolean') return 0.9;
	if (row.data_kind === 'date') return 0.82;
	return row.data_kind === 'text' ? 0.42 : 0.56;
}

function cardinalityFit(row: ProfileRow, role: ColumnIntentRole): number {
	const distinct = Math.max(0, Number(row.distinct_count ?? 0));
	if (role === 'metric') {
		if (distinct <= 1) return 0.1;
		if (distinct <= 5) return 0.34;
		if (distinct <= 20) return 0.62;
		if (distinct <= 500) return 1;
		return 0.88;
	}
	if (role === 'dimension') {
		if (distinct <= 1) return 0.1;
		if (distinct <= 150) return 1;
		if (distinct <= 500) return 0.75;
		return 0.36;
	}
	if (distinct <= 1) return 0.08;
	if (distinct <= 60) return 1;
	if (distinct <= 250) return 0.75;
	return 0.32;
}

function semanticFitByRole(row: ProfileRow, role: ColumnIntentRole): number {
	if (role === 'metric') return metricSemanticFit(row);
	if (role === 'dimension') return dimensionSemanticFit(row);
	return filterSemanticFit(row);
}

function usageFitByRole(
	column: string,
	role: ColumnIntentRole,
	usageByTypeAndColumn: Map<string, number>,
	usageByType: Map<StageType, number>
): number {
	const stageTypes: StageType[] = role === 'metric'
		? ['group', 'sort', 'derive']
		: role === 'dimension'
			? ['group', 'filter']
			: ['filter', 'sort'];

	const strongColumnSignal = stageTypes
		.map((stageType) => normalizedUsageScore(usageByTypeAndColumn.get(`${stageType}::${column}`) ?? 0))
		.reduce((acc, score) => Math.max(acc, score), 0);
	const stageAffinity = stageTypes
		.map((stageType) => normalizedUsageScore(usageByType.get(stageType) ?? 0))
		.reduce((acc, score) => Math.max(acc, score), 0);

	return clamp(strongColumnSignal * 0.74 + stageAffinity * 0.26, 0, 1);
}

function scoreColumnImportance(input: {
	row: ProfileRow;
	role: ColumnIntentRole;
	usageByTypeAndColumn?: Map<string, number>;
	usageByType?: Map<StageType, number>;
}): number {
	const usageByTypeAndColumn = input.usageByTypeAndColumn ?? new Map<string, number>();
	const usageByType = input.usageByType ?? new Map<StageType, number>();
	const confidence = normalizeConfidence(Number(input.row.semantic_confidence ?? 0.45));
	const semantic = semanticFitByRole(input.row, input.role);
	const quality = clamp((1 - clamp(input.row.null_ratio ?? 0, 0, 1)) * 0.62 + confidence * 0.38, 0, 1);
	const cardinality = cardinalityFit(input.row, input.role);
	const usage = usageFitByRole(input.row.column_name, input.role, usageByTypeAndColumn, usageByType);
	const distinct = Math.max(0, Number(input.row.distinct_count ?? 0));

	let score = semantic * 0.48 + quality * 0.27 + cardinality * 0.17 + usage * 0.08;

	if (input.role === 'metric' && (isIdentifierLikeName(input.row.column_name) || isTemporalLikeColumnName(input.row.column_name))) {
		score *= 0.08;
	}
	if (input.role === 'metric' && (input.row.semantic_type === 'session_id' || input.row.semantic_type === 'source_id' || input.row.semantic_type === 'target_id' || input.row.semantic_type === 'parent_id')) {
		score *= 0.08;
	}
	if (input.role !== 'metric' && input.row.data_kind === 'numeric' && /(amount|revenue|cost|price|balance|ratio|percent|pct|value|score|qty|quantity|count)/i.test(input.row.column_name)) {
		score *= 0.72;
	}
	if (input.role === 'dimension' && (input.row.semantic_type === 'status' || input.row.semantic_type === 'category') && distinct <= 2) {
		score *= 0.25;
	}
	if (input.role === 'dimension' && (input.row.semantic_type === 'entity_name') && Number(input.row.distinct_count ?? 0) > 450) {
		score *= 0.72;
	}
	if (input.role === 'dimension' && input.row.data_kind === 'numeric') {
		score *= 0.2;
	}
	if ((input.role === 'dimension' || input.role === 'filter') && /(name|title|label)/i.test(input.row.column_name) && Number(input.row.distinct_count ?? 0) > 180) {
		score *= 0.45;
	}
	if ((input.role === 'dimension' || input.role === 'filter') && distinct <= 1) {
		score *= 0.18;
	}
	if (input.role === 'filter' && (input.row.semantic_type === 'status' || input.row.semantic_type === 'category') && distinct < 2) {
		score *= 0.12;
	}
	if (input.role === 'filter' && Number(input.row.distinct_count ?? 0) > 600) {
		score *= 0.62;
	}

	return clamp(score, 0, 1);
}

function rankColumnsByImportance(input: {
	profileRows: ProfileRow[];
	role: ColumnIntentRole;
	usageByTypeAndColumn?: Map<string, number>;
	usageByType?: Map<StageType, number>;
	minScore?: number;
}): ColumnImportance[] {
	const usageByTypeAndColumn = input.usageByTypeAndColumn ?? new Map<string, number>();
	const usageByType = input.usageByType ?? new Map<StageType, number>();
	const uniqueRows = input.profileRows.filter(
		(row, idx, rows) => rows.findIndex((entry) => entry.column_name.trim().toLowerCase() === row.column_name.trim().toLowerCase()) === idx
	);
	const ranked = uniqueRows
		.map((row) => ({
			column: row.column_name,
			row,
			score: scoreColumnImportance({
				row,
				role: input.role,
				usageByTypeAndColumn,
				usageByType
			})
		}))
		.sort((a, b) => b.score - a.score);

	const minScore = input.minScore;
	if (minScore === undefined) return ranked;
	return ranked.filter((entry) => entry.score >= minScore);
}

function pickFilterProfile(
	profileRows: ProfileRow[],
	usageByTypeAndColumn: Map<string, number> = new Map(),
	usageByType: Map<StageType, number> = new Map()
): ProfileRow | undefined {
	const ranked = rankColumnsByImportance({
		profileRows,
		role: 'filter',
		usageByTypeAndColumn,
		usageByType,
		minScore: 0.36
	});
	return ranked[0]?.row;
}

function pickGroupDimension(
	profileRows: ProfileRow[],
	usageByTypeAndColumn: Map<string, number> = new Map(),
	usageByType: Map<StageType, number> = new Map()
): string | null {
	return rankColumnsByImportance({
		profileRows,
		role: 'dimension',
		usageByTypeAndColumn,
		usageByType,
		minScore: 0.44
	})[0]?.column ?? null;
}

function isTemporalLikeColumnName(name: string): boolean {
	const lower = name.trim().toLowerCase();
	if (lower.includes('createdat') || lower.includes('updatedat')) return true;
	if (lower.endsWith('_at') || /(?:\s|^)at$/.test(lower)) return true;
	return /(^|_|\b)(date|time|timestamp|deadline|due|expires?|created|updated)($|_|\b)/i.test(name);
}

function pickMetricColumn(
	profileRows: ProfileRow[],
	fallbackColumns: string[] = [],
	usageByTypeAndColumn: Map<string, number> = new Map(),
	usageByType: Map<StageType, number> = new Map()
): string | null {
	const ranked = rankColumnsByImportance({
		profileRows,
		role: 'metric',
		usageByTypeAndColumn,
		usageByType,
		minScore: 0.48
	});
	if (ranked.length > 0) return ranked[0]?.column ?? null;

	const metricNamePattern = /(amount|balance|total|sum|revenue|cost|price|value|score|count|qty|quantity|paid\s*in|withdrawn|debit|credit|inflow|outflow)/i;
	const weakMetricNamePattern = /(value\s*guess|estimated\s*value|guess)/i;
	if (ranked[0] && weakMetricNamePattern.test(ranked[0].column)) {
		return null;
	}
	const fallbackNameMatch = fallbackColumns.find((column) => metricNamePattern.test(column) && !isIdentifierLikeName(column) && !isTemporalLikeColumnName(column));
	if (fallbackNameMatch) return fallbackNameMatch;

	return null;
}

interface CompositeMetricPlan {
	name: string;
	priceColumn: string;
	quantityColumn: string;
	expressionSql: string;
}

function findCompositeMetricPlan(
	profileRows: ProfileRow[],
	fallbackColumns: string[] = [],
	dialect: CoercionDialect = 'duckdb'
): CompositeMetricPlan | null {
	const byColumn = new Map(profileRows.map((row) => [row.column_name, row]));
	const rowFor = (column: string): ProfileRow | undefined => byColumn.get(column);
	const deriveColumns: SemanticDeriveColumn[] = [
		...toSemanticDeriveColumns(profileRows),
		...fallbackColumns
			.filter((column) => !profileRows.some((row) => row.column_name === column))
			.map((column) => ({
				name: column,
				kind: 'numeric' as const,
				nullRatio: 0,
				distinctCount: 25,
				confidence: 0.45
			}))
	];
	const composed = findTopDeriveCandidate(deriveColumns, 'composed_metric');
	if (!composed) return null;

	const priceSql = `coalesce(${metricSqlExpr(composed.leftColumn, rowFor(composed.leftColumn), dialect)}, 0)`;
	const qtySql = `coalesce(${metricSqlExpr(composed.rightColumn, rowFor(composed.rightColumn), dialect)}, 0)`;
	return {
		name: 'revenue',
		priceColumn: composed.leftColumn,
		quantityColumn: composed.rightColumn,
		expressionSql: `${priceSql} * ${qtySql}`
	};
}

function metricAggregationFunc(profileRows: ProfileRow[], metricColumn: string): 'sum' | 'avg' | 'count' {
	const metric = profileRows.find((row) => row.column_name === metricColumn);
	if (!metric) return 'sum';
	if (metric.semantic_type === 'percentage' || metric.semantic_type === 'ratio') return 'avg';
	if (metric.semantic_type === 'count') return 'count';
	if (
		metric.semantic_type === 'metric' &&
		/(length|width|height|depth|diameter|radius|mass|weight|petal|sepal|measurement|score|index)/i.test(metricColumn)
	) {
		return 'avg';
	}
	return 'sum';
}

function quotedSqlIdentifier(column: string): string {
	return `\\"${column.replaceAll('"', '\\\\"')}\\"`;
}

function normalizeCoercionDialect(dialect?: CoercionDialect): CoercionDialect {
	if (dialect === 'postgres' || dialect === 'clickhouse') return dialect;
	return 'duckdb';
}

function metricSqlExpr(column: string, row: ProfileRow | undefined, dialect: CoercionDialect): string {
	const id = quotedSqlIdentifier(column);
	if (row?.data_kind === 'numeric') {
		if (dialect === 'clickhouse') return `toFloat64OrNull(${id})`;
		if (dialect === 'postgres') return `cast(${id} as double precision)`;
		return `cast(${id} as double)`;
	}
	if (row?.data_kind === 'boolean') return 'null';
	if (dialect === 'clickhouse') {
		return `toFloat64OrNull(replaceRegexpAll(toString(${id}), '[^0-9.+\\-]', ''))`;
	}
	if (dialect === 'postgres') {
		return `cast(nullif(regexp_replace(cast(${id} as varchar), '[^0-9.+\\-]', '', 'g'), '') as double precision)`;
	}
	return `cast(nullif(regexp_replace(cast(${id} as varchar), '[^0-9.+\\-]', '', 'g'), '') as double)`;
}

function temporalSqlExpr(column: string, row: ProfileRow | undefined, dialect: CoercionDialect): string {
	const id = quotedSqlIdentifier(column);
	if (row?.data_kind === 'date' || /(event_time|created_at|updated_at|date|timestamp)/i.test(row?.semantic_type ?? '')) {
		if (dialect === 'clickhouse') return `parseDateTime64BestEffortOrNull(toString(${id}))`;
		return `cast(${id} as timestamp)`;
	}
	if (row?.data_kind === 'numeric') {
		if (dialect === 'clickhouse') return `fromUnixTimestamp64Milli(toInt64OrNull(${id}))`;
		if (dialect === 'postgres') return `to_timestamp(cast(${id} as double precision) / 1000.0)`;
		return `to_timestamp(cast(${id} as double) / 1000)`;
	}
	if (row?.data_kind === 'boolean') return 'null';
	if (/(^|_|\b)(time|timestamp|date|deadline|due)($|_|\b)/i.test(column)) {
		if (dialect === 'clickhouse') return `parseDateTime64BestEffortOrNull(toString(${id}))`;
		return `cast(${id} as timestamp)`;
	}
	// Avoid dialect-specific temporal coercion for text-like columns.
	return '';
}

function firstFromTable(stages: GUIPipelineStage[]): string | null {
	const source = stages.find((stage): stage is Extract<GUIPipelineStage, { type: 'from' }> => stage.type === 'from');
	return source?.table?.trim() ? source.table.trim() : null;
}

function relationNameCandidates(relationName: string | null): string[] {
	if (!relationName) return [];
	const raw = relationName.trim();
	if (!raw) return [];
	const candidates = new Set<string>([raw]);
	const unquoted = raw.replace(/"/g, '');
	candidates.add(unquoted);
	const tail = unquoted.split('.').filter(Boolean).at(-1);
	if (tail) candidates.add(tail);
	return [...candidates].filter(Boolean);
}

function chipSemanticKey(chip: QuickChip): string {
	const stage = chip.stage;
	switch (stage.type) {
		case 'append':
			return `append:${stage.sources.slice(0, 6).join('|')}`;
		case 'filter': {
			const condition = stage.conditions[0];
			if (!condition) return 'filter:none';
			return `filter:${condition.column}:${condition.op}:${String(condition.value ?? '')}`;
		}
		case 'sort': {
			const key = stage.keys[0];
			if (!key) return 'sort:none';
			return `sort:${key.column}:${key.dir}`;
		}
		case 'group': {
			const by = stage.by[0] ?? '';
			const agg = stage.aggregations[0];
			if (!agg) return `group:${by}:none`;
			return `group:${by}:${agg.func}:${agg.column}`;
		}
		case 'derive': {
			const derived = stage.columns[0];
			if (!derived) return 'derive:none';
			if (derived.expr.mode === 'func') {
				const arg = derived.expr.args?.[0]?.kind === 'column' ? derived.expr.args[0].value : 'literal';
				return `derive:${derived.name}:func:${derived.expr.func}:${arg}`;
			}
			if (derived.expr.mode === 'binary') {
				const left = derived.expr.left?.kind === 'column' ? derived.expr.left.value : 'literal';
				const right = derived.expr.right?.kind === 'column' ? derived.expr.right.value : 'literal';
				return `derive:${derived.name}:binary:${left}:${derived.expr.op}:${right}`;
			}
			return `derive:${derived.name}:literal`;
		}
		case 'select':
			return `select:${stage.columns.slice(0, 6).join('|')}`;
		case 'take':
			return `take:${stage.n}`;
		case 'join': {
			const condition = stage.conditions[0];
			if (!condition) return `join:${stage.joinType}:${stage.table}:none`;
			return `join:${stage.joinType}:${stage.table}:${condition.left}:${condition.right}`;
		}
		case 'from':
			return `from:${stage.table}`;
		case 'window': {
			const key = stage.sortKeys[0];
			const derive = stage.derives[0];
			return `window:${stage.frame}:${key?.column ?? ''}:${key?.dir ?? ''}:${derive?.name ?? ''}`;
		}
		case 'loop':
			return `loop:${stage.body.slice(0, 40)}`;
	}
}

function fallbackQuickChipHydration(chip: {
	stage: Exclude<GUIPipelineStage, { type: 'raw' }>;
	label: string;
}): HydratedSuggestionMetadata {
	if (chip.stage.type === 'sort' || /newest|period|month|time|date/i.test(chip.label)) {
		return {
			semanticCategory: 'temporal',
			analysisPattern: 'Time-Series Forecasting & Window Aggregation',
			techniques: ['time ordering', 'window comparisons'],
			metricHints: ['trend direction', 'lag comparisons'],
			confidence: 0.72
		};
	}

	if (chip.stage.type === 'group') {
		return {
			semanticCategory: 'categorical',
			analysisPattern: 'Segmentation, Grouping & Classification',
			techniques: ['grouped rollups', 'segment comparisons'],
			metricHints: ['frequency counts', 'contingency-style slices'],
			confidence: 0.76
		};
	}

	if (chip.stage.type === 'derive') {
		return {
			semanticCategory: 'ratio-derived',
			analysisPattern: 'Performance Benchmarking & Decomposition',
			techniques: ['feature derivation', 'ratio decomposition'],
			metricHints: ['index vs baseline', 'variance from target'],
			confidence: 0.7
		};
	}

	if (chip.stage.type === 'filter') {
		return {
			semanticCategory: 'boolean',
			analysisPattern: 'Event Rate Analysis & Propensity Modeling',
			techniques: ['event slicing', 'propensity-oriented filtering'],
			metricHints: ['event rate', 'lift'],
			confidence: 0.68
		};
	}

	if (chip.stage.type === 'take') {
		return {
			semanticCategory: 'event-log',
			analysisPattern: 'Sequence Analysis & Funnel Reconstruction',
			techniques: ['sampled step inspection', 'funnel narrowing'],
			metricHints: ['drop-off surface area', 'session-length proxy'],
			confidence: 0.6
		};
	}

	return {
		semanticCategory: 'continuous-numeric',
		analysisPattern: 'Statistical Summarization & Predictive Modeling',
		techniques: ['distribution shaping', 'comparative ranking'],
		metricHints: ['mean', 'variance'],
		confidence: 0.62
	};
}

function ensureHydratedQuickChip(chip: QuickChip | Omit<QuickChip, 'hydration'>): QuickChip {
	if ('hydration' in chip && chip.hydration) return chip;
	return {
		...chip,
		hydration: fallbackQuickChipHydration(chip)
	};
}

function stageSemanticKey(stage: Exclude<GUIPipelineStage, { type: 'raw' }>): string {
	return chipSemanticKey({
		id: 'semantic',
		label: 'semantic',
		icon: 'filter',
		stage,
		tone: 'primary',
		hydration: fallbackQuickChipHydration({ stage, label: 'semantic' })
	});
}

function upsertQuickChip(
	chips: Array<QuickChip & { score: number }>,
	chip: QuickChip | Omit<QuickChip, 'hydration'>,
	score: number
): void {
	const hydratedChip = ensureHydratedQuickChip(chip);
	const nextKey = chipSemanticKey(hydratedChip);
	const index = chips.findIndex((entry) => chipSemanticKey(entry) === nextKey);
	if (index === -1) {
		chips.push({ ...hydratedChip, score });
		return;
	}
	if (score > chips[index].score) {
		chips[index] = { ...hydratedChip, score };
	}
}

function isMeaningfulStage(stage: Exclude<GUIPipelineStage, { type: 'raw' }>): boolean {
	switch (stage.type) {
		case 'from':
			return stage.table.trim().length > 0;
		case 'append':
			return stage.sources.length > 0 && stage.sources.every((source) => source.trim().length > 0);
		case 'filter':
			return stage.conditions.length > 0 && stage.conditions.every((condition) => condition.column.trim().length > 0);
		case 'select':
			return stage.columns.length > 0;
		case 'derive':
			return stage.columns.length > 0 && stage.columns.every((column) => column.name.trim().length > 0);
		case 'group':
			return stage.by.length > 0 && stage.aggregations.length > 0 && stage.aggregations.every((aggregation) => {
				if (aggregation.func === 'count' || aggregation.func === 'raw') return true;
				return aggregation.column.trim().length > 0;
			});
		case 'window':
			return stage.frame.trim().length > 0 && stage.derives.length > 0;
		case 'loop':
			return stage.body.trim().length > 0;
		case 'sort':
			return stage.keys.length > 0 && stage.keys.every((key) => key.column.trim().length > 0);
		case 'take':
			return Number(stage.n ?? 0) > 0 || Number(stage.rangeFrom ?? 0) > 0;
		case 'join':
			return stage.table.trim().length > 0 && stage.conditions.length > 0;
	}
}

function compactPresetStageChain(stages: Exclude<GUIPipelineStage, { type: 'raw' }>[]): Exclude<GUIPipelineStage, { type: 'raw' }>[] {
	return stages.filter((stage) => {
		if (stage.type === 'derive' && stage.columns.length === 0) return false;
		if (stage.type === 'sort' && stage.keys.length === 0) return false;
		if (stage.type === 'select' && stage.columns.length === 0) return false;
		return true;
	});
}

function stageUsageContextSuffixes(signature: string): string[] {
	const parts = signature
		.split(' > ')
		.map((part) => part.trim())
		.filter(Boolean);

	if (parts.length <= 1) return [];

	const suffixes = new Set<string>();
	suffixes.add(parts.slice(-1).join(' > '));
	if (parts.length >= 2) suffixes.add(parts.slice(-2).join(' > '));
	if (parts.length >= 3) suffixes.add(parts.slice(-3).join(' > '));

	return [...suffixes].filter((suffix) => suffix && suffix !== signature);
}

function decayByRecency(lastUsedMs: number | undefined, now: number): number {
	if (!lastUsedMs || !Number.isFinite(lastUsedMs)) return 0.8;
	const ageMs = Math.max(0, now - lastUsedMs);
	const halfLifeMs = 14 * 24 * 60 * 60 * 1000;
	const lambda = Math.log(2) / halfLifeMs;
	return Math.exp(-lambda * ageMs);
}

function schemaContextSignature(profileRows: ProfileRow[]): string {
	if (profileRows.length === 0) return 'schema:none';
	const semantics = [...new Set(profileRows.map((row) => row.semantic_type ?? 'text'))].sort().join('+');
	const kinds = [...new Set(profileRows.map((row) => row.data_kind))].sort().join('+');
	const avgConfidence =
		profileRows.reduce((acc, row) => acc + Number(row.semantic_confidence ?? 0.45), 0) / profileRows.length;
	return `schema|semantics=${semantics || 'none'}|kinds=${kinds || 'none'}|confidence=${confidenceBucket(avgConfidence)}`;
}

function parseDerivePattern(signatureKey: string): string | null {
	const match = signatureKey.match(/\bpattern=([^|]+)/i);
	if (!match) return null;
	const pattern = `${match[1] ?? ''}`.trim().toLowerCase();
	return pattern || null;
}

function loadDerivePatternStrength(rows: Array<{ signature_key?: string; usage_count?: number }>): Map<string, number> {
	const out = new Map<string, number>();
	for (const row of rows) {
		const pattern = parseDerivePattern(row.signature_key ?? '');
		if (!pattern) continue;
		const usage = Number(row.usage_count ?? 0);
		if (!Number.isFinite(usage) || usage <= 0) continue;
		out.set(pattern, (out.get(pattern) ?? 0) + usage);
	}
	return out;
}

function guessKindFromColumnName(columnName: string): 'numeric' | 'date' | 'boolean' | 'text' {
	const name = columnName.toLowerCase();
	if (/(^is_|^has_|flag|enabled|active|disabled|valid)/.test(name)) return 'boolean';
	if (isTemporalLikeColumnName(columnName)) return 'date';
	if (/(amount|price|cost|revenue|sales|income|fee|balance|paid|withdrawn|withdrawal|deposit|credited|debited|disbursed|percent|pct|ratio|rate|count|num|total|qty|quantity|value|score|id|_id$)/.test(name)) {
		return 'numeric';
	}
	return 'text';
}

function bootstrapProfilesFromColumns(columns: string[]): ProfileRow[] {
	return columns.map((column) => {
		const dataKind = guessKindFromColumnName(column);
		const inferred = inferColumnSemantics({
			columnName: column,
			dataKind,
			samples: [],
			nullRatio: 0,
			distinctCount: 25
		});
		return {
			column_name: column,
			data_kind: dataKind,
			semantic_type: inferred.semanticType,
			semantic_signature: inferred.signature,
			semantic_confidence: inferred.confidence,
			null_ratio: 0,
			distinct_count: 25,
			sample_values_json: '[]'
		};
	});
}

function isMeasurementFeatureName(name: string): boolean {
	return /(length|width|height|depth|diameter|radius|mass|weight|petal|sepal|measurement|feature|score|index)/i.test(name);
}

function isClassLikeColumnName(name: string): boolean {
	return /(species|class|target|label|outcome|iris)/i.test(name);
}

function detectFeatureMatrixSignal(profileRows: ProfileRow[]): {
	isFeatureMatrix: boolean;
	classColumn: string | null;
	featureColumns: string[];
} {
	const classCandidates = profileRows
		.filter((row) => {
			if (isIdentifierLikeName(row.column_name) || isTemporalLikeColumnName(row.column_name)) return false;
			if (row.data_kind !== 'text' && row.semantic_type !== 'category' && row.semantic_type !== 'status') return false;
			if (!isClassLikeColumnName(row.column_name)) return false;
			const distinct = Number(row.distinct_count ?? 0);
			if (distinct < 2 || distinct > 40) return false;
			return true;
		})
		.sort((a, b) => {
			const score = (row: ProfileRow): number => {
				let value = 0;
				if (isClassLikeColumnName(row.column_name)) value += 3;
				if (row.semantic_type === 'category' || row.semantic_type === 'status') value += 2;
				if (row.data_kind === 'text') value += 1;
				value -= Math.min(1, Math.abs(Number(row.distinct_count ?? 0) - 4) / 20);
				return value;
			};
			return score(b) - score(a);
		});

	const featureColumns = profileRows
		.filter((row) => {
			if (row.data_kind !== 'numeric') return false;
			if (isIdentifierLikeName(row.column_name) || isTemporalLikeColumnName(row.column_name)) return false;
			if (row.semantic_type === 'id' || row.semantic_type === 'foreign_key') return false;
			return isMeasurementFeatureName(row.column_name);
		})
		.map((row) => row.column_name);

	const hasTemporalAxis = profileRows.some((row) => row.data_kind === 'date' || isTemporalLikeColumnName(row.column_name));
	const classColumn = classCandidates[0]?.column_name ?? null;
	const isFeatureMatrix = featureColumns.length >= 3 && classColumn !== null && !hasTemporalAxis;

	return { isFeatureMatrix, classColumn, featureColumns };
}

function shouldDropGroupChip(chip: QuickChip, profileRows: ProfileRow[]): boolean {
	if (chip.stage.type !== 'group') return false;
	const agg = chip.stage.aggregations[0];
	if (!agg?.column) return false;
	const column = agg.column;
	if (isIdentifierLikeName(column)) return true;
	const profile = profileRows.find((row) => row.column_name === column);
	if (!profile) {
		return isTemporalLikeColumnName(column);
	}
	return (
		profile.semantic_type === 'id' ||
		profile.semantic_type === 'foreign_key' ||
		profile.semantic_type === 'created_at' ||
		profile.semantic_type === 'updated_at' ||
		profile.semantic_type === 'date' ||
		profile.data_kind === 'date'
	);
}

function shouldDropDeriveChip(chip: QuickChip, profileRows: ProfileRow[]): boolean {
	if (chip.stage.type !== 'derive') return false;
	const deriveExpr = chip.stage.columns[0]?.expr;
	const column = deriveExpr?.mode === 'func' && deriveExpr.args?.[0]?.kind === 'column' ? deriveExpr.args[0].value : '';
	if (!column) return false;
	const profile = profileRows.find((row) => row.column_name === column);
	if (!profile) return false;

	if (deriveExpr?.mode !== 'func' || deriveExpr.func !== 'lower') return false;

	const samples = parseSampleValues(profile.sample_values_json);
	if (samples.length === 0) return true;
	if (!hasUppercaseSignal(samples) && !hasWhitespaceSignal(samples)) return true;
	return false;
}

function shouldDropLowSignalFilterChip(chip: QuickChip, profileRows: ProfileRow[]): boolean {
	if (chip.stage.type !== 'filter') return false;
	const condition = chip.stage.conditions[0];
	if (!condition?.column) return false;
	const profile = profileRows.find((row) => row.column_name === condition.column);
	if (!profile) return false;
	if ((profile.semantic_type === 'status' || profile.semantic_type === 'category') && profile.distinct_count < 2) {
		return true;
	}
	return false;
}

function shouldDropLowSignalGroupChip(chip: QuickChip, profileRows: ProfileRow[]): boolean {
	if (chip.stage.type !== 'group') return false;
	const by = chip.stage.by[0];
	if (!by) return false;
	const profile = profileRows.find((row) => row.column_name === by);
	if (!profile) return false;
	return profile.distinct_count < 2;
}

function profileForColumn(profileRows: ProfileRow[], column: string): ProfileRow | undefined {
	const normalized = column.trim().toLowerCase();
	return profileRows.find((row) => row.column_name.trim().toLowerCase() === normalized);
}

function scopeProfileRowsToAvailableColumns(
	profileRows: ProfileRow[],
	availableColumns: string[]
): ProfileRow[] {
	if (availableColumns.length === 0) return profileRows;
	const availableSet = new Set(
		availableColumns
			.map((column) => column.trim().toLowerCase())
			.filter(Boolean)
	);
	if (availableSet.size === 0) return profileRows;
	return profileRows.filter((row) => availableSet.has(row.column_name.trim().toLowerCase()));
}

function stageSignalScore(input: {
	chip: QuickChip;
	profileRows: ProfileRow[];
	importanceByColumn: Map<string, number>;
	weightedUsageByTypeAndColumn: Map<string, number>;
	weightedUsageByType: Map<StageType, number>;
}): number {
	const { chip, profileRows, importanceByColumn, weightedUsageByTypeAndColumn, weightedUsageByType } = input;
	const usageTypeScore = normalizedUsageScore(weightedUsageByType.get(chip.stage.type) ?? 0);

	if (chip.stage.type === 'take') {
		return 0.52 + usageTypeScore * 0.18;
	}

	if (chip.stage.type === 'select') {
		const columns = chip.stage.columns;
		if (columns.length === 0) return 0.18;
		const avgImportance =
			columns.reduce((acc, column) => acc + (importanceByColumn.get(column) ?? 0.42), 0) /
			Math.max(1, columns.length);
		return clamp(avgImportance * 0.74 + usageTypeScore * 0.2, 0, 1);
	}

	if (chip.stage.type === 'sort') {
		const key = chip.stage.keys[0];
		if (!key?.column) return 0.12;
		const profile = profileForColumn(profileRows, key.column);
		const importance = importanceByColumn.get(key.column) ?? 0;
		const columnUsage = normalizedUsageScore(weightedUsageByTypeAndColumn.get(`sort::${key.column}`) ?? 0);
		const temporalBonus = profile && (profile.semantic_type === 'updated_at' || profile.semantic_type === 'created_at' || profile.semantic_type === 'date') ? 0.2 : 0;
		return clamp(importance * 0.62 + columnUsage * 0.2 + usageTypeScore * 0.1 + temporalBonus, 0, 1);
	}

	if (chip.stage.type === 'filter') {
		const condition = chip.stage.conditions[0];
		if (!condition?.column) return 0.12;
		const profile = profileForColumn(profileRows, condition.column);
		const importance = importanceByColumn.get(condition.column) ?? 0;
		const columnUsage = normalizedUsageScore(weightedUsageByTypeAndColumn.get(`filter::${condition.column}`) ?? 0);
		const genericEqualityPenalty = condition.op === '==' && `${condition.value ?? ''}`.trim() === '' ? 0.16 : 0;
		const placeholderPenalty =
			condition.op === '!=' && isPlaceholderValue(`${condition.value ?? ''}`)
				? (profile && (profile.semantic_type === 'status' || profile.semantic_type === 'category' || profile.semantic_type === 'region' || profile.semantic_type === 'country') ? 0.24 : 0.08)
				: 0;
		return clamp(importance * 0.68 + columnUsage * 0.2 + usageTypeScore * 0.12 - genericEqualityPenalty - placeholderPenalty, 0, 1);
	}

	if (chip.stage.type === 'derive') {
		const first = chip.stage.columns[0];
		if (!first) return 0.12;
		const sourceColumn =
			first.expr.mode === 'func' && first.expr.args?.[0]?.kind === 'column'
				? first.expr.args[0].value
				: first.expr.mode === 'binary' && first.expr.left?.kind === 'column'
					? first.expr.left.value
					: '';
		const importance = sourceColumn ? (importanceByColumn.get(sourceColumn) ?? 0) : 0.3;
		const columnUsage = sourceColumn ? normalizedUsageScore(weightedUsageByTypeAndColumn.get(`derive::${sourceColumn}`) ?? 0) : 0;
		return clamp(importance * 0.68 + columnUsage * 0.2 + usageTypeScore * 0.12, 0, 1);
	}

	if (chip.stage.type === 'group') {
		const by = chip.stage.by[0] ?? '';
		const agg = chip.stage.aggregations[0];
		const byImportance = by ? (importanceByColumn.get(by) ?? 0) : 0;
		const metricImportance = agg?.column ? (importanceByColumn.get(agg.column) ?? 0) : 0.5;
		const columnUsage = by ? normalizedUsageScore(weightedUsageByTypeAndColumn.get(`group::${by}`) ?? 0) : 0;
		return clamp(byImportance * 0.45 + metricImportance * 0.3 + columnUsage * 0.15 + usageTypeScore * 0.1, 0, 1);
	}

	return 0.4;
}

function shouldDropLowSignalStageChip(input: {
	chip: QuickChip;
	profileRows: ProfileRow[];
	importanceByColumn: Map<string, number>;
	weightedUsageByTypeAndColumn: Map<string, number>;
	weightedUsageByType: Map<StageType, number>;
}): boolean {
	const score = stageSignalScore(input);
	const typeUsage = normalizedUsageScore(input.weightedUsageByType.get(input.chip.stage.type) ?? 0);
	const dynamicFloor = (() => {
		if (input.chip.stage.type === 'take' || input.chip.stage.type === 'select') return 0.26;
		if (input.chip.stage.type === 'filter') {
			const condition = input.chip.stage.conditions[0];
			if (!condition?.column) return 0.25;
			const profile = profileForColumn(input.profileRows, condition.column);
			if (profile && (profile.semantic_type === 'status' || profile.semantic_type === 'category') && Number(profile.distinct_count ?? 0) >= 2) {
				return 0.19;
			}
			const hasConcreteValue = `${condition.value ?? ''}`.trim() !== '';
			return hasConcreteValue ? 0.21 : 0.24;
		}
		return 0.34;
	})();
	if (score >= dynamicFloor) return false;
	if (typeUsage >= 0.72) return false;
	return true;
}

function dropGenericFilterForColumn(
	chips: Array<QuickChip & { score: number }>,
	column: string
): void {
	for (let i = chips.length - 1; i >= 0; i--) {
		const chip = chips[i];
		if (chip.stage.type !== 'filter') continue;
		const condition = chip.stage.conditions[0];
		if (!condition || condition.column !== column) continue;
		if (condition.op === '==' && `${condition.value ?? ''}`.trim() === '') {
			chips.splice(i, 1);
		}
	}
}

export async function getIntelligentQuickChips(input: {
	connectionId: string;
	stages: GUIPipelineStage[];
	availableColumns: string[];
	coercionDialect?: CoercionDialect;
}): Promise<QuickChip[]> {
	const dialect = normalizeCoercionDialect(input.coercionDialect);
	const base = getQuickChips({ stages: input.stages, availableColumns: input.availableColumns });

	try {
		await ensureIntelligenceMetaTables();
		const pipelineSignature = stageTypeSignature(input.stages);
		const contextSuffixes = stageUsageContextSuffixes(pipelineSignature);
		const sourceTable = firstFromTable(input.stages);
		const now = nowMs();

		const exactUsageResult = await executeSQL(`
			SELECT pipeline_signature, stage_type, column_name, usage_count, last_used_ms
			FROM ${META_SCHEMA}.stage_usage
			WHERE connection_id = ${quoteLiteral(input.connectionId)}
			  AND pipeline_signature = ${quoteLiteral(pipelineSignature)}
			ORDER BY usage_count DESC, last_used_ms DESC
			LIMIT 40
		`);

		let suffixUsageRows: UsageRow[] = [];
		if (contextSuffixes.length > 0) {
			const suffixPredicates = contextSuffixes.map((suffix) => `pipeline_signature LIKE ${quoteLiteral(`%${suffix}`)}`);
			const suffixResult = await executeSQL(`
				SELECT pipeline_signature, stage_type, column_name, usage_count, last_used_ms
				FROM ${META_SCHEMA}.stage_usage
				WHERE connection_id = ${quoteLiteral(input.connectionId)}
				  AND pipeline_signature <> ${quoteLiteral(pipelineSignature)}
				  AND (${suffixPredicates.join(' OR ')})
				ORDER BY usage_count DESC, last_used_ms DESC
				LIMIT 80
			`);
			suffixUsageRows = suffixResult.rows as unknown as UsageRow[];
		}

		const globalUsageResult = await executeSQL(`
			SELECT pipeline_signature, stage_type, column_name, usage_count, last_used_ms
			FROM ${META_SCHEMA}.stage_usage
			WHERE connection_id = ${quoteLiteral(input.connectionId)}
			ORDER BY last_used_ms DESC, usage_count DESC
			LIMIT 120
		`);

		const exactUsageRows = exactUsageResult.rows as unknown as UsageRow[];
		const globalUsageRows = globalUsageResult.rows as unknown as UsageRow[];
		const weightedUsageByType = new Map<StageType, number>();
		const weightedUsageByTypeAndColumn = new Map<string, number>();
		const seenUsageRows = new Set<string>();

		for (const context of [
			{ rows: exactUsageRows, weight: 1 },
			{ rows: suffixUsageRows, weight: 0.65 },
			{ rows: globalUsageRows, weight: 0.25 }
		]) {
			for (const row of context.rows) {
				const rowKey = `${row.pipeline_signature ?? ''}|${row.stage_type}|${row.column_name ?? ''}`;
				if (seenUsageRows.has(rowKey)) continue;
				seenUsageRows.add(rowKey);

				const baseUsage = Number(row.usage_count ?? 0);
				if (!Number.isFinite(baseUsage) || baseUsage <= 0) continue;

				const recency = decayByRecency(Number(row.last_used_ms ?? 0), now);
				const weightedUsage = baseUsage * context.weight * recency;
				if (weightedUsage <= 0) continue;

				const stageType = row.stage_type;
				weightedUsageByType.set(stageType, (weightedUsageByType.get(stageType) ?? 0) + weightedUsage);

				const column = (row.column_name ?? '').trim();
				if (!column) continue;
				const key = `${stageType}::${column}`;
				weightedUsageByTypeAndColumn.set(key, (weightedUsageByTypeAndColumn.get(key) ?? 0) + weightedUsage);
			}
		}

		let sourceProfileRows: ProfileRow[] = [];
		if (sourceTable) {
			const relationCandidates = relationNameCandidates(sourceTable);
			const relationPredicate =
				relationCandidates.length > 0
					? `relation_name IN (${relationCandidates.map((name) => quoteLiteral(name)).join(', ')})`
					: `relation_name = ${quoteLiteral(sourceTable)}`;
			const profileResult = await executeSQL(`
				SELECT column_name, data_kind, semantic_type, semantic_signature, semantic_confidence, null_ratio, distinct_count, sample_values_json
				FROM ${META_SCHEMA}.column_profiles
				WHERE connection_id = ${quoteLiteral(input.connectionId)}
				  AND ${relationPredicate}
				ORDER BY seen_count DESC, last_seen_ms DESC
			`);
			sourceProfileRows = profileResult.rows as unknown as ProfileRow[];
		}

		const resultProfileResult = await executeSQL(`
			SELECT cp.column_name, cp.data_kind, cp.semantic_type, cp.semantic_signature, cp.semantic_confidence, cp.null_ratio, cp.distinct_count, cp.sample_values_json,
				tp.relation_name, tp.last_seen_ms
			FROM ${META_SCHEMA}.column_profiles cp
			JOIN ${META_SCHEMA}.table_profiles tp
			  ON tp.connection_id = cp.connection_id
			 AND tp.relation_name = cp.relation_name
			WHERE cp.connection_id = ${quoteLiteral(input.connectionId)}
			  AND tp.source_kind = 'cell-result'
			ORDER BY tp.last_seen_ms DESC
			LIMIT 500
		`);
		const resultRows = resultProfileResult.rows as unknown as ResultProfileRow[];
		const rowsByRelation = new Map<string, ResultProfileRow[]>();
		for (const row of resultRows) {
			const relation = `${row.relation_name ?? ''}`.trim();
			if (!relation) continue;
			const bucket = rowsByRelation.get(relation) ?? [];
			bucket.push(row);
			rowsByRelation.set(relation, bucket);
		}

		const availableSet = new Set(input.availableColumns.map((column) => column.trim()).filter(Boolean));
		const hasKnownAvailableColumns = availableSet.size > 0;
		let bestResultProfiles: ProfileRow[] = [];
		let bestScore = -1;
		for (const rows of rowsByRelation.values()) {
			const overlap = rows.reduce(
				(acc, row) => acc + (availableSet.size === 0 || availableSet.has(row.column_name) ? 1 : 0),
				0
			);
			if (hasKnownAvailableColumns && overlap === 0) {
				continue;
			}
			const coverage = rows.length > 0 ? overlap / rows.length : 0;
			const score = overlap * 1000 + coverage * 200 + Number(rows[0]?.last_seen_ms ?? 0);
			if (score > bestScore) {
				bestScore = score;
				bestResultProfiles = rows.map((row) => ({
					column_name: row.column_name,
					data_kind: row.data_kind,
					semantic_type: row.semantic_type,
					semantic_signature: row.semantic_signature,
					semantic_confidence: row.semantic_confidence,
					null_ratio: row.null_ratio,
					distinct_count: row.distinct_count,
					sample_values_json: row.sample_values_json
				}));
			}
		}

		let profileRows: ProfileRow[] = sourceProfileRows.length > 0 ? sourceProfileRows : bestResultProfiles;
		let bootstrappedFromColumns = false;
		const scopedProfileRows = scopeProfileRowsToAvailableColumns(profileRows, input.availableColumns);
		if (scopedProfileRows.length > 0) {
			profileRows = scopedProfileRows;
		}

		if (profileRows.length === 0 && input.availableColumns.length > 0) {
			profileRows = bootstrapProfilesFromColumns(input.availableColumns);
			bootstrappedFromColumns = true;
		}

		const metadataColumns = profileRows.map((row) => row.column_name).filter(Boolean);
		const candidateColumns =
			input.availableColumns.length > 0
				? input.availableColumns
				: metadataColumns;

		const metadataBase = getQuickChips({ stages: input.stages, availableColumns: candidateColumns });
		const scored: Array<QuickChip & { score: number }> = (metadataBase.length > 0 ? metadataBase : base)
			.filter((chip) => !shouldDropGroupChip(chip, profileRows))
			.filter((chip) => !shouldDropDeriveChip(chip, profileRows))
			.filter((chip) => !shouldDropLowSignalFilterChip(chip, profileRows))
			.filter((chip) => !shouldDropLowSignalGroupChip(chip, profileRows))
			.map((chip, idx) => ({
				...chip,
				score: Math.max(6, 24 - idx * 2)
			}));

		const schemaContext = schemaContextSignature(profileRows);
		const contextSignatures = stageContextSignatures(input.stages, schemaContext);
		const contextPredicates = contextSignatures.map((signature) => `context_signature = ${quoteLiteral(signature)}`);
		const sequenceRows: Array<{
			context_signature?: string;
			next_stage: StageType;
			usage_count: number;
			last_used_ms?: number;
		}> = [];
		if (contextPredicates.length > 0) {
			const sequenceUsageResult = await executeSQL(`
				SELECT context_signature, next_stage, usage_count, last_used_ms
				FROM ${META_SCHEMA}.stage_sequence_usage
				WHERE connection_id = ${quoteLiteral(input.connectionId)}
				  AND (${contextPredicates.join(' OR ')})
				ORDER BY usage_count DESC, last_used_ms DESC
				LIMIT 40
			`);
			sequenceRows.push(...(sequenceUsageResult.rows as Array<{
				context_signature?: string;
				next_stage: StageType;
				usage_count: number;
				last_used_ms?: number;
			}>));
		}
		const sequenceBoostByType = new Map<StageType, number>();
		for (const row of sequenceRows) {
			const usage = Number(row.usage_count ?? 0);
			if (!Number.isFinite(usage) || usage <= 0) continue;
			const recency = decayByRecency(Number(row.last_used_ms ?? 0), now);
			const signature = row.context_signature ?? '';
			const contextWeight = signature.includes('variant=type')
				? 1
				: signature.includes('variant=shape')
					? 0.82
					: signature.includes('variant=intent')
						? 0.74
						: 0.66;
			const strength = usage * recency * contextWeight;
			sequenceBoostByType.set(row.next_stage, (sequenceBoostByType.get(row.next_stage) ?? 0) + strength);
		}

		let schemaFamiliarityBoost = 0;
		const derivePatternStrength = new Map<string, number>();
		if (sourceTable) {
			const relationCandidates = relationNameCandidates(sourceTable);
			const relationPredicate =
				relationCandidates.length > 0
					? `relation_name IN (${relationCandidates.map((name) => quoteLiteral(name)).join(', ')})`
					: `relation_name = ${quoteLiteral(sourceTable)}`;
			const schemaUsageResult = await executeSQL(`
				SELECT usage_count
				FROM ${META_SCHEMA}.signature_usage
				WHERE connection_id = ${quoteLiteral(input.connectionId)}
				  AND ${relationPredicate}
				  AND signature_type = 'schema'
				ORDER BY usage_count DESC
				LIMIT 1
			`);
			const usage = Number((schemaUsageResult.rows as Array<{ usage_count?: number }>)[0]?.usage_count ?? 0);
			if (Number.isFinite(usage) && usage > 0) {
				schemaFamiliarityBoost = Math.min(3, Math.log2(1 + usage));
			}

			const deriveUsageResult = await executeSQL(`
				SELECT signature_key, usage_count
				FROM ${META_SCHEMA}.signature_usage
				WHERE connection_id = ${quoteLiteral(input.connectionId)}
				  AND ${relationPredicate}
				  AND signature_type = 'derive'
				ORDER BY usage_count DESC
				LIMIT 20
			`);
			const deriveStrength = loadDerivePatternStrength(
				deriveUsageResult.rows as Array<{ signature_key?: string; usage_count?: number }>
			);
			for (const [pattern, score] of deriveStrength.entries()) {
				derivePatternStrength.set(pattern, score);
			}
		}

		const rankedMetrics = rankColumnsByImportance({
			profileRows,
			role: 'metric',
			usageByTypeAndColumn: weightedUsageByTypeAndColumn,
			usageByType: weightedUsageByType,
			minScore: 0.42
		});
		const rankedDimensions = rankColumnsByImportance({
			profileRows,
			role: 'dimension',
			usageByTypeAndColumn: weightedUsageByTypeAndColumn,
			usageByType: weightedUsageByType,
			minScore: 0.38
		});
		const rankedFilters = rankColumnsByImportance({
			profileRows,
			role: 'filter',
			usageByTypeAndColumn: weightedUsageByTypeAndColumn,
			usageByType: weightedUsageByType,
			minScore: 0.35
		});
		const featureMatrixSignal = detectFeatureMatrixSignal(profileRows);
		const importanceByColumn = new Map<string, number>();
		for (const ranked of [rankedMetrics, rankedDimensions, rankedFilters]) {
			for (const entry of ranked) {
				importanceByColumn.set(
					entry.column,
					Math.max(importanceByColumn.get(entry.column) ?? 0, entry.score)
				);
			}
		}

		for (let i = scored.length - 1; i >= 0; i--) {
			const chip = scored[i];
			if (
				shouldDropLowSignalStageChip({
					chip,
					profileRows,
					importanceByColumn,
					weightedUsageByTypeAndColumn,
					weightedUsageByType
				})
			) {
				scored.splice(i, 1);
			}
		}

		const topMetric = rankedMetrics[0];
		const hasStrongMetric =
			(topMetric?.score ?? 0) >= 0.56 &&
			normalizeConfidence(Number(topMetric?.row.semantic_confidence ?? 0)) >= 0.35 &&
			Number(topMetric?.row.null_ratio ?? 1) <= 0.6;
		const numeric = hasStrongMetric ? topMetric?.column ?? null : null;
		const date =
			profileRows.find((row) => row.semantic_type === 'event_time')?.column_name ??
			profileRows.find((row) => row.semantic_type === 'updated_at')?.column_name ??
			profileRows.find((row) => row.semantic_type === 'created_at')?.column_name ??
			profileRows.find((row) => row.data_kind === 'date' && row.null_ratio <= 0.8)?.column_name;
		const dimension =
			rankedDimensions[0]?.column ??
			pickGroupDimension(profileRows, weightedUsageByTypeAndColumn, weightedUsageByType) ??
			profileRows.find((row) => (row.semantic_type === 'event_time' || row.semantic_type === 'updated_at' || row.semantic_type === 'created_at' || row.semantic_type === 'date') && row.null_ratio <= 0.85)?.column_name ??
			profileRows.find((row) => row.data_kind === 'text' && row.distinct_count >= 2 && row.distinct_count <= 250)?.column_name ??
			null;
		const filterProfile = pickFilterProfile(profileRows, weightedUsageByTypeAndColumn, weightedUsageByType) ?? rankedFilters[0]?.row;
		const filterColumn = filterProfile?.column_name;
		const filterSuggestion = buildTypeAwareFilter(filterProfile);
		const deriveSuggestions = buildDeriveCandidates(profileRows);
		const placeholderFilters = buildPlaceholderFilterSuggestions(profileRows);
		const countDimension = pickCountDimension(profileRows, dimension);

		if (featureMatrixSignal.isFeatureMatrix && featureMatrixSignal.classColumn) {
			for (let i = scored.length - 1; i >= 0; i--) {
				const chip = scored[i];
				if (chip.stage.type === 'group' && chip.stage.by[0] !== featureMatrixSignal.classColumn) {
					scored.splice(i, 1);
					continue;
				}
				if (chip.stage.type === 'filter' && chip.stage.conditions[0]?.column) {
					const profile = profileForColumn(profileRows, chip.stage.conditions[0].column);
					if (profile?.data_kind === 'numeric') {
						scored.splice(i, 1);
						continue;
					}
				}
				if (chip.stage.type === 'derive' && /round|lowercase/i.test(chip.label)) {
					scored.splice(i, 1);
				}
			}

			const primaryFeature = featureMatrixSignal.featureColumns[0] ?? numeric ?? null;
			if (primaryFeature) {
				const featureAlias = primaryFeature.replace(/\W+/g, '_');
				upsertQuickChip(scored, {
					id: `group-${featureMatrixSignal.classColumn}-${primaryFeature}-avg`,
					label: compactLabel(`Average ${humanizeColumnLabel(primaryFeature, { stripAggregationPrefix: true, maxLength: 18 })} by ${humanizeColumnLabel(featureMatrixSignal.classColumn, { stripAggregationPrefix: true, maxLength: 18 })}`, 42),
					icon: 'group',
					stage: {
						type: 'group',
						by: [featureMatrixSignal.classColumn],
						aggregations: [{ name: `avg_${featureAlias}`, func: 'average', column: primaryFeature }]
					},
					tone: 'primary'
				}, 39);
			}

			const classProfile = profileForColumn(profileRows, featureMatrixSignal.classColumn);
			const classSample = pickFilterSampleValue(parseSampleValues(classProfile?.sample_values_json));
			upsertQuickChip(scored, {
				id: `group-count-${featureMatrixSignal.classColumn}`,
				label: compactLabel(`Count rows by ${humanizeColumnLabel(featureMatrixSignal.classColumn, { stripAggregationPrefix: true, maxLength: 18 })}`, 38),
				icon: 'group',
				stage: {
					type: 'group',
					by: [featureMatrixSignal.classColumn],
					aggregations: [{ name: `count_${featureMatrixSignal.classColumn.replace(/\W+/g, '_')}`, func: 'count', column: '' }]
				},
				tone: 'primary'
			}, 34);

			upsertQuickChip(scored, {
				id: `filter-${featureMatrixSignal.classColumn}-class`,
				label: classSample
					? compactLabel(`Filter ${humanizeColumnLabel(featureMatrixSignal.classColumn)} = ${classSample}`, 42)
					: `Filter ${humanizeColumnLabel(featureMatrixSignal.classColumn)}`,
				icon: 'filter',
				stage: {
					type: 'filter',
					conditions: [{ column: featureMatrixSignal.classColumn, op: '==', value: classSample ?? '' }],
					logic: 'and'
				},
				tone: 'primary'
			}, 32);
		}

		if (date) {
			upsertQuickChip(scored, {
				id: `sort-${date}`,
				label: compactLabel(`Newest by ${humanizeColumnLabel(date)}`, 42),
				icon: 'sort',
				stage: { type: 'sort', keys: [{ column: date, dir: 'desc' }] },
				tone: 'primary'
			}, 36);
		}

		if (filterColumn) {
			const fallbackFilter = {
				label: `Filter ${humanizeColumnLabel(filterColumn)}`,
				stage: {
					type: 'filter',
					conditions: [{ column: filterColumn, op: '==', value: '' }],
					logic: 'and'
				} as Extract<GUIPipelineStage, { type: 'filter' }>
			};
			const resolvedFilter = filterSuggestion ?? fallbackFilter;
			if (filterSuggestion) {
				dropGenericFilterForColumn(scored, filterColumn);
			}
			upsertQuickChip(scored, {
				id: `filter-${filterColumn}`,
				label: resolvedFilter.label,
				icon: 'filter',
				stage: resolvedFilter.stage,
				tone: 'primary'
			}, 30);
		}

		for (const placeholderFilter of placeholderFilters) {
			const placeholderColumn = placeholderFilter.stage.conditions[0]?.column ?? '';
			const placeholderProfile = placeholderColumn ? profileForColumn(profileRows, placeholderColumn) : undefined;
			const placeholderScore =
				placeholderProfile && (placeholderProfile.semantic_type === 'url' || placeholderProfile.semantic_type === 'email' || placeholderProfile.semantic_type === 'phone')
					? 26
					: 14;
			upsertQuickChip(scored, {
				id: `filter-quality-${placeholderFilter.stage.conditions[0]?.column ?? 'quality'}`,
				label: placeholderFilter.label,
				icon: 'filter',
				stage: placeholderFilter.stage,
				tone: 'primary'
			}, placeholderScore);
		}

		if (dimension && numeric && dimension !== numeric && hasStrongMetric) {
			const aggFunc = metricAggregationFunc(profileRows, numeric);
			const metricAlias = numeric.replace(/\W+/g, '_');
			const verb = aggFunc === 'avg' ? 'Average' : aggFunc.charAt(0).toUpperCase() + aggFunc.slice(1);
			upsertQuickChip(scored, {
				id: `group-${dimension}-${numeric}`,
				label: compactLabel(`${verb} ${humanizeColumnLabel(numeric, { stripAggregationPrefix: true, maxLength: 18 })} by ${humanizeColumnLabel(dimension, { stripAggregationPrefix: true, maxLength: 18 })}`, 42),
				icon: 'group',
				stage: {
					type: 'group',
					by: [dimension],
					aggregations: [{ name: `${aggFunc}_${metricAlias}`, func: aggFunc, column: numeric }]
				},
				tone: 'primary'
			}, 29);
		} else if (dimension && !numeric) {
			const dimAlias = dimension.replace(/\W+/g, '_');
			upsertQuickChip(scored, {
				id: `group-${dimension}-count`,
				label: countRowsLabel(dimension),
				icon: 'group',
				stage: {
					type: 'group',
					by: [dimension],
					aggregations: [{ name: `count_${dimAlias}`, func: 'count', column: '' }]
				},
				tone: 'primary'
			}, 26);
		}

		if (countDimension) {
			const dimAlias = countDimension.replace(/\W+/g, '_');
			upsertQuickChip(scored, {
				id: `group-count-${countDimension}`,
				label: countRowsLabel(countDimension),
				icon: 'group',
				stage: {
					type: 'group',
					by: [countDimension],
					aggregations: [{ name: `count_${dimAlias}`, func: 'count', column: '' }]
				},
				tone: 'primary'
			}, 27);
		}

		for (const deriveSuggestion of deriveSuggestions) {
			const deriveColumn = deriveSuggestion.stage.columns[0]?.name ?? (numeric ?? 'derived');
			const qualityBoost = Math.round((deriveSuggestion.quality ?? 0.4) * 10);
			upsertQuickChip(scored, {
				id: `derive-${deriveColumn}`,
				label: deriveSuggestion.label,
				icon: 'derive',
				stage: deriveSuggestion.stage,
				tone: 'accent'
			}, (deriveSuggestion.label.toLowerCase().includes('length') ? 27 : 22) + qualityBoost);
		}

		const boosted = scored.map((chip) => {
			const typeStrength = weightedUsageByType.get(chip.stage.type) ?? 0;
			const typeBoost = typeStrength > 0 ? Math.min(12, Math.log2(1 + typeStrength) * 4) : 0;
			const sequenceStrength = sequenceBoostByType.get(chip.stage.type) ?? 0;
			const sequenceBoost = sequenceStrength > 0 ? Math.min(10, Math.log2(1 + sequenceStrength) * 5) : 0;

			const primaryColumn = extractPrimaryColumn(chip.stage).trim();
			const columnKey = primaryColumn ? `${chip.stage.type}::${primaryColumn}` : '';
			const columnStrength = columnKey ? (weightedUsageByTypeAndColumn.get(columnKey) ?? 0) : 0;
			const columnBoost = columnStrength > 0 ? Math.min(10, Math.log2(1 + columnStrength) * 5) : 0;
			const semanticConfidenceBoost = primaryColumn
				? Math.min(
					6,
					(profileRows.find((row) => row.column_name === primaryColumn)?.semantic_confidence ?? 0.35) * 6
				)
				: 0;
			const importanceBoost = Math.min(7, (importanceByColumn.get(primaryColumn) ?? 0) * 7);
			const pairBoost = chip.stage.type === 'group'
				? (() => {
					const by = chip.stage.by[0] ?? '';
					const metric = chip.stage.aggregations[0]?.column ?? '';
					const byImportance = importanceByColumn.get(by) ?? 0;
					const metricImportance = importanceByColumn.get(metric) ?? 0;
					if (!metric || chip.stage.aggregations[0]?.func === 'count') {
						return Math.min(2.4, byImportance * 2.4);
					}
					return Math.min(4.2, (byImportance * 0.45 + metricImportance * 0.55) * 4.2);
				})()
				: 0;
			const stageQuality = stageSignalScore({
				chip,
				profileRows,
				importanceByColumn,
				weightedUsageByTypeAndColumn,
				weightedUsageByType
			});
			const stageQualityBoost = Math.min(6.5, stageQuality * 6.5);
			const derivePatternBoost = chip.stage.type === 'derive'
				? (() => {
					const composed = derivePatternStrength.get('composed_metric') ?? 0;
					const ratio = derivePatternStrength.get('efficiency_ratio') ?? 0;
					const flow = derivePatternStrength.get('flow_delta') ?? 0;
					const prior = Math.max(composed, ratio, flow);
					if (prior <= 0) return 0;
					return Math.min(5.5, Math.log2(1 + prior) * 2.1);
				})()
				: 0;

			return { ...chip, score: chip.score + typeBoost + columnBoost + sequenceBoost + semanticConfidenceBoost + importanceBoost + pairBoost + stageQualityBoost + derivePatternBoost + schemaFamiliarityBoost };
		});

		const existingStageTypes = new Set(input.stages.map((stage) => stage.type));
		const chipCandidates: DiversityCandidate<QuickChip>[] = boosted
			.filter((chip) => isMeaningfulStage(chip.stage))
			.filter((chip) => !existingStageTypes.has(chip.stage.type))
			.map((chip) => ({
				item: ensureHydratedQuickChip(chip),
				score: chip.score,
				typeKey: chip.stage.type,
				intent: stageIntent(chip.stage),
				semanticKey: stageSemanticKey(chip.stage)
			}));

		const diversified = diversifySuggestions({
			namespace: `quick:${input.connectionId}:${pipelineSignature || 'root'}`,
			candidates: chipCandidates,
			limit: 6,
			explorationStrength: 0.62,
			now,
			minDistinctTypes: 2,
			minDistinctIntents: 2
		});

		const seenKeys = new Set(diversified.map((chip) => stageSemanticKey(chip.stage)));
		const sortedCandidates = [...chipCandidates].sort((a, b) => b.score - a.score);
		const filled = [...diversified];
		const sortedFilterCandidates = sortedCandidates.filter((candidate) => candidate.item.stage.type === 'filter');
		let filterCount = filled.filter((chip) => chip.stage.type === 'filter').length;
		for (const candidate of sortedFilterCandidates) {
			if (filterCount >= 2) break;
			if (seenKeys.has(candidate.semanticKey)) continue;
			if (filled.length < 6) {
				filled.push(candidate.item);
				seenKeys.add(candidate.semanticKey);
				filterCount += 1;
			}
		}
		if (!filled.some((chip) => chip.stage.type === 'group')) {
			const bestGroup = sortedCandidates.find((candidate) => candidate.item.stage.type === 'group' && !seenKeys.has(candidate.semanticKey));
			if (bestGroup && filled.length < 6) {
				filled.push(bestGroup.item);
				seenKeys.add(bestGroup.semanticKey);
			}
		}
		for (const candidate of sortedCandidates) {
			if (filled.length >= 5) break;
			if (seenKeys.has(candidate.semanticKey)) continue;
			filled.push(candidate.item);
			seenKeys.add(candidate.semanticKey);
		}
		return bootstrappedFromColumns ? filled.filter((chip) => chip.icon !== 'derive') : filled;
	} catch {
		return base;
	}
}

function detectProfileRowsFromResult(columns: string[], rows: Record<string, unknown>[]): ProfileRow[] {
	return columns.map((column) => {
		const stats = computeColumnStats(rows, column);
		const inferred = inferColumnSemantics({
			columnName: column,
			dataKind: stats.kind,
			samples: stats.samples,
			nullRatio: stats.nullRatio,
			distinctCount: stats.distinctCount
		});
		return {
			column_name: column,
			data_kind: stats.kind,
			semantic_type: inferred.semanticType,
			semantic_signature: inferred.signature,
			semantic_confidence: inferred.confidence,
			null_ratio: stats.nullRatio,
			distinct_count: stats.distinctCount,
			sample_values_json: JSON.stringify(stats.samples)
		};
	});
}

type ChartRole = 'temporal' | 'dimension' | 'metric' | 'identifier' | 'other';

const TEMPORAL_SEMANTICS = new Set<ColumnSemanticType>(['event_time', 'created_at', 'updated_at', 'date']);
const IDENTIFIER_SEMANTICS = new Set<ColumnSemanticType>(['id', 'foreign_key', 'session_id', 'source_id', 'target_id', 'parent_id']);
const METRIC_SEMANTICS = new Set<ColumnSemanticType>([
	'amount',
	'currency_amount',
	'unit_price',
	'inflow',
	'outflow',
	'numerator',
	'denominator',
	'percentage',
	'ratio',
	'count',
	'quantity',
	'volume_measure',
	'duration',
	'metric'
]);

function toCardinalityClass(row: ProfileRow): 'low' | 'medium' | 'high' | 'unknown' {
	if (!Number.isFinite(row.distinct_count) || row.distinct_count <= 0) return 'unknown';
	if (row.distinct_count <= 12) return 'low';
	if (row.distinct_count <= 60) return 'medium';
	return 'high';
}

function toChartRole(row: ProfileRow): ChartRole {
	const semantic = row.semantic_type;
	if (row.data_kind === 'date') return 'temporal';
	if (semantic && TEMPORAL_SEMANTICS.has(semantic)) return 'temporal';
	if (semantic && IDENTIFIER_SEMANTICS.has(semantic)) return 'identifier';
	if (row.data_kind === 'numeric' && (!semantic || !IDENTIFIER_SEMANTICS.has(semantic))) return 'metric';
	if (semantic === 'description' || semantic === 'json_blob') return 'other';
	if (row.data_kind === 'text' || row.data_kind === 'boolean') return 'dimension';
	return 'other';
}

function chartRoleScore(row: ProfileRow, role: ChartRole): number {
	const baseConfidence = Math.max(0.3, Math.min(1, row.semantic_confidence ?? 0.5));
	const quality = Math.max(0.1, 1 - row.null_ratio);
	const semantic = row.semantic_type;
	let semanticBoost = 1;
	if (role === 'metric' && semantic && METRIC_SEMANTICS.has(semantic)) semanticBoost += 0.18;
	if (role === 'temporal' && semantic && TEMPORAL_SEMANTICS.has(semantic)) semanticBoost += 0.2;
	if (role === 'dimension') {
		const cardinalityClass = toCardinalityClass(row);
		if (cardinalityClass === 'low') semanticBoost += 0.18;
		if (cardinalityClass === 'medium') semanticBoost += 0.09;
		if (cardinalityClass === 'high') semanticBoost -= 0.08;
	}
	return baseConfidence * quality * semanticBoost;
}

function clamp01(value: number): number {
	if (Number.isNaN(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function rowCountClass(rowCount: number): 'tiny' | 'small' | 'medium' | 'large' {
	if (rowCount <= 25) return 'tiny';
	if (rowCount <= 120) return 'small';
	if (rowCount <= 1000) return 'medium';
	return 'large';
}

function cardinalityRank(row: ProfileRow): number {
	const cls = toCardinalityClass(row);
	if (cls === 'low') return 0;
	if (cls === 'medium') return 1;
	if (cls === 'unknown') return 2;
	return 3;
}

function pickDimensionBindings(dimensionRows: ProfileRow[]): {
	primaryDimension: string | undefined;
	secondaryDimension: string | null;
	lowCardDimension: string | undefined;
	primaryDimensionRow: ProfileRow | undefined;
	secondaryDimensionRow: ProfileRow | undefined;
} {
	if (dimensionRows.length === 0) {
		return {
			primaryDimension: undefined,
			secondaryDimension: null,
			lowCardDimension: undefined,
			primaryDimensionRow: undefined,
			secondaryDimensionRow: undefined
		};
	}

	const axisPriority = [...dimensionRows].sort((a, b) => {
		const rankDiff = cardinalityRank(a) - cardinalityRank(b);
		if (rankDiff !== 0) return rankDiff;
		const scoreDiff = chartRoleScore(b, 'dimension') - chartRoleScore(a, 'dimension');
		if (scoreDiff !== 0) return scoreDiff;
		return dimensionRows.indexOf(a) - dimensionRows.indexOf(b);
	});

	const primaryDimensionRow = axisPriority[0];
	const secondaryDimensionRow = axisPriority.find(
		(row) => row.column_name !== primaryDimensionRow?.column_name
	);
	const lowCardDimension = dimensionRows.find(
		(row) => toCardinalityClass(row) === 'low'
	)?.column_name ?? primaryDimensionRow?.column_name;

	return {
		primaryDimension: primaryDimensionRow?.column_name,
		secondaryDimension: secondaryDimensionRow?.column_name ?? null,
		lowCardDimension,
		primaryDimensionRow,
		secondaryDimensionRow
	};
}

export function recommendIntelligentChartTypes(input: {
	columns: string[];
	rows: Record<string, unknown>[];
}): IntelligentChartRecommendation[] {
	if (input.columns.length === 0 || input.rows.length === 0) return [];

	const profiles = detectProfileRowsFromResult(input.columns, input.rows);
	const recommendations: IntelligentChartRecommendation[] = [];
	const temporalRows = profiles
		.filter((row) => toChartRole(row) === 'temporal')
		.sort((a, b) => chartRoleScore(b, 'temporal') - chartRoleScore(a, 'temporal'));
	const metricRows = profiles
		.filter((row) => toChartRole(row) === 'metric')
		.sort((a, b) => chartRoleScore(b, 'metric') - chartRoleScore(a, 'metric'));
	const dimensionRows = profiles
		.filter((row) => toChartRole(row) === 'dimension')
		.sort((a, b) => chartRoleScore(b, 'dimension') - chartRoleScore(a, 'dimension'));

	const primaryTemporal = temporalRows[0]?.column_name;
	const {
		primaryDimension,
		secondaryDimension,
		lowCardDimension,
		primaryDimensionRow
	} = pickDimensionBindings(dimensionRows);
	const primaryMetric = metricRows[0]?.column_name;
	const secondaryMetrics = metricRows.slice(1, 4).map((row) => row.column_name);
	const topMetrics = metricRows.slice(0, 4).map((row) => row.column_name);

	const signature = `${temporalRows.length}T-${dimensionRows.length}D-${metricRows.length}M-${profiles.filter((row) => toChartRole(row) === 'identifier').length}I|${rowCountClass(input.rows.length)}`;
	const seen = new Set<string>();
	const add = (
		chartType: ChartType,
		reason: string,
		confidence: number,
		bindings: {
			xColumn?: string;
			yColumns?: string[];
			colorColumn?: string | null;
			sizeColumn?: string | null;
			seriesMode?: 'auto' | 'grouped' | 'stacked';
		} = {}
	): void => {
		const key = `${chartType}:${bindings.seriesMode ?? 'auto'}`;
		if (seen.has(key)) return;
		seen.add(key);
		recommendations.push({
			chartType,
			reason,
			confidence: clamp01(confidence),
			signature,
			xColumn: bindings.xColumn,
			yColumns: bindings.yColumns,
			colorColumn: bindings.colorColumn,
			sizeColumn: bindings.sizeColumn,
			seriesMode: bindings.seriesMode
		});
	};

	if (primaryTemporal && primaryMetric) {
		const temporalConfidence = (chartRoleScore(temporalRows[0], 'temporal') + chartRoleScore(metricRows[0], 'metric')) / 2;
		const yColumns = topMetrics.length > 0 ? topMetrics : [primaryMetric];
		const temporalColor = secondaryDimension ?? lowCardDimension ?? null;
		add('line', 'Temporal + metric signature suggests trend analysis', 0.93 + temporalConfidence * 0.08, {
			xColumn: primaryTemporal,
			yColumns,
			colorColumn: temporalColor,
			seriesMode: yColumns.length >= 2 ? 'grouped' : 'auto'
		});
		add('area', yColumns.length >= 2
			? 'Multiple metrics over time fit stacked cumulative trend view'
			: 'Single metric over time supports an area trend view', 0.86 + temporalConfidence * 0.08, {
			xColumn: primaryTemporal,
			yColumns,
			colorColumn: null,
			seriesMode: yColumns.length >= 2 ? 'stacked' : 'auto'
		});
	}

	if (primaryDimension && primaryMetric) {
		const primaryDimScore = primaryDimensionRow ? chartRoleScore(primaryDimensionRow, 'dimension') : chartRoleScore(dimensionRows[0], 'dimension');
		const metricScore = chartRoleScore(metricRows[0], 'metric');
		const axisPenalty = primaryDimensionRow && toCardinalityClass(primaryDimensionRow) === 'high' && lowCardDimension && lowCardDimension !== primaryDimension
			? 0.08
			: 0;
		const dimensionConfidence = Math.max(0, (primaryDimScore + metricScore) / 2 - axisPenalty);
		const yColumns = topMetrics.length > 0 ? topMetrics : [primaryMetric];
		const barColor = secondaryDimension ?? (yColumns.length === 1 ? lowCardDimension ?? null : null);
		const barSeriesMode: 'auto' | 'grouped' = dimensionRows.length >= 2 || yColumns.length >= 2 ? 'grouped' : 'auto';
		add('bar', 'Dimension + metric signature suggests grouped category comparison', 0.72 + dimensionConfidence * 0.12, {
			xColumn: primaryDimension,
			yColumns,
			seriesMode: barSeriesMode,
			colorColumn: barColor
		});
		if (dimensionRows.length >= 2 && yColumns.length >= 2) {
			add('bar', 'Two dimensions and multiple metrics support stacked category comparisons', 0.76 + dimensionConfidence * 0.12, {
				xColumn: primaryDimension,
				yColumns,
				seriesMode: 'stacked',
				colorColumn: secondaryDimension
			});
		}
		add('bar-horizontal', 'Text-heavy category labels improve readability in horizontal bars', 0.68 + dimensionConfidence * 0.16, {
			xColumn: primaryDimension,
			yColumns: [primaryMetric],
			colorColumn: secondaryDimension ?? lowCardDimension ?? null,
			seriesMode: 'auto'
		});
		const lowCardinality = dimensionRows.find((row) => row.column_name === lowCardDimension);
		if (lowCardinality && toCardinalityClass(lowCardinality) === 'low') {
			add('pie', 'Low-cardinality dimension supports part-to-whole comparison', 0.66 + dimensionConfidence * 0.12, {
				xColumn: lowCardDimension,
				yColumns: [primaryMetric]
			});
		}
	}

	if (metricRows.length >= 3) {
		const metricConfidence = (chartRoleScore(metricRows[0], 'metric') + chartRoleScore(metricRows[1], 'metric') + chartRoleScore(metricRows[2], 'metric')) / 3;
		add('bubble', 'Three metrics detected, bubble chart can encode x/y/size together', 0.74 + metricConfidence * 0.18, {
			xColumn: metricRows[0].column_name,
			yColumns: [metricRows[1].column_name],
			sizeColumn: metricRows[2].column_name,
			colorColumn: lowCardDimension ?? null
		});
	}

	if (metricRows.length >= 2) {
		const metricConfidence = (chartRoleScore(metricRows[0], 'metric') + chartRoleScore(metricRows[1], 'metric')) / 2;
		add('scatter', 'Multiple metrics detected for relationship analysis', 0.73 + metricConfidence * 0.2, {
			xColumn: metricRows[0].column_name,
			yColumns: [metricRows[1].column_name],
			sizeColumn: metricRows[2]?.column_name ?? null,
			colorColumn: lowCardDimension ?? null
		});
	}

	if (metricRows.length === 1 && temporalRows.length === 0 && dimensionRows.length === 0) {
		add('histogram', 'Single metric signature, distribution shape is likely informative', 0.71 + chartRoleScore(metricRows[0], 'metric') * 0.16, {
			xColumn: metricRows[0].column_name,
			yColumns: [metricRows[0].column_name]
		});
	}

	if (recommendations.length === 0) {
		const fallbackX = primaryDimension ?? primaryTemporal ?? input.columns[0] ?? '';
		const fallbackY = primaryMetric ? [primaryMetric, ...secondaryMetrics].slice(0, 3) : [];
		add('bar', 'Conservative fallback for mixed/low-confidence result shape', 0.62, {
			xColumn: fallbackX,
			yColumns: fallbackY,
			seriesMode: fallbackY.length >= 2 ? 'grouped' : 'auto',
			colorColumn: lowCardDimension ?? null
		});
		if (primaryTemporal && fallbackY.length > 0) {
			add('line', 'Secondary safe fallback for potential trend-shaped result', 0.58, {
				xColumn: primaryTemporal,
				yColumns: fallbackY
			});
		}
	}

	return recommendations
		.sort((a, b) => {
			if (b.confidence !== a.confidence) return b.confidence - a.confidence;
			return a.chartType.localeCompare(b.chartType);
		})
		.slice(0, 5);
}

export async function getIntelligentPresetSuggestions(input: {
	connectionId: string;
	stages: GUIPipelineStage[];
	availableColumns: string[];
	coercionDialect?: CoercionDialect;
}): Promise<StagePresetSuggestion[]> {
	const dialect = normalizeCoercionDialect(input.coercionDialect);
	const fallbackBase = recommendPresets({
		stages: input.stages,
		availableColumns: input.availableColumns,
		availableColumnCount: input.availableColumns.length,
		dialect
	});

	try {
		await ensureIntelligenceMetaTables();
		const sourceTable = firstFromTable(input.stages);
		if (!sourceTable) return fallbackBase;

		const profileResult = await executeSQL(`
			SELECT column_name, data_kind, semantic_type, semantic_signature, semantic_confidence, null_ratio, distinct_count, sample_values_json
			FROM ${META_SCHEMA}.column_profiles
			WHERE connection_id = ${quoteLiteral(input.connectionId)}
			  AND ${(() => {
				const relationCandidates = relationNameCandidates(sourceTable);
				return relationCandidates.length > 0
					? `relation_name IN (${relationCandidates.map((name) => quoteLiteral(name)).join(', ')})`
					: `relation_name = ${quoteLiteral(sourceTable)}`;
			})()}
			ORDER BY seen_count DESC, last_seen_ms DESC
		`);
		let profileRows = profileResult.rows as unknown as ProfileRow[];
		const scopedProfileRows = scopeProfileRowsToAvailableColumns(profileRows, input.availableColumns);
		if (scopedProfileRows.length > 0) {
			profileRows = scopedProfileRows;
		} else if (input.availableColumns.length > 0) {
			profileRows = bootstrapProfilesFromColumns(input.availableColumns);
		}
		const deriveCandidates = findSemanticDeriveCandidates(toSemanticDeriveColumns(profileRows));
		const deriveQualityByPattern = new Map(deriveCandidates.map((candidate) => [candidate.pattern, candidate.quality]));
		const availableColumnProfiles = buildPresetColumnProfiles(profileRows);
		const base = recommendPresets({
			stages: input.stages,
			availableColumns: input.availableColumns,
			availableColumnProfiles,
			availableColumnCount: input.availableColumns.length,
			dialect
		});
		const buildPresetStages = (
			presetId: StagePresetSuggestion['preset']['id'],
			availableColumns: string[]
		): Exclude<GUIPipelineStage, { type: 'raw' }>[] =>
			makePresetStages(presetId, {
				availableColumns,
				availableColumnProfiles,
				dialect
			});
		const semanticSet = new Set(profileRows.map((row) => row.semantic_type ?? 'text'));

		const schemaKey = schemaContextSignature(profileRows);
		const contextSignatures = stageContextSignatures(input.stages, schemaKey);
		const contextPredicates = contextSignatures.map((signature) => `context_signature = ${quoteLiteral(signature)}`);
		const sequenceRows: Array<{
			context_signature?: string;
			next_stage?: StageType;
			usage_count?: number;
		}> = [];
		if (contextPredicates.length > 0) {
			const sequenceResult = await executeSQL(`
				SELECT context_signature, next_stage, usage_count
				FROM ${META_SCHEMA}.stage_sequence_usage
				WHERE connection_id = ${quoteLiteral(input.connectionId)}
				  AND (${contextPredicates.join(' OR ')})
			`);
			sequenceRows.push(...(sequenceResult.rows as Array<{
				context_signature?: string;
				next_stage?: StageType;
				usage_count?: number;
			}>));
		}
		const sequenceScore = new Map<StageType, number>();
		for (const row of sequenceRows) {
			const type = row.next_stage;
			if (!type) continue;
			const signature = row.context_signature ?? '';
			const contextWeight = signature.includes('variant=type')
				? 1
				: signature.includes('variant=shape')
					? 0.82
					: signature.includes('variant=intent')
						? 0.74
						: 0.66;
			sequenceScore.set(type, (sequenceScore.get(type) ?? 0) + Number(row.usage_count ?? 0) * contextWeight);
		}

		const relationCandidates = relationNameCandidates(sourceTable);
		const relationPredicate =
			relationCandidates.length > 0
				? `relation_name IN (${relationCandidates.map((name) => quoteLiteral(name)).join(', ')})`
				: `relation_name = ${quoteLiteral(sourceTable)}`;
		const deriveUsageResult = await executeSQL(`
			SELECT signature_key, usage_count
			FROM ${META_SCHEMA}.signature_usage
			WHERE connection_id = ${quoteLiteral(input.connectionId)}
			  AND ${relationPredicate}
			  AND signature_type = 'derive'
			ORDER BY usage_count DESC
			LIMIT 30
		`);
		const derivePatternStrength = loadDerivePatternStrength(
			deriveUsageResult.rows as Array<{ signature_key?: string; usage_count?: number }>
		);

		const enriched = base.map((preset) => {
			let score = preset.score;
			const reasons = [...preset.reasons];
			const inflowCandidate =
				profileRows.find((row) => row.semantic_type === 'inflow')?.column_name ??
				profileRows.find((row) => /paid\s*in|inflow|deposit|credited|received/i.test(row.column_name))?.column_name ??
				null;
			const outflowCandidate =
				profileRows.find((row) => row.semantic_type === 'outflow')?.column_name ??
				profileRows.find((row) => /withdrawn|outflow|debited|spent|payment|charge/i.test(row.column_name))?.column_name ??
				null;
			const hasPairedFlowColumns = Boolean(inflowCandidate && outflowCandidate && inflowCandidate !== outflowCandidate);

			if (preset.preset.id === 'dedup-latest') {
				if (semanticSet.has('id') || semanticSet.has('foreign_key')) {
					score += 8;
					reasons.push('identifier semantics detected');
				}
				if (semanticSet.has('event_time') || semanticSet.has('created_at') || semanticSet.has('updated_at') || semanticSet.has('date')) {
					score += 10;
					reasons.push('temporal semantics detected');
				}
			}

			if (preset.preset.id === 'group-top') {
				if (semanticSet.has('category') || semanticSet.has('region') || semanticSet.has('country')) {
					score += 8;
					reasons.push('strong dimension semantics');
				}
				if (semanticSet.has('amount') || semanticSet.has('count') || semanticSet.has('metric')) {
					score += 10;
					reasons.push('strong metric semantics');
				}
			}

			if (preset.preset.id === 'top-metric' && (semanticSet.has('amount') || semanticSet.has('metric'))) {
				score += 9;
				reasons.push('metric semantics detected');
			}

			if (preset.preset.id === 'temporal-trend') {
				if (semanticSet.has('event_time') || semanticSet.has('created_at') || semanticSet.has('updated_at') || semanticSet.has('date')) {
					score += 12;
					reasons.push('temporal semantics detected');
				}
				if (semanticSet.has('amount') || semanticSet.has('count') || semanticSet.has('metric')) {
					score += 8;
					reasons.push('metric semantics detected');
				}
			}

			if (preset.preset.id === 'text-categorize') {
				if (semanticSet.has('description') || semanticSet.has('text') || semanticSet.has('status') || semanticSet.has('category')) {
					score += 10;
					reasons.push('categorization semantics detected');
				}
				if (semanticSet.has('amount') || semanticSet.has('count') || semanticSet.has('metric')) {
					score += 6;
					reasons.push('supports weighted category totals');
				}
			}

			if (preset.preset.id === 'anomaly-scan') {
				if (semanticSet.has('amount') || semanticSet.has('metric') || semanticSet.has('ratio')) {
					score += 10;
					reasons.push('outlier-ready metric semantics');
				}
			}

			if (preset.preset.id === 'frequency-ranking') {
				if (semanticSet.has('entity_name') || semanticSet.has('category') || semanticSet.has('status') || semanticSet.has('region')) {
					score += 8;
					reasons.push('dimension semantics detected');
				}
			}

			if (preset.preset.id === 'cashflow-rollup') {
				if (hasPairedFlowColumns && (semanticSet.has('amount') || semanticSet.has('metric') || semanticSet.has('quantity'))) {
					score += 11;
					reasons.push('flow-like metric semantics detected');
				}
				if (hasPairedFlowColumns && (semanticSet.has('event_time') || semanticSet.has('created_at') || semanticSet.has('updated_at') || semanticSet.has('date'))) {
					score += 8;
					reasons.push('temporal rollup semantics detected');
				}
				if (!hasPairedFlowColumns) {
					score -= 14;
					reasons.push('missing paired inflow/outflow columns');
				}
			}

			if (preset.preset.id === 'group-top' || preset.preset.id === 'top-metric') {
				score += (deriveQualityByPattern.get('composed_metric') ?? 0) * 4;
			}
			if (preset.preset.id === 'efficiency-lens') {
				score += (deriveQualityByPattern.get('efficiency_ratio') ?? 0) * 5;
			}
			if (preset.preset.id === 'cashflow-rollup') {
				score += (deriveQualityByPattern.get('flow_delta') ?? 0) * 5;
			}
			if (preset.preset.id === 'temporal-trend' || preset.preset.id === 'seasonal-pattern' || preset.preset.id === 'drift-monitor') {
				score += (deriveQualityByPattern.get('temporal_metric') ?? 0) * 4;
			}

			const sequenceBoost = preset.stages.reduce((acc, stage) => acc + (sequenceScore.get(stage.type) ?? 0), 0);
			if (sequenceBoost > 0) {
				score += Math.min(14, Math.log2(1 + sequenceBoost) * 4.5);
				reasons.push('historically effective stage sequence');
			}

			const derivePatternBoost = (() => {
				if (preset.preset.id === 'group-top' || preset.preset.id === 'top-metric') {
					const strength = Math.max(
						derivePatternStrength.get('composed_metric') ?? 0,
						derivePatternStrength.get('segment_metric') ?? 0
					);
					return strength > 0 ? Math.min(8, Math.log2(1 + strength) * 2.8) : 0;
				}
				if (preset.preset.id === 'temporal-trend' || preset.preset.id === 'seasonal-pattern' || preset.preset.id === 'drift-monitor') {
					const strength = derivePatternStrength.get('temporal_metric') ?? 0;
					return strength > 0 ? Math.min(9, Math.log2(1 + strength) * 3.2) : 0;
				}
				if (preset.preset.id === 'cashflow-rollup') {
					const strength = derivePatternStrength.get('flow_delta') ?? 0;
					return strength > 0 ? Math.min(10, Math.log2(1 + strength) * 3.4) : 0;
				}
				if (preset.preset.id === 'efficiency-lens') {
					const strength = derivePatternStrength.get('efficiency_ratio') ?? 0;
					return strength > 0 ? Math.min(9, Math.log2(1 + strength) * 3.1) : 0;
				}
				return 0;
			})();
			if (derivePatternBoost > 0) {
				score += derivePatternBoost;
				reasons.push('historically successful derive pattern fit');
			}

			return {
				...preset,
				score,
				reasons
			};
		});

		const profileByColumn = new Map(profileRows.map((row) => [row.column_name, row]));
		const presetUsageByType = new Map<StageType, number>([...sequenceScore.entries()]);
		const rankedPresetMetrics = rankColumnsByImportance({
			profileRows,
			role: 'metric',
			usageByType: presetUsageByType,
			minScore: 0.42
		});
		const rankedPresetDimensions = rankColumnsByImportance({
			profileRows,
			role: 'dimension',
			usageByType: presetUsageByType,
			minScore: 0.38
		});
		const presetImportanceByColumn = new Map<string, number>();
		for (const ranked of [rankedPresetMetrics, rankedPresetDimensions]) {
			for (const entry of ranked) {
				presetImportanceByColumn.set(entry.column, Math.max(presetImportanceByColumn.get(entry.column) ?? 0, entry.score));
			}
		}
		const resolveColumn = (candidate: string | null): string | null => {
			if (!candidate) return null;
			if (profileByColumn.has(candidate)) return candidate;
			const normalized = candidate.trim().toLowerCase();
			const byNormalized = profileRows.find((row) => row.column_name.trim().toLowerCase() === normalized)?.column_name;
			if (byNormalized) return byNormalized;
			return input.availableColumns.find((column) => column.trim().toLowerCase() === normalized) ?? null;
		};

		const columnBySemantic = (...semanticTypes: ColumnSemanticType[]): string | null => {
			for (const semantic of semanticTypes) {
				const found = profileRows.find((row) => row.semantic_type === semantic)?.column_name;
				if (found) return found;
			}
			return null;
		};

		const columnByNamePattern = (pattern: RegExp): string | null =>
			profileRows.find((row) => pattern.test(row.column_name))?.column_name ??
			input.availableColumns.find((column) => pattern.test(column)) ??
			null;

		const timeColumn =
			resolveColumn(columnBySemantic('event_time', 'updated_at', 'created_at', 'date')) ??
			resolveColumn(
				profileRows.find((row) => isTemporalLikeColumnName(row.column_name))?.column_name ??
				input.availableColumns.find((column) => isTemporalLikeColumnName(column)) ??
				null
			);
		const compositeMetricPlan = findCompositeMetricPlan(profileRows, input.availableColumns, dialect);
		const metricColumn = compositeMetricPlan?.name ?? resolveColumn(rankedPresetMetrics[0]?.column ?? pickMetricColumn(profileRows, input.availableColumns));
		const detailColumn =
			resolveColumn(columnBySemantic('description')) ??
			resolveColumn(columnByNamePattern(/details?|description|memo|notes?|comment|message/i));
		const entityColumn =
			resolveColumn(rankedPresetDimensions.find((entry) => (entry.row.semantic_type ?? 'text') === 'entity_name')?.column ?? null) ??
			resolveColumn(columnBySemantic('entity_name', 'category', 'status', 'region', 'country', 'city')) ??
			resolveColumn(columnByNamePattern(/payee|merchant|vendor|customer|name|entity|category|status/i));
		const inflowColumnCandidate =
			resolveColumn(columnBySemantic('inflow')) ??
			resolveColumn(columnByNamePattern(/paid\s*in|inflow|deposit|credited|received/i));
		const outflowColumnCandidate =
			resolveColumn(columnBySemantic('outflow')) ??
			resolveColumn(columnByNamePattern(/withdrawn|outflow|debited|spent|payment|charge/i));
		const hasDistinctFlowPair = Boolean(
			inflowColumnCandidate &&
			outflowColumnCandidate &&
			inflowColumnCandidate !== outflowColumnCandidate
		);
		const inflowColumn = hasDistinctFlowPair ? inflowColumnCandidate : null;
		const outflowColumn = hasDistinctFlowPair ? outflowColumnCandidate : null;

		const prioritizedColumns = (
			...columns: Array<string | null>
		): string[] => {
			const dedup: string[] = [];
			for (const column of columns) {
				if (!column) continue;
				if (!dedup.includes(column)) dedup.push(column);
			}
			for (const column of input.availableColumns) {
				if (!dedup.includes(column)) dedup.push(column);
			}
			return dedup;
		};
		const featureMatrixSignal = detectFeatureMatrixSignal(profileRows);

		const profileByNormalized = new Map(
			profileRows.map((row) => [row.column_name.trim().toLowerCase(), row])
		);
		const profileFor = (column: string): ProfileRow | undefined =>
			profileByNormalized.get(column.trim().toLowerCase());
		const isDimensionCandidate = (column: string): boolean => {
			if (!column) return false;
			if (isIdentifierLikeName(column)) return false;
			if (isTemporalLikeColumnName(column)) return false;
			if (featureMatrixSignal.isFeatureMatrix && isMeasurementFeatureName(column)) return false;
			if (/(amount|revenue|cost|price|balance|paid|withdrawn|metric|value|score|qty|quantity|count)/i.test(column)) return false;
			if (/(slug|description|note|notes|comment|memo)/i.test(column)) return false;
			return true;
		};
		const dimensionRelevance = (column: string): number => {
			const profile = profileFor(column);
			const semanticScore = profile
				? scoreColumnImportance({
					row: profile,
					role: 'dimension',
					usageByType: presetUsageByType
				})
				: 0.44;
			const semanticBoost = profile
				? /(region|country|city)/i.test(profile.semantic_type ?? '')
					? 0.24
					: /(category|status)/i.test(profile.semantic_type ?? '')
						? 0.18
					: /(entity_name)/i.test(profile.semantic_type ?? '')
						? -0.18
						: 0
				: 0;
			const nameBoost = /(species|class|target|label)/i.test(column)
				? 0.3
				: /(genre|sub_?genre|mood|style|region|country|city|product|category|segment|channel|status|stage|type|customer\s*type|merchant|vendor|customer|payee)/i.test(column)
					? 0.14
					: featureMatrixSignal.isFeatureMatrix && isMeasurementFeatureName(column)
						? -0.2
						: /(name|title|label)/i.test(column)
							? -0.12
							: 0;
			const cardinalityPenalty = profile
				? Number(profile.distinct_count ?? 0) > 80
					? -0.14
					: Number(profile.distinct_count ?? 0) <= 20
						? 0.06
						: 0
				: 0;
			return clamp(semanticScore + semanticBoost + nameBoost + cardinalityPenalty, 0, 1);
		};
		const dimensionCandidates = input.availableColumns
			.filter((column, index, arr) => arr.findIndex((entry) => entry.trim().toLowerCase() === column.trim().toLowerCase()) === index)
			.filter((column) => column !== metricColumn && isDimensionCandidate(column))
			.map((column) => ({ column, relevance: dimensionRelevance(column) }))
			.sort((a, b) => b.relevance - a.relevance);
		const relevanceValues = dimensionCandidates.map((candidate) => candidate.relevance).sort((a, b) => b - a);
		const percentileIndex = Math.min(relevanceValues.length - 1, Math.max(0, Math.floor(relevanceValues.length * 0.5)));
		const adaptiveRelevanceCutoff = relevanceValues.length > 0 ? Math.max(0.42, relevanceValues[percentileIndex] ?? 0.42) : 0.42;
		const selectedDimensions = dimensionCandidates
			.filter((candidate) => candidate.relevance >= adaptiveRelevanceCutoff)
			.slice(0, 2)
			.map((candidate) => candidate.column);
		const primaryDimension = selectedDimensions[0] ?? entityColumn;
		const secondaryDimension = selectedDimensions[1] ?? null;
		const resolvedPrimaryDimension = featureMatrixSignal.isFeatureMatrix
			? (featureMatrixSignal.classColumn ?? primaryDimension)
			: primaryDimension;
		const resolvedSecondaryDimension = featureMatrixSignal.isFeatureMatrix ? null : secondaryDimension;
		const dimensionPhrase = humanizeColumnList([resolvedPrimaryDimension, resolvedSecondaryDimension], { maxLength: 24 });
		const humanMetricColumn = compositeMetricPlan
			? 'Revenue'
			: metricColumn
				? humanizeColumnLabel(metricColumn, { stripAggregationPrefix: true, maxLength: 18 })
				: null;
		const humanTimeColumn = timeColumn ? humanizeColumnName(timeColumn) : null;
		const humanDetailColumn = detailColumn ? humanizeColumnLabel(detailColumn, { maxLength: 18 }) : null;
		const humanEntityColumn = entityColumn ? humanizeColumnLabel(entityColumn, { maxLength: 18 }) : null;
		const hasTimeSignal = Boolean(timeColumn);
		const hasMetricSignal = Boolean(metricColumn);
		const hasDimensionSignal = Boolean(resolvedPrimaryDimension);
		const hasDetailSignal = Boolean(detailColumn);
		const hasEntitySignal = Boolean(entityColumn);
		const hasFlowSignal = Boolean(inflowColumn && outflowColumn);

		const buildAnalystPresetStages = (
			presetId: StagePresetSuggestion['preset']['id']
		): Exclude<GUIPipelineStage, { type: 'raw' }>[] | null => {
			if (!metricColumn || !timeColumn) return null;
			const metricProfileRow = profileRows.find((row) => row.column_name === metricColumn);
			const timeProfileRow = profileRows.find((row) => row.column_name === timeColumn);
			const metricAggFunc = compositeMetricPlan ? 'sum' : metricAggregationFunc(profileRows, metricColumn);
			const metricValueColumn = compositeMetricPlan
				? compositeMetricPlan.name
				: metricAggFunc === 'count'
					? metricColumn
					: 'metric_value';
			const metricValueDerive = compositeMetricPlan
				? [{ name: compositeMetricPlan.name, expr: { mode: 'sstring' as const, template: compositeMetricPlan.expressionSql } }]
				: metricAggFunc === 'count'
					? []
					: [{ name: 'metric_value', expr: { mode: 'sstring' as const, template: metricSqlExpr(metricColumn, metricProfileRow, dialect) } }];
			const timeValueExpr = temporalSqlExpr(timeColumn, timeProfileRow, dialect);
			if (!timeValueExpr) return null;
			const partitionColumns = [resolvedPrimaryDimension, resolvedSecondaryDimension]
				.filter((column): column is string => Boolean(column))
				.map((column) => quotedSqlIdentifier(column));

			if (presetId === 'temporal-trend') {
				const partitionExpr = partitionColumns.length > 0 ? `partition by ${partitionColumns.join(', ')} ` : '';
				return [
					{
						type: 'derive',
						columns: [
							...metricValueDerive,
							{
								name: 'period_month',
								expr: {
									mode: 'sstring',
									template: `date_trunc('month', ${timeValueExpr})`
								}
							}
						]
					},
					{
						type: 'group',
						by: ['period_month', ...(resolvedPrimaryDimension ? [resolvedPrimaryDimension] : [])],
						aggregations: [
							{ name: 'metric_total', func: metricAggFunc, column: metricValueColumn },
							{ name: 'row_count', func: 'count', column: '' }
						]
					},
					{
						type: 'derive',
						columns: [
							{
								name: 'mom_delta',
								expr: {
									mode: 'sstring',
									template: `metric_total - lag(metric_total) over (${partitionExpr}order by period_month)`
								}
							},
							{
								name: 'mom_growth_pct',
								expr: {
									mode: 'sstring',
									template: `mom_delta / nullif(lag(metric_total) over (${partitionExpr}order by period_month), 0)`
								}
							}
						]
					},
					{ type: 'sort', keys: [{ column: 'period_month', dir: 'asc' }] },
					{ type: 'take', n: 180 }
				];
			}

			if (presetId === 'seasonal-pattern') {
				return [
					{
						type: 'derive',
						columns: [
							...metricValueDerive,
							{
								name: 'period_month',
								expr: {
									mode: 'sstring',
									template: `date_trunc('month', ${timeValueExpr})`
								}
							},
							{
								name: 'season_weekday',
								expr: {
									mode: 'sstring',
									template: `extract(dow from ${timeValueExpr})`
								}
							},
							{
								name: 'season_month',
								expr: {
									mode: 'sstring',
									template: `extract(month from ${timeValueExpr})`
								}
							}
						]
					},
					{
						type: 'group',
						by: ['period_month', 'season_month', 'season_weekday', ...(resolvedPrimaryDimension ? [resolvedPrimaryDimension] : [])],
						aggregations: [
							{ name: 'metric_total', func: metricAggFunc, column: metricValueColumn },
							{ name: 'row_count', func: 'count', column: '' }
						]
					},
					{
						type: 'derive',
						columns: [
							{
								name: 'seasonality_index',
								expr: {
									mode: 'sstring',
									template: 'metric_total / nullif(avg(metric_total) over (partition by season_weekday), 0)'
								}
							}
						]
					},
					{ type: 'sort', keys: [{ column: 'period_month', dir: 'asc' }, { column: 'seasonality_index', dir: 'desc' }] },
					{ type: 'take', n: 160 }
				];
			}

			if (presetId === 'drift-monitor' && resolvedPrimaryDimension) {
				const partitionExpr = partitionColumns.length > 0 ? partitionColumns.join(', ') : quotedSqlIdentifier(resolvedPrimaryDimension);
				return [
					{
						type: 'derive',
						columns: [
							...metricValueDerive,
							{
								name: 'recency_rank',
								expr: {
									mode: 'sstring',
									template: `dense_rank() over (order by ${timeValueExpr} desc)`
								}
							},
							{
								name: 'drift_window',
								expr: {
									mode: 'raw',
									expr: 'case [ (recency_rank <= 200) => "recent", (recency_rank <= 1200) => "baseline", true => "older" ]'
								}
							}
						]
					},
					{
						type: 'filter',
						logic: 'and',
						conditions: [{ column: 'drift_window', op: 'in', value: '["recent","baseline"]' }]
					},
					{
						type: 'group',
						by: [resolvedPrimaryDimension, 'drift_window', ...(resolvedSecondaryDimension ? [resolvedSecondaryDimension] : [])],
						aggregations: [
							{ name: 'metric_total', func: metricAggFunc, column: metricValueColumn },
							{ name: 'row_count', func: 'count', column: '' }
						]
					},
					{
						type: 'derive',
						columns: [
							{
								name: 'drift_delta',
								expr: {
									mode: 'sstring',
									template: `metric_total - lag(metric_total) over (partition by ${partitionExpr} order by drift_window)`
								}
							}
						]
					},
					{ type: 'sort', keys: [{ column: 'drift_delta', dir: 'desc' }] },
					{ type: 'take', n: 80 }
				];
			}

			return null;
		};

		const isFullyHydratedPreset = (preset: StagePresetSuggestion): boolean => {
			const label = preset.preset.label.trim();
			if (GENERIC_PRESET_LABELS.has(label)) return false;

			switch (preset.preset.id) {
				case 'temporal-trend':
				case 'seasonal-pattern':
					return hasTimeSignal && hasMetricSignal;
				case 'drift-monitor':
					return hasTimeSignal && hasMetricSignal && hasDimensionSignal;
				case 'period-variance':
					return hasTimeSignal && hasMetricSignal && hasDimensionSignal;
				case 'cashflow-rollup':
					return hasFlowSignal && hasTimeSignal;
				case 'text-categorize':
					return hasDetailSignal;
				case 'cohort-retention':
					return hasTimeSignal && hasEntitySignal;
				default:
					return true;
			}
		};

		const hydrated = enriched.map((preset) => {
			const baseReason = preset.reasons[0] ?? preset.preset.description;
			if (preset.preset.id === 'temporal-trend') {
				const label = timeColumn && metricColumn
					? `Monthly ${humanMetricColumn} trend from ${humanTimeColumn}`
					: preset.preset.label;
				const reason = timeColumn && metricColumn
					? `Decompose monthly ${humanMetricColumn} into level, delta, and growth to surface trend inflections`
					: baseReason;
				const analystStages = buildAnalystPresetStages('temporal-trend');
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: analystStages ?? buildPresetStages('temporal-trend', prioritizedColumns(timeColumn, metricColumn, entityColumn))
				};
			}

			if (preset.preset.id === 'cashflow-rollup') {
				const label = inflowColumn && outflowColumn && timeColumn
					? `Inflow vs outflow (${humanizeColumnName(inflowColumn, { stripAggregationPrefix: true })}/${humanizeColumnName(outflowColumn, { stripAggregationPrefix: true })}) by ${humanTimeColumn}`
					: preset.preset.label;
				const reason = inflowColumn && outflowColumn
					? `Derive inflow/outflow from ${humanizeColumnName(inflowColumn, { stripAggregationPrefix: true })} and ${humanizeColumnName(outflowColumn, { stripAggregationPrefix: true })}`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('cashflow-rollup', prioritizedColumns(timeColumn, inflowColumn, outflowColumn, detailColumn, entityColumn))
				};
			}

			if (preset.preset.id === 'text-categorize') {
				const label = detailColumn && metricColumn
					? `Categorize ${humanDetailColumn} and summarize ${humanMetricColumn}`
					: preset.preset.label;
				const reason = detailColumn
					? `Build case buckets from ${humanDetailColumn} patterns`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('text-categorize', prioritizedColumns(detailColumn, metricColumn, timeColumn, entityColumn))
				};
			}

			if (preset.preset.id === 'frequency-ranking') {
				const label = dimensionPhrase
					? compactLabel(`${dimensionPhrase} frequency`, 34)
					: preset.preset.label;
				const reason = dimensionPhrase
					? compactLabel(`Count rows by ${dimensionPhrase} and rank descending`, 64)
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('frequency-ranking', prioritizedColumns(resolvedPrimaryDimension, resolvedSecondaryDimension, metricColumn, timeColumn))
				};
			}

			if (preset.preset.id === 'anomaly-scan') {
				const label = metricColumn
					? `Largest ${humanMetricColumn} outliers`
					: preset.preset.label;
				const reason = metricColumn
					? `Derive absolute ${humanMetricColumn} and rank descending`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('anomaly-scan', prioritizedColumns(metricColumn, entityColumn, detailColumn, timeColumn))
				};
			}

			if (preset.preset.id === 'group-top') {
				const label = dimensionPhrase && metricColumn
					? compactLabel(`${humanMetricColumn} by ${dimensionPhrase}`, 34)
					: preset.preset.label;
				const reason = dimensionPhrase && metricColumn
					? `Aggregate ${humanMetricColumn} across ${dimensionPhrase}`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('group-top', prioritizedColumns(resolvedPrimaryDimension, resolvedSecondaryDimension, metricColumn, timeColumn))
				};
			}

			if (preset.preset.id === 'hierarchical-rollup') {
				const label = metricColumn && dimensionPhrase
					? compactLabel(`${humanMetricColumn} rollup by ${dimensionPhrase}`, 34)
					: preset.preset.label;
				const reason = metricColumn && dimensionPhrase
					? `Multi-column rollup selected with relevance cutoff ${adaptiveRelevanceCutoff.toFixed(2)}`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('hierarchical-rollup', prioritizedColumns(resolvedPrimaryDimension, resolvedSecondaryDimension, metricColumn, timeColumn))
				};
			}

			if (preset.preset.id === 'contribution-total') {
				const label = metricColumn && dimensionPhrase
					? compactLabel(`${humanMetricColumn} share by ${dimensionPhrase}`, 34)
					: preset.preset.label;
				const reason = metricColumn && dimensionPhrase
					? `Estimate segment contribution share across ${dimensionPhrase}`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('contribution-total', prioritizedColumns(resolvedPrimaryDimension, resolvedSecondaryDimension, metricColumn, timeColumn))
				};
			}

			if (preset.preset.id === 'period-variance') {
				const label = metricColumn && timeColumn
					? `Period variance of ${humanMetricColumn} over ${humanTimeColumn}`
					: preset.preset.label;
				const reason = metricColumn && timeColumn
					? `Derive period buckets and compute period-over-period deltas`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('period-variance', prioritizedColumns(timeColumn, resolvedPrimaryDimension, metricColumn))
				};
			}

			if (preset.preset.id === 'segment-anomaly') {
				const label = metricColumn && dimensionPhrase
					? `Segment anomalies for ${humanMetricColumn} by ${dimensionPhrase}`
					: preset.preset.label;
				const reason = metricColumn && dimensionPhrase
					? `Rank deviation-heavy segment slices with paired dimensions`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('segment-anomaly', prioritizedColumns(resolvedPrimaryDimension, resolvedSecondaryDimension, metricColumn))
				};
			}

			if (preset.preset.id === 'null-hotspots') {
				const label = dimensionPhrase
					? compactLabel(`Null hotspots in ${dimensionPhrase}`, 34)
					: preset.preset.label;
				const reason = dimensionPhrase
					? `Highlight missingness concentration by high-relevance dimensions`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('null-hotspots', prioritizedColumns(resolvedPrimaryDimension, resolvedSecondaryDimension, metricColumn))
				};
			}

			if (preset.preset.id === 'duplicate-fingerprint') {
				const label = entityColumn && resolvedPrimaryDimension
					? `Duplicate fingerprints for ${humanEntityColumn} within ${humanizeColumnName(resolvedPrimaryDimension)}`
					: preset.preset.label;
				const reason = entityColumn
					? `Group by key-like entities and rank duplicate concentration`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('duplicate-fingerprint', prioritizedColumns(entityColumn, resolvedPrimaryDimension, metricColumn))
				};
			}

			if (preset.preset.id === 'cohort-retention') {
				const label = entityColumn && timeColumn
					? `Cohort retention for ${humanEntityColumn} over ${humanTimeColumn}`
					: preset.preset.label;
				const reason = entityColumn && timeColumn
					? `Derive first-seen periods and summarize active entities`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('cohort-retention', prioritizedColumns(timeColumn, entityColumn, resolvedPrimaryDimension))
				};
			}

			if (preset.preset.id === 'funnel-dropoff') {
				const label = dimensionPhrase
					? `Funnel drop-off across ${dimensionPhrase}`
					: preset.preset.label;
				const reason = dimensionPhrase
					? `Summarize stage progression and conversion by paired dimensions`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('funnel-dropoff', prioritizedColumns(resolvedPrimaryDimension, resolvedSecondaryDimension, metricColumn))
				};
			}

			if (preset.preset.id === 'outlier-explain') {
				const label = metricColumn && dimensionPhrase
					? `Outlier explanation for ${humanMetricColumn} by ${dimensionPhrase}`
					: preset.preset.label;
				const reason = metricColumn && dimensionPhrase
					? `Pair outlier ranking with grouped contextual explanation`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('outlier-explain', prioritizedColumns(metricColumn, resolvedPrimaryDimension, resolvedSecondaryDimension))
				};
			}

			if (preset.preset.id === 'seasonal-pattern') {
				const label = metricColumn && timeColumn
					? `Seasonality decomposition for ${humanMetricColumn} using ${humanTimeColumn}`
					: preset.preset.label;
				const reason = metricColumn && timeColumn
					? `Model weekday and month effects, then compute relative seasonal index against weekday baselines`
					: baseReason;
				const analystStages = buildAnalystPresetStages('seasonal-pattern');
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: analystStages ?? buildPresetStages('seasonal-pattern', prioritizedColumns(timeColumn, metricColumn))
				};
			}

			if (preset.preset.id === 'efficiency-lens') {
				const label = dimensionPhrase
					? `Efficiency ratio by ${dimensionPhrase}`
					: preset.preset.label;
				const reason = dimensionPhrase
					? `Derive cost-to-revenue ratio and compare across dimensions`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('efficiency-lens', prioritizedColumns(resolvedPrimaryDimension, resolvedSecondaryDimension, metricColumn, inflowColumn, outflowColumn))
				};
			}

			if (preset.preset.id === 'drift-monitor') {
				const label = dimensionPhrase && timeColumn
					? `Distribution drift monitor for ${dimensionPhrase} using ${humanTimeColumn}`
					: preset.preset.label;
				const reason = dimensionPhrase && timeColumn
					? `Score recent vs baseline windows by segment and rank drift deltas to isolate unstable cohorts`
					: baseReason;
				const analystStages = buildAnalystPresetStages('drift-monitor');
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: analystStages ?? buildPresetStages('drift-monitor', prioritizedColumns(timeColumn, resolvedPrimaryDimension, resolvedSecondaryDimension, metricColumn))
				};
			}

			if (preset.preset.id === 'top-metric') {
				const label = metricColumn
					? `Top rows by ${metricColumn}`
					: preset.preset.label;
				const reason = metricColumn
					? `sort by ${metricColumn} and keep top rows`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('top-metric', prioritizedColumns(metricColumn, timeColumn, entityColumn))
				};
			}

			if (preset.preset.id === 'dedup-latest') {
				const label = timeColumn && entityColumn
					? `Latest row per ${entityColumn} by ${timeColumn}`
					: preset.preset.label;
				const reason = timeColumn
					? `sort by ${timeColumn} and keep first record per key`
					: baseReason;
				return {
					...preset,
					preset: {
						...preset.preset,
						label,
						description: reason
					},
					reasons: [reason, ...preset.reasons],
					stages: buildPresetStages('dedup-latest', prioritizedColumns(timeColumn, entityColumn, metricColumn))
				};
			}

			return preset;
		});

		const normalizedHydrated = hydrated
			.map((preset) => ({
				...preset,
				stages: compactPresetStageChain(preset.stages)
			}))
			.filter((preset) => preset.stages.length > 0 && preset.stages.every((stage) => isMeaningfulStage(stage)));

		if (normalizedHydrated.length === 0) {
			return fallbackBase;
		}

		const stageQualityAdjusted = normalizedHydrated.map((preset) => {
			const stageQualityAvg =
				preset.stages.length === 0
					? 0.3
					: preset.stages.reduce((acc, stage) => {
						if (stage.type === 'from') {
							return acc + 0.5;
						}
						return acc + stageSignalScore({
							chip: {
								id: `preset-${preset.preset.id}`,
								label: preset.preset.label,
								icon: 'filter',
								stage,
								tone: 'primary',
								hydration: fallbackQuickChipHydration({ stage, label: preset.preset.label })
							},
							profileRows,
							importanceByColumn: presetImportanceByColumn,
							weightedUsageByTypeAndColumn: new Map<string, number>(),
							weightedUsageByType: presetUsageByType
						});
					}, 0) / Math.max(1, preset.stages.length);
			const stageQualityBoost = Math.min(10, stageQualityAvg * 10);
			return {
				...preset,
				score: preset.score + stageQualityBoost,
				reasons: [...preset.reasons, `stage quality score ${stageQualityAvg.toFixed(2)}`]
			};
		});

		const semanticTemplateBundles = hydrateSemanticTemplateBundles({
			availableColumns: input.availableColumns,
			profileRows,
			maxResults: 24
		});

		const basePresetForCategory = (category: HydratedSuggestionMetadata['semanticCategory']): string => {
			switch (category) {
				case 'temporal':
					return 'temporal-trend';
				case 'geographic':
					return 'hierarchical-rollup';
				case 'categorical':
					return 'frequency-ranking';
				case 'id':
					return 'dedup-latest';
				case 'continuous-numeric':
					return 'anomaly-scan';
				case 'boolean':
					return 'funnel-dropoff';
				case 'text':
					return 'text-categorize';
				case 'ordinal':
					return 'frequency-ranking';
				case 'ratio-derived':
					return 'contribution-total';
				case 'event-log':
					return 'cohort-retention';
				case 'network-relational':
					return 'hierarchical-rollup';
				case 'media-reference':
					return 'null-hotspots';
			}
		};

		const semanticTemplateSuggestions: StagePresetSuggestion[] = semanticTemplateBundles
			.map((bundle): StagePresetSuggestion | null => {
				const basePresetId = basePresetForCategory(bundle.semanticCategory);
				const stages = makePresetStages(basePresetId, {
					availableColumns: input.availableColumns,
					availableColumnProfiles,
					dialect
				});
				if (stages.length === 0) return null;

				return {
					preset: {
						id: `semantic-template-${bundle.id}`,
						label: bundle.title,
						description: `Hydrated semantic template (${bundle.semanticCategory})`,
						keywords: [...bundle.tags, 'semantic-template', bundle.semanticCategory]
					},
					score: 28 + Math.round(bundle.confidence * 16),
					reasons: [
						`hydrated template matched ${Object.keys(bundle.bindings).length} semantic placeholders`,
						bundle.analysisPattern
					],
					stages,
					hydration: {
						semanticCategory: bundle.semanticCategory,
						analysisPattern: bundle.analysisPattern,
						techniques: ['semantic placeholder hydration', 'schema-aware template projection'],
						metricHints: ['coverage ratio', 'template fit confidence'],
						confidence: bundle.confidence
					},
					snippet: {
						title: bundle.title,
						prql: bundle.prql,
						tags: bundle.tags
					}
				};
			})
			.filter((entry): entry is StagePresetSuggestion => Boolean(entry));

		const enrichedWithTemplates = [...stageQualityAdjusted, ...semanticTemplateSuggestions];

		const strictlyHydrated = enrichedWithTemplates.filter((preset) => isFullyHydratedPreset(preset));
		const hydratedPool = strictlyHydrated.length > 0 ? strictlyHydrated : enrichedWithTemplates;

		const scores = hydratedPool.map((preset) => preset.score).sort((a, b) => b - a);
		const percentileScore = scores.length > 0
			? (scores[Math.min(scores.length - 1, Math.max(0, Math.floor(scores.length * 0.55)))] ?? scores[0] ?? 0)
			: 0;
		const minScore = scores.length > 0 ? (scores[scores.length - 1] ?? 0) : 0;
		const maxScore = scores.length > 0 ? (scores[0] ?? 0) : 0;
		const adaptiveScoreFloor = Math.max(percentileScore, minScore + (maxScore - minScore) * 0.35);
		const thresholded = hydratedPool.filter((preset) => preset.score >= adaptiveScoreFloor);
		const scoredPresets = thresholded.length > 0 ? thresholded : hydratedPool.slice(0, 6);

		const now = nowMs();
		const candidates: DiversityCandidate<StagePresetSuggestion>[] = scoredPresets.map((preset) => ({
			item: preset,
			score: preset.score,
			typeKey: preset.preset.id,
			intent: presetIntent(preset),
			semanticKey: `${preset.preset.id}:${preset.stages.map((stage) => stageShapeSignature(stage)).join('|')}`
		}));

		return diversifySuggestions({
			namespace: `preset:${input.connectionId}:${stageTypeSignature(input.stages) || 'root'}`,
			candidates,
			limit: 18,
			explorationStrength: 0.58,
			now,
			minDistinctTypes: 2,
			minDistinctIntents: 2
		});
	} catch {
		return fallbackBase;
	}
}

export async function getLLMPlanningContext(input: {
	connectionId: string;
	stages: GUIPipelineStage[];
	availableColumns: string[];
	maxColumns?: number;
	maxSamplesPerColumn?: number;
}): Promise<LLMPlanningContext> {
	const sourceTable = firstFromTable(input.stages);
	const maxColumns = Math.max(4, Math.min(36, Math.round(input.maxColumns ?? 20)));
	const maxSamplesPerColumn = Math.max(1, Math.min(8, Math.round(input.maxSamplesPerColumn ?? 4)));

	try {
		await ensureIntelligenceMetaTables();

		let profileRows: ProfileRow[] = [];
		if (sourceTable) {
			const relationCandidates = relationNameCandidates(sourceTable);
			const relationPredicate =
				relationCandidates.length > 0
					? `relation_name IN (${relationCandidates.map((name) => quoteLiteral(name)).join(', ')})`
					: `relation_name = ${quoteLiteral(sourceTable)}`;
			const profileResult = await executeSQL(`
				SELECT column_name, data_kind, semantic_type, semantic_signature, semantic_confidence,
				       null_ratio, distinct_count, sample_values_json,
				       min_val, max_val, mean_val, stddev_val, p50_val, p75_val,
				       top_values_json, date_granularity
				FROM ${META_SCHEMA}.column_profiles
				WHERE connection_id = ${quoteLiteral(input.connectionId)}
				  AND ${relationPredicate}
				ORDER BY seen_count DESC, last_seen_ms DESC
			`);
			profileRows = profileResult.rows as unknown as ProfileRow[];
		}

		const scopedProfileRows = scopeProfileRowsToAvailableColumns(profileRows, input.availableColumns);
		if (scopedProfileRows.length > 0) {
			profileRows = scopedProfileRows;
		} else if (profileRows.length === 0 && input.availableColumns.length > 0) {
			profileRows = bootstrapProfilesFromColumns(input.availableColumns);
		}

		const byName = new Map(
			profileRows.map((row) => [row.column_name.trim().toLowerCase(), row] as const)
		);
		const orderedColumns =
			input.availableColumns.length > 0
				? input.availableColumns
				: profileRows.map((row) => row.column_name);

		type RichProfileRow = ProfileRow & {
			min_val?: string | null;
			max_val?: string | null;
			mean_val?: number | null;
			stddev_val?: number | null;
			p50_val?: string | null;
			p75_val?: string | null;
			top_values_json?: string | null;
			date_granularity?: string | null;
		};

		const columns: LLMPlanningColumnContext[] = [];
		for (const columnName of orderedColumns) {
			if (columns.length >= maxColumns) break;
			const key = columnName.trim().toLowerCase();
			if (!key) continue;
			const row = (byName.get(key) as RichProfileRow) ?? bootstrapProfilesFromColumns([columnName])[0];
			if (!row) continue;

			let topValues: Array<{ v: string; pct: number }> | undefined;
			if (row.top_values_json) {
				try { topValues = JSON.parse(row.top_values_json) as Array<{ v: string; pct: number }>; } catch { /* ignore */ }
			}

			// Prefer frequency-ranked top values over random samples
			const sampleValues = topValues?.slice(0, maxSamplesPerColumn).map((t) => t.v)
				?? parseSampleValues(row.sample_values_json).slice(0, maxSamplesPerColumn);

			columns.push({
				name: columnName,
				dataKind: row.data_kind,
				semanticType: row.semantic_type,
				semanticConfidence: row.semantic_confidence,
				nullRatio: Number(row.null_ratio ?? 0),
				distinctCount: Number(row.distinct_count ?? 0),
				sampleValues,
				minVal: row.min_val ?? undefined,
				maxVal: row.max_val ?? undefined,
				meanVal: row.mean_val != null ? Number(row.mean_val) : undefined,
				p50Val: row.p50_val ?? undefined,
				p75Val: row.p75_val ?? undefined,
				topValues,
				dateGranularity: (row.date_granularity as 'day' | 'month' | 'year' | undefined) ?? undefined
			});
		}

		return {
			sourceTable,
			pipelineStageTypes: input.stages.filter((stage): stage is Exclude<GUIPipelineStage, { type: 'raw' }> => stage.type !== 'raw').map((stage) => stage.type),
			columns
		};
	} catch {
		const fallbackColumns = input.availableColumns.slice(0, maxColumns).map((name) => {
			const row = bootstrapProfilesFromColumns([name])[0];
			return {
				name,
				dataKind: row?.data_kind ?? 'text',
				semanticType: row?.semantic_type,
				semanticConfidence: row?.semantic_confidence,
				nullRatio: Number(row?.null_ratio ?? 0),
				distinctCount: Number(row?.distinct_count ?? 0),
				sampleValues: []
			};
		});

		return {
			sourceTable,
			pipelineStageTypes: input.stages.filter((stage): stage is Exclude<GUIPipelineStage, { type: 'raw' }> => stage.type !== 'raw').map((stage) => stage.type),
			columns: fallbackColumns
		};
	}
}

/**
 * Proactively sample an external DB table and profile it using DuckDB WASM.
 * Fire-and-forget: returns immediately; profiling runs async in background.
 * On the next AI call, getLLMPlanningContext will find the rich profiles.
 */
export async function fetchAndProfileExternalTable(input: {
	connectionId: string;
	sourceTable: string;
	connection: { id: string; type: string; [key: string]: unknown };
}): Promise<void> {
	if (input.connectionId === BUILTIN_DUCKDB_CONNECTION_ID) return;
	if (!input.sourceTable) return;

	await ensureIntelligenceMetaTables();
	const synonyms = await getSemanticSynonyms(input.connectionId);
	const ts = nowMs();

	// Fetch a sample from the external table via the server API
	let sampleRows: Record<string, unknown>[] = [];
	let sampleColumns: string[] = [];
	try {
		const resp = await fetch('/api/connections/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				connection: input.connection,
				sql: `SELECT * FROM "${input.sourceTable.replace(/"/g, '""')}" LIMIT 2000`
			})
		});
		if (!resp.ok) return;
		const body = (await resp.json()) as { rows?: Record<string, unknown>[]; columns?: string[] };
		sampleRows = body.rows ?? [];
		sampleColumns = body.columns ?? [];
	} catch {
		return; // Network error — skip silently
	}

	if (sampleRows.length === 0 || sampleColumns.length === 0) return;

	// Load sample into DuckDB WASM and compute rich stats
	let richStats: Map<string, RichColumnStats> = new Map();
	const tempId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	try {
		await loadRowsForProfiling(tempId, sampleRows);
		richStats = await computeRichStatsFromDuckDB(`"_p_${tempId}"`);
	} catch {
		return;
	} finally {
		await dropProfileTable(tempId);
	}

	// Upsert column profiles for the external table
	for (const column of sampleColumns) {
		const jsStats = computeColumnStats(sampleRows, column);
		const rich = richStats.get(column);
		const nullRatio = rich?.nullRatio ?? jsStats.nullRatio;
		const distinctCount = rich?.distinctCount ?? jsStats.distinctCount;
		const samples = rich?.topValues?.map((t) => t.v) ?? jsStats.samples;
		const inferred = inferColumnSemantics({
			columnName: column,
			dataKind: jsStats.kind,
			samples,
			nullRatio,
			distinctCount,
			synonyms
		});
		const topValuesJson = rich?.topValues ? JSON.stringify(rich.topValues) : null;
		await run(`
			INSERT INTO ${META_SCHEMA}.column_profiles (
				connection_id, relation_name, column_name, data_kind,
				semantic_type, semantic_signature, semantic_confidence,
				null_ratio, distinct_count, sample_values_json,
				min_val, max_val, mean_val, stddev_val, p50_val, p75_val,
				top_values_json, date_granularity, profile_source,
				last_seen_ms, seen_count
			)
			VALUES (
				${quoteLiteral(input.connectionId)},
				${quoteLiteral(input.sourceTable)},
				${quoteLiteral(column)},
				${quoteLiteral(jsStats.kind)},
				${quoteLiteral(inferred.semanticType)},
				${quoteLiteral(inferred.signature)},
				${inferred.confidence},
				${nullRatio},
				${distinctCount},
				${quoteLiteral(JSON.stringify(samples))},
				${rich?.minVal != null ? quoteLiteral(rich.minVal) : 'NULL'},
				${rich?.maxVal != null ? quoteLiteral(rich.maxVal) : 'NULL'},
				${rich?.meanVal != null ? rich.meanVal : 'NULL'},
				${rich?.stddevVal != null ? rich.stddevVal : 'NULL'},
				${rich?.p50Val != null ? quoteLiteral(rich.p50Val) : 'NULL'},
				${rich?.p75Val != null ? quoteLiteral(rich.p75Val) : 'NULL'},
				${topValuesJson != null ? quoteLiteral(topValuesJson) : 'NULL'},
				${rich?.dateGranularity != null ? quoteLiteral(rich.dateGranularity) : 'NULL'},
				${quoteLiteral(rich != null ? 'duckdb-rich' : 'in-memory')},
				${ts},
				1
			)
			ON CONFLICT (connection_id, relation_name, column_name) DO UPDATE SET
				null_ratio = EXCLUDED.null_ratio,
				distinct_count = EXCLUDED.distinct_count,
				sample_values_json = EXCLUDED.sample_values_json,
				min_val = EXCLUDED.min_val,
				max_val = EXCLUDED.max_val,
				mean_val = EXCLUDED.mean_val,
				stddev_val = EXCLUDED.stddev_val,
				p50_val = EXCLUDED.p50_val,
				p75_val = EXCLUDED.p75_val,
				top_values_json = EXCLUDED.top_values_json,
				date_granularity = EXCLUDED.date_granularity,
				profile_source = EXCLUDED.profile_source,
				last_seen_ms = EXCLUDED.last_seen_ms,
				seen_count = ${META_SCHEMA}.column_profiles.seen_count + 1
		`);
	}
}
