import type { GUIPipelineStage, StageType, DeriveExpr } from '$lib/types/gui-pipeline';
import { guiToPreql } from '$lib/services/gui-prql';
import { compilePRQL } from '$lib/services/prql';
import {
	PRQL_FUNCTION_REGISTRY,
	type PrqlFunctionOption,
	canonicalizePrqlFunction
} from '$lib/constants/prql-functions';
import {
	findSemanticDeriveCandidates,
	type SemanticDeriveColumn
} from '$lib/services/semantic-derive';

export type StageGroup = 'recommended' | 'transform' | 'aggregate' | 'source';

export interface StageCatalogItem {
	type: StageType;
	label: string;
	description: string;
	keywords: string[];
	group: StageGroup;
}

export interface StageRecommendation {
	type: StageType;
	score: number;
	reasons: string[];
}

export interface StageRecommendationInput {
	stages: GUIPipelineStage[];
	availableColumnCount: number;
	availableColumns?: string[];
	availableColumnProfiles?: Partial<Record<string, PresetColumnProfile>>;
	dialect?: CoercionDialect;
	recentUsage?: Partial<Record<StageType, number>>;
}

export type CoercionDialect = 'duckdb' | 'postgres' | 'clickhouse';

export type PresetColumnDataKind = 'numeric' | 'date' | 'boolean' | 'text';

export interface PresetColumnProfile {
	dataKind: PresetColumnDataKind;
	semanticType?: string;
	confidence?: number;
}

export interface StagePresetBuildInput {
	availableColumns?: string[];
	availableColumnProfiles?: Partial<Record<string, PresetColumnProfile>>;
	dialect?: CoercionDialect;
}

export type SemanticCategory =
	| 'temporal'
	| 'geographic'
	| 'categorical'
	| 'id'
	| 'continuous-numeric'
	| 'boolean'
	| 'text'
	| 'ordinal'
	| 'ratio-derived'
	| 'event-log'
	| 'network-relational'
	| 'media-reference';

export interface HydratedSuggestionMetadata {
	semanticCategory: SemanticCategory;
	analysisPattern: string;
	techniques: string[];
	metricHints: string[];
	confidence: number;
	deferredReasons?: string[];
}

export interface StagePresetItem {
	id: string;
	label: string;
	description: string;
	keywords: string[];
}

export interface StagePresetSuggestion {
	preset: StagePresetItem;
	score: number;
	reasons: string[];
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[];
	hydration: HydratedSuggestionMetadata;
	snippet?: StageSuggestionSnippet;
}

export interface FunctionSearchSuggestion {
	id: string;
	label: string;
	description: string;
	keywords: string[];
	stage: Extract<GUIPipelineStage, { type: 'derive' }>;
	category: 'common' | 'math' | 'text' | 'date';
	score: number;
}

export interface StageSemanticFanoutSuggestion {
	id: string;
	label: string;
	description: string;
	stage: Exclude<GUIPipelineStage, { type: 'raw' }>;
	stageType: StageType;
	columns: string[];
	reasons: string[];
	score: number;
}

export interface StageAnalysisPromptSuggestion {
	id: string;
	label: string;
	description: string;
	prompt: string;
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[];
	reasons: string[];
	score: number;
	confidence: number;
}

export interface PromptStageValidation {
	isValid: boolean;
	repaired: boolean;
	unknownColumns: string[];
	issues: string[];
	compileIssues: string[];
	prql: string;
}

export interface PromptStageGenerationPlan {
	suggestion: StageAnalysisPromptSuggestion;
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[];
	confidence: number;
	autoApply: boolean;
	validation: PromptStageValidation;
}

export interface ExternalPromptStageSuggestionInput {
	label: string;
	prompt?: string;
	reasons?: string[];
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[];
	score?: number;
	confidence?: number;
}

export type QuickChipIcon =
	| 'sort'
	| 'filter'
	| 'group'
	| 'derive'
	| 'select'
	| 'take'
	| 'append'
	| 'window'
	| 'loop';

export interface QuickChip {
	id: string;
	label: string;
	icon: QuickChipIcon;
	stage: Exclude<GUIPipelineStage, { type: 'raw' }>;
	tone: 'primary' | 'accent';
	hydration: HydratedSuggestionMetadata;
	snippet?: StageSuggestionSnippet;
}

export interface StageSuggestionSnippet {
	title: string;
	prql: string;
	tags: string[];
}

function buildSnippet(input: {
	title: string;
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[];
	tags: string[];
}): StageSuggestionSnippet {
	return {
		title: input.title,
		prql: guiToPreql(input.stages),
		tags: input.tags
	};
}

function presetHydrationFor(id: StagePresetItem['id']): HydratedSuggestionMetadata {
	switch (id) {
		case 'top-metric':
			return {
				semanticCategory: 'continuous-numeric',
				analysisPattern: 'Statistical Summarization & Predictive Modeling',
				techniques: ['rank by metric', 'top-N trimming'],
				metricHints: ['mean', 'median', 'outlier magnitude'],
				confidence: 0.78
			};
		case 'group-top':
			return {
				semanticCategory: 'categorical',
				analysisPattern: 'Segmentation, Grouping & Classification',
				techniques: ['group by segment', 'aggregate and compare'],
				metricHints: ['frequency counts', 'cross-segment totals'],
				confidence: 0.82
			};
		case 'dedup-exact':
			return {
				semanticCategory: 'id',
				analysisPattern: 'Entity Deduplication & Relationship Mapping',
				techniques: ['exact-row duplicate elimination', 'full-row grouping'],
				metricHints: ['duplicate rate', 'row uniqueness', 'post-dedup row count'],
				confidence: 0.83
			};
		case 'dedup-latest':
			return {
				semanticCategory: 'id',
				analysisPattern: 'Entity Deduplication & Relationship Mapping',
				techniques: ['key uniqueness checks', 'latest-row retention'],
				metricHints: ['duplicate rate', 'null rate', 'join hit rate'],
				confidence: 0.84
			};
		case 'temporal-trend':
			return {
				semanticCategory: 'temporal',
				analysisPattern: 'Time-Series Forecasting & Window Aggregation',
				techniques: ['time bucketing', 'rolling comparisons'],
				metricHints: ['trend direction', 'MoM growth', 'lag deltas'],
				confidence: 0.88
			};
		case 'text-categorize':
			return {
				semanticCategory: 'text',
				analysisPattern: 'NLP & Thematic Extraction',
				techniques: ['rule-based token bucketing', 'semantic grouping'],
				metricHints: ['keyword frequency', 'topic bucket counts'],
				confidence: 0.74,
				deferredReasons: ['full embedding similarity and model sentiment scoring are deferred']
			};
		case 'anomaly-scan':
			return {
				semanticCategory: 'continuous-numeric',
				analysisPattern: 'Statistical Summarization & Predictive Modeling',
				techniques: ['absolute magnitude scoring', 'outlier ranking'],
				metricHints: ['standard deviation proxy', 'extreme value concentration'],
				confidence: 0.79
			};
		case 'frequency-ranking':
			return {
				semanticCategory: 'categorical',
				analysisPattern: 'Segmentation, Grouping & Classification',
				techniques: ['count by class', 'dominant class ranking'],
				metricHints: ['mode', 'frequency counts'],
				confidence: 0.81
			};
		case 'cashflow-rollup':
			return {
				semanticCategory: 'ratio-derived',
				analysisPattern: 'Performance Benchmarking & Decomposition',
				techniques: ['derive inflow/outflow', 'net decomposition'],
				metricHints: ['variance from baseline', 'net change'],
				confidence: 0.83
			};
		case 'hierarchical-rollup':
			return {
				semanticCategory: 'network-relational',
				analysisPattern: 'Graph Analysis & Hierarchy Traversal',
				techniques: ['parent-child aggregation', 'hierarchical drilldown'],
				metricHints: ['hierarchy depth', 'node concentration'],
				confidence: 0.72,
				deferredReasons: ['true graph centrality and shortest path metrics are deferred']
			};
		case 'contribution-total':
			return {
				semanticCategory: 'ratio-derived',
				analysisPattern: 'Performance Benchmarking & Decomposition',
				techniques: ['share-of-total derivation', 'segment contribution ranking'],
				metricHints: ['percentile rank', 'share index'],
				confidence: 0.8
			};
		case 'period-variance':
			return {
				semanticCategory: 'temporal',
				analysisPattern: 'Time-Series Forecasting & Window Aggregation',
				techniques: ['period bucketing', 'period-over-period deltas'],
				metricHints: ['YoY/MoM growth', 'lag comparisons'],
				confidence: 0.85
			};
		case 'segment-anomaly':
			return {
				semanticCategory: 'categorical',
				analysisPattern: 'Segmentation, Grouping & Classification',
				techniques: ['segment slicing', 'deviation ranking'],
				metricHints: ['chi-square style disparity cues', 'segment lift'],
				confidence: 0.77
			};
		case 'null-hotspots':
			return {
				semanticCategory: 'id',
				analysisPattern: 'Entity Deduplication & Relationship Mapping',
				techniques: ['null concentration map', 'entity-quality slices'],
				metricHints: ['null rate', 'orphan risk'],
				confidence: 0.75
			};
		case 'duplicate-fingerprint':
			return {
				semanticCategory: 'id',
				analysisPattern: 'Entity Deduplication & Relationship Mapping',
				techniques: ['fingerprint grouping', 'duplicate clustering'],
				metricHints: ['duplicate rate', 'referential integrity cues'],
				confidence: 0.86
			};
		case 'cohort-retention':
			return {
				semanticCategory: 'event-log',
				analysisPattern: 'Sequence Analysis & Funnel Reconstruction',
				techniques: ['entity-time cohorting', 'activity sequence summaries'],
				metricHints: ['session length distribution', 'steps-to-conversion proxy'],
				confidence: 0.79
			};
		case 'funnel-dropoff':
			return {
				semanticCategory: 'event-log',
				analysisPattern: 'Sequence Analysis & Funnel Reconstruction',
				techniques: ['stage progression reconstruction', 'drop-off isolation'],
				metricHints: ['transition probabilities', 'drop-off state frequency'],
				confidence: 0.83
			};
		case 'outlier-explain':
			return {
				semanticCategory: 'continuous-numeric',
				analysisPattern: 'Statistical Summarization & Predictive Modeling',
				techniques: ['outlier surfacing', 'contextual segment attribution'],
				metricHints: ['skewness', 'z-score proxy'],
				confidence: 0.78
			};
		case 'seasonal-pattern':
			return {
				semanticCategory: 'temporal',
				analysisPattern: 'Time-Series Forecasting & Window Aggregation',
				techniques: ['weekday/month extraction', 'seasonality indexing'],
				metricHints: ['seasonality amplitude', 'cyclic trend shifts'],
				confidence: 0.86
			};
		case 'efficiency-lens':
			return {
				semanticCategory: 'ratio-derived',
				analysisPattern: 'Performance Benchmarking & Decomposition',
				techniques: ['cost/revenue ratio', 'segment efficiency benchmarking'],
				metricHints: ['variance from target', 'baseline index'],
				confidence: 0.82
			};
		case 'drift-monitor':
			return {
				semanticCategory: 'event-log',
				analysisPattern: 'Sequence Analysis & Funnel Reconstruction',
				techniques: ['recent vs baseline windows', 'state drift scoring'],
				metricHints: ['transition shifts', 'state frequency drift'],
				confidence: 0.8
			};
		case 'append-union-stack':
			return {
				semanticCategory: 'network-relational',
				analysisPattern: 'Entity Deduplication & Relationship Mapping',
				techniques: ['source unioning', 'post-union normalization'],
				metricHints: ['source contribution', 'schema drift rate'],
				confidence: 0.74
			};
		case 'window-rolling':
			return {
				semanticCategory: 'temporal',
				analysisPattern: 'Time-Series Forecasting & Window Aggregation',
				techniques: ['rolling mean', 'frame-based smoothing'],
				metricHints: ['short-term momentum', 'smoothed trend'],
				confidence: 0.87
			};
		case 'window-lag-delta':
			return {
				semanticCategory: 'temporal',
				analysisPattern: 'Time-Series Forecasting & Window Aggregation',
				techniques: ['lag comparison', 'step-change extraction'],
				metricHints: ['delta spikes', 'period-to-period change'],
				confidence: 0.85
			};
		case 'loop-refine':
			return {
				semanticCategory: 'event-log',
				analysisPattern: 'Sequence Analysis & Funnel Reconstruction',
				techniques: ['iterative narrowing', 'fixed-point style refinement'],
				metricHints: ['convergence stability', 'iteration shrink ratio'],
				confidence: 0.71
			};
		default:
			return {
				semanticCategory: 'continuous-numeric',
				analysisPattern: 'Statistical Summarization & Predictive Modeling',
				techniques: ['template-driven exploration', 'semantic pattern probes'],
				metricHints: ['distribution spread', 'coverage ratio'],
				confidence: 0.64,
				deferredReasons: ['fallback hydration metadata used for dynamic preset id']
			};
	}
}

function quickChipHydrationFor(chip: {
	stage: Exclude<GUIPipelineStage, { type: 'raw' }>;
	label: string;
}): HydratedSuggestionMetadata {
	if (chip.stage.type === 'sort' || /newest|period|month|time|date/i.test(chip.label)) {
		return {
			semanticCategory: 'temporal',
			analysisPattern: 'Time-Series Forecasting & Window Aggregation',
			techniques: ['time ordering', 'window-ready sequencing'],
			metricHints: ['lag/lead comparisons', 'trend direction'],
			confidence: 0.75
		};
	}

	if (chip.stage.type === 'group') {
		return {
			semanticCategory: 'categorical',
			analysisPattern: 'Segmentation, Grouping & Classification',
			techniques: ['segment aggregation', 'dimension comparison'],
			metricHints: ['frequency counts', 'cross-tab style comparisons'],
			confidence: 0.79
		};
	}

	if (chip.stage.type === 'derive') {
		return {
			semanticCategory: 'ratio-derived',
			analysisPattern: 'Performance Benchmarking & Decomposition',
			techniques: ['feature derivation', 'ratio decomposition'],
			metricHints: ['index vs baseline', 'derived performance ratios'],
			confidence: 0.73
		};
	}

	if (chip.stage.type === 'filter') {
		return {
			semanticCategory: 'boolean',
			analysisPattern: 'Event Rate Analysis & Propensity Modeling',
			techniques: ['outcome slicing', 'event-focused filtering'],
			metricHints: ['event rate', 'lift'],
			confidence: 0.7
		};
	}

	if (chip.stage.type === 'take') {
		return {
			semanticCategory: 'event-log',
			analysisPattern: 'Sequence Analysis & Funnel Reconstruction',
			techniques: ['sampled path inspection', 'iteration-focused narrowing'],
			metricHints: ['session length proxy', 'drop-off exploration'],
			confidence: 0.62
		};
	}

	if (chip.stage.type === 'append') {
		return {
			semanticCategory: 'network-relational',
			analysisPattern: 'Entity Deduplication & Relationship Mapping',
			techniques: ['source stacking', 'union harmonization'],
			metricHints: ['source contribution', 'cross-source drift'],
			confidence: 0.68
		};
	}

	if (chip.stage.type === 'window') {
		return {
			semanticCategory: 'temporal',
			analysisPattern: 'Time-Series Forecasting & Window Aggregation',
			techniques: ['frame aggregation', 'lag-aware calculations'],
			metricHints: ['rolling mean', 'step delta'],
			confidence: 0.84
		};
	}

	if (chip.stage.type === 'loop') {
		return {
			semanticCategory: 'event-log',
			analysisPattern: 'Sequence Analysis & Funnel Reconstruction',
			techniques: ['iterative refinement', 'convergence loops'],
			metricHints: ['iteration convergence', 'refinement ratio'],
			confidence: 0.66
		};
	}

	return {
		semanticCategory: 'continuous-numeric',
		analysisPattern: 'Statistical Summarization & Predictive Modeling',
		techniques: ['distribution shaping', 'comparative ranking'],
		metricHints: ['mean', 'variance'],
		confidence: 0.64
	};
}

export const STAGE_CATALOG: StageCatalogItem[] = [
	{
		type: 'append',
		label: 'append',
		description: 'Append rows from one or more sources',
		keywords: ['union', 'combine', 'stack'],
		group: 'transform'
	},
	{
		type: 'filter',
		label: 'filter',
		description: 'Keep rows that match conditions',
		keywords: ['where', 'condition', 'rows'],
		group: 'transform'
	},
	{
		type: 'select',
		label: 'select',
		description: 'Choose columns to keep',
		keywords: ['columns', 'projection', 'pick'],
		group: 'transform'
	},
	{
		type: 'derive',
		label: 'derive',
		description: 'Create computed columns',
		keywords: ['formula', 'compute', 'calculated'],
		group: 'transform'
	},
	{
		type: 'group',
		label: 'group',
		description: 'Aggregate rows by keys',
		keywords: ['aggregate', 'sum', 'count'],
		group: 'aggregate'
	},
	{
		type: 'window',
		label: 'window',
		description: 'Apply window expressions over sorted rows',
		keywords: ['rolling', 'frame', 'over'],
		group: 'transform'
	},
	{
		type: 'loop',
		label: 'loop',
		description: 'Iteratively apply a PRQL loop body',
		keywords: ['iterate', 'repeat', 'recursive'],
		group: 'transform'
	},
	{
		type: 'sort',
		label: 'sort',
		description: 'Order rows by one or more columns',
		keywords: ['order', 'asc', 'desc'],
		group: 'transform'
	},
	{
		type: 'take',
		label: 'take',
		description: 'Limit result row count',
		keywords: ['limit', 'top', 'range'],
		group: 'transform'
	},
	{
		type: 'join',
		label: 'join',
		description: 'Combine rows from another source',
		keywords: ['merge', 'lookup', 'relation'],
		group: 'aggregate'
	},
	{
		type: 'from',
		label: 'from',
		description: 'Set or replace source table',
		keywords: ['source', 'table', 'input'],
		group: 'source'
	}
];

export const STAGE_PRESETS: StagePresetItem[] = [
	{
		id: 'top-metric',
		label: 'Top N by metric',
		description: 'Sort descending and take top rows',
		keywords: ['top', 'limit', 'rank', 'leaderboard']
	},
	{
		id: 'group-top',
		label: 'Group and rank',
		description: 'Group by a dimension, aggregate, then sort',
		keywords: ['group', 'aggregate', 'sum', 'breakdown']
	},
	{
		id: 'dedup-exact',
		label: 'Remove exact duplicates',
		description: 'Group by all selected columns and keep one row per exact record',
		keywords: ['dedup', 'duplicates', 'unique', 'distinct', 'exact']
	},
	{
		id: 'dedup-latest',
		label: 'Remove duplicates by key (keep latest)',
		description: 'Sort by recency and keep one row per key',
		keywords: ['dedup', 'latest', 'first', 'key']
	},
	{
		id: 'temporal-trend',
		label: 'Temporal trend rollup',
		description: 'Bucket any date column by period, aggregate a metric, and sort chronologically',
		keywords: ['trend', 'time series', 'temporal', 'rollup', 'historical', 'over time', 'progression', 'timeline']
	},
	{
		id: 'text-categorize',
		label: 'Categorize text and aggregate',
		description: 'Apply regex-based case buckets to a text column and roll up totals',
		keywords: ['categorize', 'regex', 'case', 'text', 'breakdown', 'classify', 'label', 'bucket', 'tag', 'cluster']
	},
	{
		id: 'anomaly-scan',
		label: 'Top outliers by metric',
		description: 'Rank rows by absolute metric magnitude to surface unusual values',
		keywords: ['outlier', 'anomaly', 'largest', 'threshold', 'scan', 'unusual', 'extreme', 'spike', 'suspicious', 'irregular']
	},
	{
		id: 'frequency-ranking',
		label: 'Most frequent entities',
		description: 'Count rows by entity and rank highest frequency',
		keywords: ['frequency', 'count', 'popular', 'entity', 'ranking']
	},
	{
		id: 'cashflow-rollup',
		label: 'Inflow vs outflow trend',
		description: 'Derive inflow/outflow metrics and aggregate net change over time',
		keywords: ['inflow', 'outflow', 'net', 'cashflow', 'periodic', 'balance', 'flow']
	},
	{
		id: 'hierarchical-rollup',
		label: 'Hierarchical rollup explorer',
		description: 'Aggregate metric across two dimensions for drilldown analysis',
		keywords: ['hierarchy', 'drilldown', 'region', 'product', 'channel']
	},
	{
		id: 'contribution-total',
		label: 'Contribution to total',
		description: 'Compute each segment\'s share as a percentage of the global total',
		keywords: ['contribution', 'share', 'percent', 'total', 'percentage', 'proportion', 'breakdown', 'share of total']
	},
	{
		id: 'period-variance',
		label: 'Period-over-period variance',
		description: 'Compare metric values across consecutive periods and compute growth deltas',
		keywords: ['variance', 'delta', 'growth', 'month-over-month', 'comparison', 'change', 'YoY', 'WoW', 'difference']
	},
	{
		id: 'segment-anomaly',
		label: 'Segment anomaly detector',
		description: 'Find segment combinations with abnormally high or low metric values',
		keywords: ['segment', 'anomaly', 'deviation', 'unusual', 'extreme']
	},
	{
		id: 'null-hotspots',
		label: 'Null hotspot map',
		description: 'Find dimension combinations with the most missing values',
		keywords: ['null', 'missing', 'quality', 'hotspot', 'gaps', 'incomplete', 'data quality']
	},
	{
		id: 'duplicate-fingerprint',
		label: 'Duplicate fingerprint finder',
		description: 'Group rows by a key column and surface the most duplicated entries',
		keywords: ['duplicate', 'fingerprint', 'dedup', 'key', 'repeated', 'matches', 'collision', 'duplicated records']
	},
	{
		id: 'cohort-retention',
		label: 'Cohort retention starter',
		description: 'Group rows by first-seen period and track activity over time',
		keywords: ['cohort', 'retention', 'first seen', 'lifecycle', 'groups', 'engagement', 'first event', 'user groups']
	},
	{
		id: 'funnel-dropoff',
		label: 'Funnel drop-off scaffold',
		description: 'Count rows at each status stage and compute progression percentages',
		keywords: ['funnel', 'drop-off', 'conversion', 'stage', 'pipeline', 'steps', 'conversion rate', 'progress']
	},
	{
		id: 'outlier-explain',
		label: 'Outlier explanation bundle',
		description: 'Rank outliers then summarize contextual segment stats',
		keywords: ['outlier', 'explain', 'context', 'bundle']
	},
	{
		id: 'seasonal-pattern',
		label: 'Seasonal pattern detector',
		description: 'Project weekday and month seasonality from timestamp columns',
		keywords: ['seasonality', 'weekday', 'monthly', 'pattern']
	},
	{
		id: 'efficiency-lens',
		label: 'Efficiency lens',
		description: 'Derive a ratio of cost to revenue per segment and rank weakest performers',
		keywords: ['efficiency', 'ratio', 'cost', 'revenue', 'performance', 'margin', 'profitability', 'ROI']
	},
	{
		id: 'drift-monitor',
		label: 'Drift monitor',
		description: 'Compare metric behavior in a recent window versus a historical baseline',
		keywords: ['drift', 'recent', 'baseline', 'monitor', 'change', 'shift', 'before after', 'current vs past']
	},
	{
		id: 'append-union-stack',
		label: 'Append source stack',
		description: 'Union multiple similarly-shaped sources and summarize combined volume',
		keywords: ['append', 'union', 'stack', 'multi-source']
	},
	{
		id: 'window-rolling',
		label: 'Rolling window smoother',
		description: 'Sort by time and compute rolling average-style window metrics',
		keywords: ['window', 'rolling', 'moving average', 'smoothing']
	},
	{
		id: 'window-lag-delta',
		label: 'Lag delta detector',
		description: 'Compute lag and delta columns to surface abrupt period changes',
		keywords: ['window', 'lag', 'delta', 'change detection']
	},
	{
		id: 'loop-refine',
		label: 'Iterative loop refine',
		description: 'Apply an iterative loop to progressively narrow rows by a condition',
		keywords: ['loop', 'iterate', 'refine', 'stabilize', 'repeat', 'recursive', 'iterative filter']
	}
];

function preferColumn(columns: string[], hints: string[]): string | null {
	if (columns.length === 0) return null;
	const normalized = columns.map((column) => ({
		column,
		normalized: column.trim().toLowerCase()
	}));

	for (const hint of hints) {
		const exact = normalized.find((entry) => entry.normalized === hint)?.column;
		if (exact) return exact;
	}

	for (const hint of hints) {
		const includes = normalized.find((entry) => entry.normalized.includes(hint))?.column;
		if (includes) return includes;
	}

	return columns[0] ?? null;
}

function pickMetricColumn(columns: string[]): string | null {
	const preferred = preferColumn(columns, ['amount', 'revenue', 'sales', 'balance', 'paid', 'withdrawn', 'received', 'disbursed', 'credited', 'debited', 'count', 'value', 'price', 'cost', 'score', 'metric', 'total', 'net', 'gross', 'margin', 'income', 'profit', 'budget', 'spend', 'fee', 'tax', 'earnings', 'clicks', 'views', 'impressions', 'visits', 'sessions', 'conversions', 'duration', 'size', 'area']);
	if (preferred && !isTemporalColumn(preferred) && !isIdentifierColumn(preferred) && (isRoundWorthyNumericColumn(preferred) || isCountLikeNumericColumn(preferred))) return preferred;
	const measurementLike = columns.find((column) =>
		/(length|width|height|depth|diameter|radius|mass|weight|petal|sepal|score|index|measurement|area|size|duration|elapsed|bandwidth|throughput)/i.test(column) &&
		!isTemporalColumn(column) &&
		!isIdentifierColumn(column)
	);
	if (measurementLike) return measurementLike;
	return columns.find((column) => /(amount|revenue|sales|balance|paid|withdrawn|received|disbursed|credited|debited|count|value|price|cost|score|metric|total|net|gross|margin|income|profit|budget|spend|fee|tax|earnings|clicks|views|impressions|visits|sessions|conversions|duration|size|area)/i.test(column) && !isTemporalColumn(column) && !isIdentifierColumn(column) && (isRoundWorthyNumericColumn(column) || isCountLikeNumericColumn(column))) ?? null;
}

function pickProfileMetricColumn(input: StagePresetBuildInput): string | null {
	const columns = input.availableColumns ?? [];
	const profiles = input.availableColumnProfiles;
	if (!profiles || columns.length === 0) return null;

	const candidates = columns
		.map((column) => ({ column, profile: columnProfileFor(profiles, column) }))
		.filter(({ column, profile }) => {
			if (!profile) return false;
			if (profile.dataKind !== 'numeric') return false;
			if (isTemporalColumn(column) || isIdentifierColumn(column)) return false;
			if (/(id|foreign_key|status|category|entity_name|description|text)/i.test(profile.semanticType ?? '')) return false;
			return true;
		});

	if (candidates.length === 0) return null;

	const scored = candidates
		.map(({ column, profile }) => {
			let score = 1;
			const semantic = profile?.semanticType ?? '';
			if (/(amount|currency_amount|unit_price|inflow|outflow)/i.test(semantic)) score += 2.3;
			if (/(metric|quantity|count|ratio|percentage|volume_measure)/i.test(semantic)) score += 1.6;
			if (/(length|width|height|depth|diameter|radius|mass|weight|petal|sepal|score|index|measurement)/i.test(column)) score += 1.3;
			if (/(amount|revenue|sales|cost|price|balance)/i.test(column)) score += 1.7;
			if (/(count|total|num|number)/i.test(column)) score -= 0.2;
			return { column, score };
		})
		.sort((a, b) => b.score - a.score);

	return scored[0]?.column ?? null;
}

function isPriceLikeMetricColumn(column: string, profile: PresetColumnProfile | null): boolean {
	if (!column) return false;
	if (isTemporalColumn(column) || isIdentifierColumn(column)) return false;
	const semantic = profile?.semanticType ?? '';
	if (/(id|foreign_key|status|category|entity_name|description|text)/i.test(semantic)) return false;
	if (/(price|unit.?price|cost|rate|amount|fee|charge|value)/i.test(column)) return true;
	if (/(price|cost|rate|amount|fee|charge|value)/i.test(semantic)) return true;
	return false;
}

function isQuantityLikeColumn(column: string, profile: PresetColumnProfile | null): boolean {
	if (!column) return false;
	if (isTemporalColumn(column) || isIdentifierColumn(column)) return false;
	const semantic = profile?.semanticType ?? '';
	if (/(id|foreign_key|status|category|entity_name|description|text)/i.test(semantic)) return false;
	if (/(units?|qty|quantit|count|volume|sold|items?|pieces?|ordered|purchased|shipped|delivered|produced|invoiced|consumed|allocated)/i.test(column)) return true;
	if (/(quantity|count)/i.test(semantic)) return true;
	return false;
}

interface CompositeMetricPlan {
	name: string;
	token: string;
	expressionSql: string;
	priceColumn: string;
	quantityColumn: string;
}

function findCompositeMetricPlan(input: StagePresetBuildInput, dialect: CoercionDialect): CompositeMetricPlan | null {
	const columns = input.availableColumns ?? [];
	if (columns.length < 2) return null;

	let best: { price: string; qty: string; score: number } | null = null;
	for (const price of columns) {
		const priceProfile = columnProfileFor(input.availableColumnProfiles, price);
		if (!isPriceLikeMetricColumn(price, priceProfile)) continue;
		for (const qty of columns) {
			if (qty === price) continue;
			const qtyProfile = columnProfileFor(input.availableColumnProfiles, qty);
			if (!isQuantityLikeColumn(qty, qtyProfile)) continue;

			let score = 1;
			if (priceProfile?.dataKind === 'numeric') score += 0.7;
			if (qtyProfile?.dataKind === 'numeric') score += 0.7;
			if (/(price|unit.?price)/i.test(price)) score += 0.6;
			if (/(units?|qty|sold)/i.test(qty)) score += 0.6;
			if (/amount|revenue|sales/i.test(price)) score -= 0.2;

			if (!best || score > best.score) best = { price, qty, score };
		}
	}

	if (!best) return null;

	const priceSql = `coalesce(${buildCoercedMetricSqlExpr(best.price, dialect)}, 0)`;
	const qtySql = `coalesce(${buildCoercedMetricSqlExpr(best.qty, dialect)}, 0)`;
	return {
		name: 'revenue',
		token: 'revenue',
		expressionSql: `${priceSql} * ${qtySql}`,
		priceColumn: best.price,
		quantityColumn: best.qty
	};
}

function pickDimensionColumn(columns: string[]): string | null {
	if (columns.length === 0) return null;
	const hints = ['species', 'class', 'target', 'genre', 'sub_genre', 'mood', 'category', 'segment', 'region', 'country', 'city', 'customer', 'vendor', 'merchant', 'payee', 'type', 'status', 'group', 'label', 'department', 'team', 'project', 'source', 'platform', 'channel', 'plan', 'tier', 'branch', 'zone', 'division', 'sector', 'campaign', 'medium', 'product', 'brand', 'office'];
	const normalized = columns.map((column) => ({
		column,
		normalized: column.trim().toLowerCase()
	}));

	for (const hint of hints) {
		const exact = normalized.find((entry) => entry.normalized === hint)?.column;
		if (exact) return exact;
	}

	for (const hint of hints) {
		const includes = normalized.find((entry) => entry.normalized.includes(hint))?.column;
		if (includes) return includes;
	}

	return null;
}

function pickTimestampColumn(columns: string[]): string | null {
	const temporalCandidates = columns.filter((column) => isTemporalColumn(column));
	if (temporalCandidates.length > 0) {
		return preferColumn(temporalCandidates, [
			'updated_at',
			'timestamp',
			'created_at',
			'date',
			'time',
			'deadline',
			'due',
			'expires'
		]);
	}
	return null;
}

function pickEntityColumn(columns: string[]): string | null {
	return preferColumn(columns, ['payee', 'merchant', 'vendor', 'customer', 'user', 'account', 'company', 'name', 'entity', 'partner', 'supplier', 'provider', 'owner', 'member', 'subscriber', 'employee', 'agent', 'client', 'contact']);
}

function pickDetailTextColumn(columns: string[]): string | null {
	return preferColumn(columns, ['details', 'detail', 'description', 'memo', 'message', 'note', 'narrative', 'title']);
}

function pickInflowOutflowColumns(columns: string[]): { inflow: string | null; outflow: string | null } {
	const inflow = preferColumn(columns, ['paid in', 'inflow', 'credit', 'credited', 'deposit', 'received']);
	const outflow = preferColumn(columns, ['withdrawn', 'outflow', 'debit', 'debited', 'spent', 'payment', 'charge']);
	return { inflow, outflow };
}

function quotedSqlIdentifier(column: string): string {
	return `\\"${column.replaceAll('"', '\\\\"')}\\"`;
}

function quotedSqlTextLiteral(value: string): string {
	return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}

function normalizeCoercionDialect(dialect?: CoercionDialect): CoercionDialect {
	if (dialect === 'postgres' || dialect === 'clickhouse') return dialect;
	return 'duckdb';
}

function quotePrqlIdentifier(name: string): string {
	if (!name) return name;
	if (name.startsWith('`') && name.endsWith('`')) return name;
	if (/[^A-Za-z0-9_.]/.test(name)) return `\`${name}\``;
	return name;
}

function nullSafeNumeric(expr: string): string {
	return `(${expr} ?? 0)`;
}

function safeStageToken(value: string): string {
	return value.replace(/\W+/g, '_');
}

function columnProfileFor(
	profiles: StagePresetBuildInput['availableColumnProfiles'],
	column: string
): PresetColumnProfile | null {
	if (!profiles || !column) return null;
	if (profiles[column]) return profiles[column] ?? null;
	const normalized = column.trim().toLowerCase();
	for (const [name, profile] of Object.entries(profiles)) {
		if (name.trim().toLowerCase() === normalized) return profile ?? null;
	}
	return null;
}

function isNumericSemanticHint(semanticType?: string): boolean {
	if (!semanticType) return false;
	return /(amount|metric|count|ratio|percentage|quantity|value|price|cost|revenue|sales|balance|score|total)/i.test(semanticType);
}

function isOutflowLikeMetric(column: string, profile: PresetColumnProfile | null): boolean {
	if (!column) return false;
	if (/(withdrawn|outflow|debit|debited|spent|payment|charge|expense|cost)/i.test(column)) return true;
	return /(outflow|debit|expense|cost)/i.test(profile?.semanticType ?? '');
}

function isTemporalSemanticHint(semanticType?: string): boolean {
	if (!semanticType) return false;
	return /(date|time|timestamp|created_at|updated_at|deadline|due|expires)/i.test(semanticType);
}

function shouldCoerceMetricToNumeric(column: string, profile: PresetColumnProfile | null): boolean {
	if (!column) return false;
	if (!profile) return false;
	if (profile.dataKind === 'numeric') return false;
	if (profile.dataKind === 'date' || profile.dataKind === 'boolean') return false;
	if (profile.dataKind === 'text') {
		if (isNumericSemanticHint(profile.semanticType)) return true;
		if (profile.semanticType && /status|category|entity|name|description|text|id|foreign_key/i.test(profile.semanticType)) return false;
		return true;
	}
	return true;
}

function buildCoercedMetricSqlExpr(column: string, dialect: CoercionDialect): string {
	const id = quotedSqlIdentifier(column);
	if (dialect === 'clickhouse') {
		return `toFloat64OrNull(replaceRegexpAll(toString(${id}), '[^0-9.+\\-]', ''))`;
	}
	if (dialect === 'postgres') {
		return `cast(nullif(regexp_replace(cast(${id} as varchar), '[^0-9.+\\-]', '', 'g'), '') as double precision)`;
	}
	return `cast(nullif(regexp_replace(cast(${id} as varchar), '[^0-9.+\\-]', '', 'g'), '') as double)`;
}

function buildNullSafeNumericSqlExpr(column: string, dialect: CoercionDialect): string {
	return `coalesce(${buildCoercedMetricSqlExpr(column, dialect)}, 0)`;
}

function buildTemporalSqlExpr(column: string, profile: PresetColumnProfile | null, dialect: CoercionDialect): string {
	const id = quotedSqlIdentifier(column);
	if (profile?.dataKind === 'date' || isTemporalSemanticHint(profile?.semanticType)) {
		if (dialect === 'clickhouse') return `parseDateTime64BestEffortOrNull(toString(${id}))`;
		return `cast(${id} as timestamp)`;
	}
	if (profile?.dataKind === 'numeric') {
		if (dialect === 'clickhouse') return `fromUnixTimestamp64Milli(toInt64OrNull(${id}))`;
		if (dialect === 'postgres') return `to_timestamp(cast(${id} as double precision) / 1000.0)`;
		return `to_timestamp(cast(${id} as double) / 1000)`;
	}
	if (profile?.dataKind === 'boolean') {
		return `null`;
	}
	if (/(^|_|\b)(time|timestamp|date|deadline|due)($|_|\b)/i.test(column)) {
		if (dialect === 'clickhouse') return `parseDateTime64BestEffortOrNull(toString(${id}))`;
		return `cast(${id} as timestamp)`;
	}
	// Text temporal coercion is dialect-sensitive; fall back to non-temporal grouping
	// instead of emitting engine-specific casts that can fail at runtime.
	return '';
}

function buildTemporalGapDaysSql(
	startColumn: string,
	endColumn: string,
	startProfile: PresetColumnProfile | null,
	endProfile: PresetColumnProfile | null,
	dialect: CoercionDialect
): string {
	const startTs = buildTemporalSqlExpr(startColumn, startProfile, dialect);
	const endTs = buildTemporalSqlExpr(endColumn, endProfile, dialect);
	if (!startTs || !endTs) {
		return `${quotePrqlIdentifier(endColumn)} - ${quotePrqlIdentifier(startColumn)}`;
	}

	if (dialect === 'postgres') {
		return `extract(epoch from (${endTs} - ${startTs})) / 86400.0`;
	}

	if (dialect === 'clickhouse') {
		return `dateDiff('day', ${startTs}, ${endTs})`;
	}

	return `date_diff('day', ${startTs}, ${endTs})`;
}

function humanizeColumnName(name: string): string {
	return name
		.trim()
		.replace(/["`]/g, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_\.]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean)
		.map((word) => {
			if (/^[A-Z0-9]{2,}$/.test(word)) return word;
			return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
		})
		.join(' ');
}

function isTemporalColumn(column: string): boolean {
	const lower = column.toLowerCase();
	if (/(on_time|delivered_on_time|returned|present|active|approved|rejected|passed|failed|escalated|admitted|occupied|fraud|alert)/i.test(lower)
		&& !/(date|timestamp|created|updated|arrival|departure|start|end)/i.test(lower)) {
		return false;
	}
	if (lower.includes('createdat') || lower.includes('updatedat')) return true;
	if (lower.endsWith('_at') || lower.endsWith('at')) return true;
	return /(^|_|\b)(date|time|timestamp|deadline|due|expires?|created_at|updated_at)($|_|\b)/i.test(column);
}

function isIdentifierColumn(column: string): boolean {
	return /(^id$|_id$|uuid|key|_no$|_num$|_number$|_ref$|_code$|_serial$|\bno\.)/i.test(column);
}

function isLikelyTextColumn(column: string): boolean {
	return /(name|title|label|status|state|type|category|segment|city|country|region|description)/i.test(column);
}

function isCountLikeNumericColumn(column: string): boolean {
	return /(count|total|num|number|qty|quantity|jobs|visits|users|orders|records|rows)/i.test(column);
}

function isRoundWorthyNumericColumn(column: string): boolean {
	return /(amount|price|cost|revenue|sales|balance|paid|withdrawn|credited|debited|avg|mean|ratio|rate|percent|pct|score|value|metric|units?|qty|quantity|seats?|distance|weight|temperature|temp|humidity|wind|rainfall|energy|kwh|minutes?|hours?|days?|latency|downtime|risk|defect|fx|mrr|arr)/i.test(column);
}

function pickNonTemporalMetricColumn(columns: string[]): string | null {
	const preferred = pickMetricColumn(columns);
	if (preferred) return preferred;
	return null;
}

function hasProfileMetricSignal(input: StagePresetBuildInput): boolean {
	return pickProfileMetricColumn(input) !== null;
}

function pickDimensionFallback(columns: string[], metric: string | null): string | null {
	const preferred = pickDimensionColumn(columns);
	if (preferred && preferred !== metric && !isTemporalColumn(preferred)) return preferred;
	return columns.find((column) => column !== metric && !isTemporalColumn(column)) ?? null;
}

function pickDimensionColumns(columns: string[], metric: string | null, maxCount = 2): string[] {
	const hints = [
		'species', 'class', 'target', 'region', 'country', 'city', 'product', 'category', 'segment', 'channel',
		'status', 'stage', 'type', 'group', 'cohort', 'merchant', 'vendor', 'customer', 'payee'
	];
	const selected: string[] = [];
	for (const hint of hints) {
		const found = columns.find((column) => {
			const lower = column.toLowerCase();
			if (selected.includes(column)) return false;
			if (metric && column === metric) return false;
			if (isTemporalColumn(column)) return false;
			if (isIdentifierColumn(column)) return false;
			return lower === hint || lower.includes(hint);
		});
		if (found) selected.push(found);
		if (selected.length >= maxCount) break;
	}

	if (selected.length < maxCount) {
		const hasPreferredSemanticDimension = selected.length > 0;
		const hasNonMeasurementFallback = columns.some((column) =>
			!(metric && column === metric) &&
			!isTemporalColumn(column) &&
			!isIdentifierColumn(column) &&
			!/(length|width|height|depth|diameter|radius|mass|weight|petal|sepal|measurement)/i.test(column)
		);
		for (const column of columns) {
			if (selected.includes(column)) continue;
			if (metric && column === metric) continue;
			if (isTemporalColumn(column) || isIdentifierColumn(column)) continue;
			if (hasPreferredSemanticDimension && /(name|title|label)/i.test(column)) continue;
			if (hasNonMeasurementFallback && /(length|width|height|depth|diameter|radius|mass|weight|petal|sepal|measurement)/i.test(column)) continue;
			selected.push(column);
			if (selected.length >= maxCount) break;
		}
	}

	return selected;
}

export function makePresetStages(
	presetId: StagePresetItem['id'],
	input: StagePresetBuildInput
): Exclude<GUIPipelineStage, { type: 'raw' }>[] {
	const dialect = normalizeCoercionDialect(input.dialect);
	const availableColumns = input.availableColumns ?? [];
	const availableColumnProfiles = input.availableColumnProfiles;
	const compositeMetricPlan = findCompositeMetricPlan(input, dialect);
	const metric = compositeMetricPlan?.name ?? pickMetricColumn(availableColumns) ?? pickProfileMetricColumn(input) ?? '';
	const dimension = pickDimensionColumn(availableColumns) ?? pickDimensionFallback(availableColumns, metric || null) ?? '';
	const timestamp = pickTimestampColumn(availableColumns) ?? '';
	const metricProfile = compositeMetricPlan ? null : columnProfileFor(availableColumnProfiles, metric);
	const timestampProfile = columnProfileFor(availableColumnProfiles, timestamp);
	const entityKey = preferColumn(availableColumns, ['id', 'uuid', 'key', '_id']) ?? '';
	const entity = pickEntityColumn(availableColumns) ?? dimension;
	const detail = pickDetailTextColumn(availableColumns) ?? '';
	const { inflow, outflow } = pickInflowOutflowColumns(availableColumns);
	const effectiveMetric = metric || '';
	const secondaryMetric =
		availableColumns.find((column) =>
			column !== effectiveMetric &&
			!isTemporalColumn(column) &&
			!isIdentifierColumn(column) &&
			/(revenue|income|sales|paid|credited|inflow|cost|expense|withdrawn|debited|outflow|amount|balance|value)/i.test(column)
		) ?? '';
	const dimensions = pickDimensionColumns(availableColumns, effectiveMetric || null, 2);
	const primaryDimension = dimensions[0] ?? dimension ?? entity;
	const secondaryDimension = dimensions[1] ?? null;
	const metricToken = safeStageToken(effectiveMetric || 'value');
	const metricRef = effectiveMetric ? quotePrqlIdentifier(effectiveMetric) : '';
	const coercedMetricColumn = !compositeMetricPlan && effectiveMetric ? `${metricToken}_numeric` : '';
	const useCoercedMetric = !compositeMetricPlan && shouldCoerceMetricToNumeric(effectiveMetric, metricProfile);
	const metricAggregationColumn = effectiveMetric
		? compositeMetricPlan
			? compositeMetricPlan.name
			: useCoercedMetric
				? coercedMetricColumn
				: effectiveMetric
		: '';
	const metricCoercionDerive = effectiveMetric && useCoercedMetric
		? [{ name: coercedMetricColumn, expr: { mode: 'sstring' as const, template: buildCoercedMetricSqlExpr(effectiveMetric, dialect) } }]
		: [];
	const compositeMetricDerive = compositeMetricPlan
		? [{ name: compositeMetricPlan.name, expr: { mode: 'sstring' as const, template: compositeMetricPlan.expressionSql } }]
		: [];
	const metricPreparationDerive = [...metricCoercionDerive, ...compositeMetricDerive];
	const absoluteMetricColumn = effectiveMetric ? `${metricToken}_abs` : '';
	const useAbsoluteMetric = !compositeMetricPlan && effectiveMetric ? isOutflowLikeMetric(effectiveMetric, metricProfile) : false;
	const metricAbsDerive = useAbsoluteMetric
		? [{
			name: absoluteMetricColumn,
			expr: {
				mode: 'sstring' as const,
				template: useCoercedMetric
					? `abs(coalesce(${buildCoercedMetricSqlExpr(effectiveMetric, dialect)}, 0))`
					: dialect === 'postgres'
						? `abs(coalesce(cast(${quotedSqlIdentifier(effectiveMetric)} as double precision), 0))`
						: `abs(coalesce(cast(${quotedSqlIdentifier(effectiveMetric)} as double), 0))`
			}
		}]
		: [];
	const metricPreparationWithAbs = [...metricPreparationDerive, ...metricAbsDerive];
	const effectiveAggregationMetricColumn = useAbsoluteMetric ? absoluteMetricColumn : metricAggregationColumn;
	const metricSortColumn = effectiveAggregationMetricColumn || metricAggregationColumn || effectiveMetric;
	const temporalBaseExpr = timestamp ? buildTemporalSqlExpr(timestamp, timestampProfile, dialect) : '';
	const timestampExpr = timestamp && temporalBaseExpr
		? `date_trunc('month', ${temporalBaseExpr})`
		: '';
	const metricAggFunc = (() => {
		if (!effectiveMetric) return 'count' as const;
		const profile = columnProfileFor(availableColumnProfiles, effectiveMetric);
		if (/(amount|revenue|sales|price|cost|balance|currency_amount|unit_price|inflow|outflow)/i.test(effectiveMetric) || /(amount|currency_amount|unit_price|inflow|outflow)/i.test(profile?.semanticType ?? '')) {
			return 'sum' as const;
		}
		if (/(length|width|height|depth|diameter|radius|mass|weight|petal|sepal|score|index|measurement)/i.test(effectiveMetric) || /(metric|ratio|percentage)/i.test(profile?.semanticType ?? '')) {
			return 'average' as const;
		}
		if (/(count|total|num|number)/i.test(effectiveMetric) || /(count)/i.test(profile?.semanticType ?? '')) {
			return 'sum' as const;
		}
		return 'average' as const;
	})();
	const periodKey = timestampExpr ? 'period_month' : (timestamp || '');
	const temporalExtractExpr = (part: 'dow' | 'month'): string => `extract(${part} from ${temporalBaseExpr})`;

	switch (presetId) {
		case 'top-metric':
			return [
				...(metricPreparationWithAbs.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationWithAbs }] : []),
				{ type: 'sort', keys: metricSortColumn ? [{ column: metricSortColumn, dir: 'desc' }] : [] },
				{ type: 'take', n: 25 }
			];
		case 'group-top':
			return [
				...(metricPreparationWithAbs.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationWithAbs }] : []),
				{
					type: 'group',
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: effectiveMetric
						? [{ name: `${metricAggFunc === 'sum' ? 'sum' : 'avg'}_${metricToken}`, func: metricAggFunc, column: effectiveAggregationMetricColumn }]
						: [{ name: 'row_count', func: 'count', column: '' }]
				},
				{ type: 'sort', keys: effectiveMetric ? [{ column: `${metricAggFunc === 'sum' ? 'sum' : 'avg'}_${metricToken}`, dir: 'desc' }] : [{ column: 'row_count', dir: 'desc' }] },
				{ type: 'take', n: 20 }
			];
		case 'dedup-exact': {
			if (availableColumns.length === 0) return [];
			return [
				{
					type: 'group',
					by: [...availableColumns],
					aggregations: [{ name: 'row_count', func: 'count', column: '' }],
					take: 1
				}
			];
		}
		case 'dedup-latest':
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{ type: 'sort', keys: timestamp ? [{ column: timestamp, dir: 'desc' }] : [] },
				{
					type: 'group',
					by: entityKey ? [entityKey] : (primaryDimension ? [primaryDimension] : []),
					aggregations: effectiveMetric
						? [{ name: `latest_${metricToken}`, func: 'first', column: metricAggregationColumn }]
						: []
				}
			];
		case 'temporal-trend':
			const trendCountColumn = timestampExpr ? 'period_month' : (timestamp || effectiveMetric || dimension || '');
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{
					type: 'derive' as const,
					columns: timestampExpr
						? [
								{
									name: 'period_month',
									expr: { mode: 'sstring' as const, template: timestampExpr }
								}
							]
						: []
				},
				{
					type: 'group' as const,
					by: timestampExpr ? ['period_month'] : timestamp ? [timestamp] : [],
					aggregations: [
						...(effectiveMetric
							? [{ name: `total_${metricToken}`, func: 'sum' as const, column: metricAggregationColumn }]
							: []),
						{ name: 'tx_count', func: 'count' as const, column: trendCountColumn }
					]
				},
				{
					type: 'sort' as const,
					keys: [{ column: timestampExpr ? 'period_month' : (timestamp || ''), dir: 'asc' as const }].filter((key): key is { column: string; dir: 'asc' } => !!key.column)
				}
			];
		case 'text-categorize':
			return [
				{
					type: 'derive' as const,
					columns: [
						...(detail
							? [
									{
										name: 'category_bucket',
										expr: {
											mode: 'raw' as const,
											expr: `case [\n\t\t(${quotePrqlIdentifier(detail)} ~= "data|bundle|airtime|subscription|topup") => "digital",\n\t\t(${quotePrqlIdentifier(detail)} ~= "merchant|pos|store|shop|purchase") => "merchant",\n\t\t(${quotePrqlIdentifier(detail)} ~= "transfer|p2p|remit|send") => "transfer",\n\t\t(${quotePrqlIdentifier(detail)} ~= "bill|invoice|utility") => "bill",\n\t\t(${quotePrqlIdentifier(detail)} ~= "refund|reversal|return") => "reversal",\n\t\t(${quotePrqlIdentifier(detail)} ~= "error|fail|declin") => "errors",\n\t\ttrue => "other"\n\t]`
										}
									}
								]
							: []),
						...metricPreparationWithAbs
					]
				},
				{
					type: 'group' as const,
					by: detail ? ['category_bucket'] : (dimension ? [dimension] : []),
					aggregations: [
						...(effectiveMetric
							? [{ name: `total_${metricToken}`, func: 'sum' as const, column: effectiveAggregationMetricColumn }]
							: []),
						{ name: 'tx_count', func: 'count' as const, column: '' }
					]
				},
				{ type: 'sort' as const, keys: [{ column: effectiveMetric ? `total_${metricToken}` : 'tx_count', dir: 'desc' as const }] }
			];
		case 'anomaly-scan':
			return [
				...(metricPreparationWithAbs.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationWithAbs }] : []),
				{
					type: 'derive' as const,
					columns: effectiveMetric
						? [
								{
									name: `abs_${metricToken}`,
									expr: { mode: 'raw' as const, expr: nullSafeNumeric(quotePrqlIdentifier(effectiveAggregationMetricColumn)) }
								}
							]
						: []
				},
				{ type: 'sort' as const, keys: effectiveMetric ? [{ column: `abs_${metricToken}`, dir: 'desc' as const }] : [] },
				{ type: 'take' as const, n: 25 }
			];
		case 'frequency-ranking':
			return [
				{
					type: 'group' as const,
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [{ name: 'tx_count', func: 'count' as const, column: '' }]
				},
				{ type: 'sort' as const, keys: [{ column: 'tx_count', dir: 'desc' as const }] },
				{ type: 'take' as const, n: 30 }
			];
		case 'cashflow-rollup': {
			const hasPairedFlows = Boolean(inflow && outflow && inflow !== outflow);
			if (!hasPairedFlows) {
				return [
					...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
					{
						type: 'group',
						by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
						aggregations: [
							...(effectiveMetric ? [{ name: `sum_${metricToken}`, func: 'sum' as const, column: metricAggregationColumn }] : []),
							{ name: 'tx_count', func: 'count', column: '' }
						]
					},
					{ type: 'sort' as const, keys: [{ column: effectiveMetric ? `sum_${metricToken}` : 'tx_count', dir: 'desc' as const }] },
					{ type: 'take' as const, n: 25 }
				];
			}
			const inflowCol = inflow as string;
			const outflowCol = outflow as string;
			return [
				{
					type: 'derive' as const,
					columns: [
						...(inflowCol
							? [
									{
										name: 'inflow',
										expr: { mode: 'sstring' as const, template: buildNullSafeNumericSqlExpr(inflowCol, dialect) }
									}
								]
							: []),
						...(outflowCol
							? [
									{
										name: 'outflow',
										expr: {
											mode: 'sstring' as const,
											template: `abs(${buildNullSafeNumericSqlExpr(outflowCol, dialect)})`
										}
									}
								]
							: []),
						...(timestampExpr
							? [
									{
										name: 'period_month',
										expr: { mode: 'sstring' as const, template: timestampExpr }
									}
								]
							: [])
					]
				},
				{
					type: 'group' as const,
					by: timestampExpr ? ['period_month'] : (timestamp ? [timestamp] : []),
					aggregations: [
						{ name: 'total_in', func: 'sum' as const, column: 'inflow' },
						{ name: 'total_out', func: 'sum' as const, column: 'outflow' },
						{ name: 'tx_count', func: 'count' as const, column: '' }
					]
				},
				{
					type: 'derive' as const,
					columns: [
						{ name: 'net_flow', expr: { mode: 'raw' as const, expr: 'total_in - total_out' } }
					]
				},
				{
					type: 'sort' as const,
					keys: [{ column: timestampExpr ? 'period_month' : (timestamp || ''), dir: 'asc' as const }].filter((key): key is { column: string; dir: 'asc' } => !!key.column)
				}
			];
		}
		case 'hierarchical-rollup':
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{
					type: 'group' as const,
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [
						...(effectiveMetric ? [{ name: `sum_${metricToken}`, func: 'sum' as const, column: metricAggregationColumn }] : []),
						{ name: 'row_count', func: 'count' as const, column: '' }
					]
				},
				{ type: 'sort' as const, keys: [{ column: effectiveMetric ? `sum_${metricToken}` : 'row_count', dir: 'desc' as const }] },
				{ type: 'take' as const, n: 50 }
			];
		case 'contribution-total':
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{
					type: 'group' as const,
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [
						...(effectiveMetric ? [{ name: `sum_${metricToken}`, func: 'sum' as const, column: metricAggregationColumn }] : []),
						{ name: 'row_count', func: 'count' as const, column: '' }
					]
				},
				{
					type: 'derive' as const,
					columns: effectiveMetric
						? [
								{
									name: `pct_${metricToken}`,
									expr: {
										mode: 'sstring' as const,
										template: `case when sum(sum_${metricToken}) over () = 0 then 0 else 100.0 * sum_${metricToken} / nullif(sum(sum_${metricToken}) over (), 0) end`
									}
								}
							]
						: []
				},
				{ type: 'sort' as const, keys: [{ column: effectiveMetric ? `pct_${metricToken}` : 'row_count', dir: 'desc' as const }] },
				{ type: 'take' as const, n: 30 }
			];
		case 'period-variance':
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{
					type: 'derive' as const,
					columns: timestampExpr
						? [
								{ name: 'period_month', expr: { mode: 'sstring' as const, template: timestampExpr } }
							]
						: []
				},
				{
					type: 'group' as const,
					by: [periodKey, primaryDimension].filter(Boolean) as string[],
					aggregations: [
						...(effectiveMetric ? [{ name: `total_${metricToken}`, func: 'sum' as const, column: metricAggregationColumn }] : []),
						{ name: 'tx_count', func: 'count' as const, column: '' }
					]
				},
				{ type: 'sort' as const, keys: [{ column: periodKey || primaryDimension, dir: 'asc' as const }].filter((key): key is { column: string; dir: 'asc' } => !!key.column) }
			];
		case 'segment-anomaly':
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{
					type: 'group',
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [
						...(effectiveMetric ? [{ name: `sum_${metricToken}`, func: 'sum' as const, column: metricAggregationColumn }] : []),
						...(effectiveMetric ? [{ name: `avg_${metricToken}`, func: 'average' as const, column: metricAggregationColumn }] : []),
						{ name: 'row_count', func: 'count', column: '' }
					]
				},
				{ type: 'sort', keys: [{ column: effectiveMetric ? `sum_${metricToken}` : 'row_count', dir: 'desc' }] },
				{ type: 'take', n: 25 }
			];
		case 'null-hotspots':
			const missingTarget = effectiveMetric || primaryDimension || secondaryDimension || availableColumns[0] || '';
			return [
				{
					type: 'derive',
					columns: missingTarget
						? [
								{
									name: 'is_missing_metric',
									expr: {
										mode: 'raw',
										expr: `case [${quotePrqlIdentifier(missingTarget)} == null => 1, true => 0]`
									}
								}
							]
						: []
				},
				{
					type: 'group',
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [
						{ name: 'row_count', func: 'count', column: '' },
						...(missingTarget
							? [{ name: 'missing_count', func: 'raw' as const, column: '', expr: 'sum is_missing_metric' }]
							: [])
					]
				},
				{ type: 'sort', keys: [{ column: missingTarget ? 'missing_count' : 'row_count', dir: 'desc' }] },
				{ type: 'take', n: 30 }
			];
		case 'duplicate-fingerprint':
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{
					type: 'group',
					by: [entityKey, primaryDimension].filter(Boolean) as string[],
					aggregations: [
						{ name: 'dup_count', func: 'count', column: '' },
						...(effectiveMetric ? [{ name: `sum_${metricToken}`, func: 'sum' as const, column: metricAggregationColumn }] : [])
					]
				},
				{ type: 'sort' as const, keys: [{ column: 'dup_count', dir: 'desc' as const }] },
				{ type: 'take' as const, n: 40 }
			];
		case 'cohort-retention':
			return [
				{
					type: 'derive' as const,
					columns: [
						...(timestampExpr ? [{ name: 'period_month', expr: { mode: 'sstring' as const, template: timestampExpr } }] : []),
						...(entityKey
							? [{ name: 'entity_key', expr: { mode: 'raw' as const, expr: quotePrqlIdentifier(entityKey) } }]
							: [])
					]
				},
				{
					type: 'group' as const,
					by: [periodKey, primaryDimension].filter(Boolean) as string[],
					aggregations: [
						...(entityKey
							? [{ name: 'active_entities', func: 'count_distinct' as const, column: 'entity_key' }]
							: [{ name: 'active_entities', func: 'count' as const, column: '' }]),
						{ name: 'activity_count', func: 'count' as const, column: '' }
					]
				},
				{ type: 'sort' as const, keys: [{ column: periodKey || primaryDimension, dir: 'asc' as const }].filter((key): key is { column: string; dir: 'asc' } => !!key.column) }
			];
		case 'funnel-dropoff':
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{
					type: 'group',
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [
						{ name: 'stage_count', func: 'count', column: '' },
						...(effectiveMetric ? [{ name: `sum_${metricToken}`, func: 'sum' as const, column: metricAggregationColumn }] : [])
					]
				},
				{ type: 'sort', keys: [{ column: 'stage_count', dir: 'desc' }] }
			];
		case 'outlier-explain':
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{
					type: 'derive',
					columns: effectiveMetric
						? [{ name: `abs_${metricToken}`, expr: { mode: 'raw', expr: nullSafeNumeric(quotePrqlIdentifier(metricAggregationColumn)) } }]
						: []
				},
				{ type: 'sort', keys: effectiveMetric ? [{ column: `abs_${metricToken}`, dir: 'desc' }] : [] },
				{ type: 'take', n: 50 }
			];
		case 'seasonal-pattern':
			return [
				...(metricPreparationDerive.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationDerive }] : []),
				{
					type: 'derive',
					columns: timestamp
						? [
								{ name: 'season_weekday', expr: { mode: 'sstring', template: temporalExtractExpr('dow') } },
								{ name: 'season_month', expr: { mode: 'sstring', template: temporalExtractExpr('month') } }
							]
						: []
				},
				{
					type: 'group',
					by: timestamp ? ['season_month', 'season_weekday'] : [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [
						...(effectiveMetric ? [{ name: `avg_${metricToken}`, func: 'average' as const, column: metricAggregationColumn }] : []),
						{ name: 'tx_count', func: 'count', column: '' }
					]
				},
				{
					type: 'sort',
					keys: timestamp
						? [{ column: 'season_month', dir: 'asc' }, { column: 'season_weekday', dir: 'asc' }]
						: [{ column: effectiveMetric ? `avg_${metricToken}` : 'tx_count', dir: 'desc' }]
				}
			];
		case 'efficiency-lens': {
			const revenueLike =
				availableColumns.find((column) => /revenue|income|sales|paid|credited|inflow/i.test(column)) ?? effectiveMetric;
			const costLike =
				availableColumns.find((column) => /cost|expense|withdrawn|debited|outflow|charge/i.test(column)) ?? secondaryMetric;
			return [
				{
					type: 'derive',
					columns: [
						{
							name: 'revenue_value',
							expr: revenueLike
								? { mode: 'sstring', template: buildNullSafeNumericSqlExpr(revenueLike, dialect) }
								: { mode: 'raw', expr: '0' }
						},
						{
							name: 'cost_value',
							expr: costLike
								? { mode: 'sstring', template: buildNullSafeNumericSqlExpr(costLike, dialect) }
								: { mode: 'raw', expr: '0' }
						},
						{
							name: 'efficiency_ratio',
							expr: {
								mode: 'raw',
								expr: 'case [revenue_value == 0 => 0, true => cost_value / revenue_value]'
							}
						}
					]
				},
				{
					type: 'group',
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [
						{ name: 'avg_efficiency_ratio', func: 'average', column: 'efficiency_ratio' },
						{ name: 'row_count', func: 'count', column: '' }
					]
				},
				{ type: 'sort', keys: [{ column: 'avg_efficiency_ratio', dir: 'desc' }] },
				{ type: 'take', n: 30 }
			];
		}
		case 'append-union-stack': {
			const appendSources = ['source_secondary', 'source_archive'];
			return [
				{ type: 'append', sources: appendSources },
				{
					type: 'group',
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [
						...(effectiveMetric ? [{ name: `sum_${metricToken}`, func: 'sum' as const, column: metricAggregationColumn }] : []),
						{ name: 'row_count', func: 'count', column: '' }
					]
				},
				{ type: 'sort', keys: [{ column: effectiveMetric ? `sum_${metricToken}` : 'row_count', dir: 'desc' }] },
				{ type: 'take', n: 30 }
			];
		}
		case 'window-rolling': {
			const windowMetric = metricSortColumn || effectiveMetric;
			const sortColumn = timestamp || windowMetric || primaryDimension;
			return [
				...(metricPreparationWithAbs.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationWithAbs }] : []),
				{ type: 'sort', keys: sortColumn ? [{ column: sortColumn, dir: 'asc' }] : [] },
				{
					type: 'window',
					frame: 'rows:-6..0',
					sortKeys: sortColumn ? [{ column: sortColumn, dir: 'asc' }] : [],
					derives: windowMetric
						? [{ name: `rolling_avg_${metricToken}`, expr: { mode: 'raw', expr: `average ${quotePrqlIdentifier(windowMetric)}` } }]
						: []
				}
			];
		}
		case 'window-lag-delta': {
			const windowMetric = metricSortColumn || effectiveMetric;
			const sortColumn = timestamp || windowMetric || primaryDimension;
			if (!windowMetric) {
				return [
					{ type: 'sort', keys: sortColumn ? [{ column: sortColumn, dir: 'asc' }] : [] },
					{ type: 'window', frame: 'rows:-1..0', sortKeys: sortColumn ? [{ column: sortColumn, dir: 'asc' }] : [], derives: [] }
				];
			}
			return [
				...(metricPreparationWithAbs.length > 0 ? [{ type: 'derive' as const, columns: metricPreparationWithAbs }] : []),
				{ type: 'sort', keys: sortColumn ? [{ column: sortColumn, dir: 'asc' }] : [] },
				{
					type: 'window',
					frame: 'rows:-1..0',
					sortKeys: sortColumn ? [{ column: sortColumn, dir: 'asc' }] : [],
					derives: [
						{
							name: `lag_${metricToken}`,
							expr: {
								mode: 'sstring',
								template: `lag(${quotedSqlIdentifier(windowMetric)}, 1) over (order by ${quotedSqlIdentifier(sortColumn || windowMetric)})`
							}
						},
						{
							name: `delta_${metricToken}`,
							expr: {
								mode: 'sstring',
								template: `${quotedSqlIdentifier(windowMetric)} - lag(${quotedSqlIdentifier(windowMetric)}, 1) over (order by ${quotedSqlIdentifier(sortColumn || windowMetric)})`
							}
						}
					]
				},
				{ type: 'sort', keys: [{ column: `delta_${metricToken}`, dir: 'desc' }] },
				{ type: 'take', n: 25 }
			];
		}
		case 'loop-refine': {
			const loopBody = (() => {
				if (effectiveMetric) {
					const col = quotePrqlIdentifier(effectiveMetric);
					return `filter ${col} != null\nsort {-${col}}\ntake 500`;
				}
				if (primaryDimension) {
					const col = quotePrqlIdentifier(primaryDimension);
					return `filter ${col} != null\ntake 500`;
				}
				return 'filter true\ntake 500';
			})();

			return [
				{ type: 'loop', body: loopBody },
				{ type: 'take', n: 200 }
			];
		}
		case 'drift-monitor':
			return [
				{
					type: 'derive' as const,
					columns: [
						...(timestamp
							? [
									{
										name: 'is_recent_window',
										expr: {
											mode: 'raw' as const,
											expr: `${quotePrqlIdentifier(timestamp)} >= s"current_timestamp - interval '30 day'"`
										}
									},
									{
										name: 'is_baseline_window',
										expr: {
											mode: 'raw' as const,
											expr: `${quotePrqlIdentifier(timestamp)} < s"current_timestamp - interval '30 day'"`
										}
									}
								]
							: [])
					]
				},
				{
					type: 'group',
					by: [primaryDimension, secondaryDimension].filter(Boolean) as string[],
					aggregations: [
						...(timestamp
							? [
									{ name: 'recent_rows', func: 'raw' as const, column: '', expr: 'sum is_recent_window' },
									{ name: 'baseline_rows', func: 'raw' as const, column: '', expr: 'sum is_baseline_window' }
								]
							: [{ name: 'row_count', func: 'count' as const, column: '' }])
					]
				},
				...(timestamp
					? [
						{
							type: 'derive' as const,
							columns: [{ name: 'drift_delta', expr: { mode: 'raw' as const, expr: 'recent_rows - baseline_rows' } }]
						},
						{ type: 'sort' as const, keys: [{ column: 'drift_delta', dir: 'desc' as const }] }
					]
					: [{ type: 'sort' as const, keys: [{ column: 'row_count', dir: 'desc' as const }] }]),
				{ type: 'take', n: 30 }
			];
		default:
			return [];
	}
}

function byType(type: StageType): StageCatalogItem {
	return STAGE_CATALOG.find((item) => item.type === type) ?? STAGE_CATALOG[0];
}

export function makeDefaultStage(type: StageType): GUIPipelineStage {
	switch (type) {
		case 'append':
			return { type: 'append', sources: [] };
		case 'filter':
			return { type: 'filter', conditions: [], logic: 'and' };
		case 'select':
			return { type: 'select', columns: [] };
		case 'derive':
			return { type: 'derive', columns: [] };
		case 'group':
			return { type: 'group', by: [], aggregations: [] };
		case 'window':
			return { type: 'window', frame: 'rows:-2..0', sortKeys: [], derives: [] };
		case 'loop':
			return { type: 'loop', body: 'filter true' };
		case 'sort':
			return { type: 'sort', keys: [] };
		case 'take':
			return { type: 'take', n: 100 };
		case 'join':
			return { type: 'join', joinType: 'inner', table: '', conditions: [] };
		case 'from':
			return { type: 'from', table: '' };
		case 'raw':
			return { type: 'raw', prql: '' };
	}
}

function scoreFromContext(type: StageType, input: StageRecommendationInput): StageRecommendation {
	const reasons: string[] = [];
	let score = 0;
	const { stages, availableColumnCount, recentUsage } = input;
	const last = stages[stages.length - 1];

	if (stages.length === 0 && type === 'from') {
		score += 40;
		reasons.push('start with a source');
	}

	if (stages.length > 0 && type === 'from') {
		score -= 20;
	}

	if (availableColumnCount === 0 && ['append', 'filter', 'select', 'derive', 'group', 'window', 'sort'].includes(type)) {
		score -= 14;
		reasons.push('needs available columns');
	}

	if (last?.type === 'from' && (type === 'append' || type === 'filter' || type === 'select' || type === 'derive')) {
		score += 18;
		reasons.push('common after source');
	}

	if (last?.type === 'filter' && (type === 'select' || type === 'group' || type === 'sort')) {
		score += 12;
		reasons.push('common after filtering');
	}

	if (last?.type === 'group' && (type === 'sort' || type === 'take')) {
		score += 12;
		reasons.push('common after aggregation');
	}

	if (last?.type === 'sort' && type === 'window') {
		score += 8;
		reasons.push('window often follows ordering');
	}

	if (last?.type === 'join' && (type === 'select' || type === 'filter' || type === 'derive')) {
		score += 10;
		reasons.push('common after join');
	}

	if (last?.type === type) {
		score -= 4;
		reasons.push('same as previous stage');
	}

	const usage = recentUsage?.[type] ?? 0;
	if (usage > 0) {
		score += Math.min(usage * 2, 10);
		reasons.push('recently used');
	}

	const item = byType(type);
	if (item.group === 'transform' && stages.length > 0) {
		score += 2;
	}

	return { type, score, reasons };
}

export function recommendStages(input: StageRecommendationInput): StageRecommendation[] {
	return STAGE_CATALOG.map((item) => scoreFromContext(item.type, input)).sort((a, b) => b.score - a.score);
}

export function searchStages(query: string): StageCatalogItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return STAGE_CATALOG;

	return STAGE_CATALOG.filter((item) => {
		return (
			item.label.includes(q) ||
			item.description.toLowerCase().includes(q) ||
			item.keywords.some((k) => k.includes(q))
		);
	});
}

export function searchPresets(query: string): StagePresetItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return STAGE_PRESETS;

	return STAGE_PRESETS.filter((item) => {
		return (
			item.label.toLowerCase().includes(q) ||
			item.description.toLowerCase().includes(q) ||
			item.keywords.some((keyword) => keyword.toLowerCase().includes(q))
		);
	});
}

function normalizeSearchToken(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9_\.]+/g, '');
}

function findBestQueryColumn(query: string, availableColumns: string[]): string | null {
	const q = query.trim().toLowerCase();
	if (!q) return availableColumns[0] ?? null;

	const exact = availableColumns.find((column) => column.toLowerCase() === q);
	if (exact) return exact;

	const contains = availableColumns.find((column) => q.includes(column.toLowerCase()));
	if (contains) return contains;

	const normalizedQ = normalizeSearchToken(q);
	if (!normalizedQ) return availableColumns[0] ?? null;

	return (
		availableColumns.find((column) => normalizeSearchToken(column).includes(normalizedQ)) ??
		availableColumns[0] ??
		null
	);
}

function defaultColumnNameForFunction(option: PrqlFunctionOption, selectedColumn: string | null): string {
	const suffix = option.value.split('.').pop() ?? option.value;
	const stem = (selectedColumn ? humanizeColumnName(selectedColumn) : 'Value').replace(/\s+/g, '_').toLowerCase();
	return `${stem}_${suffix}`.replace(/[^a-z0-9_]/g, '_');
}

function scoreFunctionSuggestion(option: PrqlFunctionOption, query: string): number {
	if (!query.trim()) return 0;
	const q = query.trim().toLowerCase();
	const normalizedQ = normalizeSearchToken(q);
	const tokens = q.split(/[^a-z0-9._-]+/g).map((token) => token.trim()).filter(Boolean);
	const text = [option.value, option.label, option.detail, ...option.keywords].join(' ').toLowerCase();

	let score = 0;
	if (option.value.includes(q) || option.label.toLowerCase().includes(q)) score += 12;
	if (text.includes(q)) score += 8;
	if (normalizeSearchToken(text).includes(normalizedQ)) score += 5;
	if (option.keywords.some((keyword) => keyword.toLowerCase().includes(q))) score += 6;
	if (q.startsWith(option.category)) score += 4;
	for (const token of tokens) {
		if (option.value.includes(token) || option.label.toLowerCase().includes(token)) score += 5;
		if (text.includes(token)) score += 2;
		if (option.keywords.some((keyword) => keyword.toLowerCase().includes(token))) score += 3;
	}
	return score;
}

function looksTemporal(column: string): boolean {
	return /date|time|timestamp|_at\b|month|year|day|period|week|hour|minute/i.test(column);
}

function looksMetric(column: string): boolean {
	if (isIdentifierColumn(column)) return false;
	return /amount|revenue|sales|income|cost|price|balance|value|metric|score|count|qty|quantity|volume|rate|ratio|percent|pct|units?|minutes?|hours?|days?|seconds?|ms|kwh|usd|kg|km|temperature|temp|humidity|pressure|index/i.test(column);
}

function looksDimension(column: string): boolean {
	return !looksTemporal(column) && !looksMetric(column) && !isIdentifierColumn(column) && /category|segment|group|channel|region|country|city|status|type|stage|name|label|class|genre|mood|style|product|customer|merchant|payee|department|plan|industry|priority|mode|carrier|plant|property|issue|diagnosis|account_type|payment_method/i.test(column);
}

function looksMeasureLikeColumn(column: string): boolean {
	if (isIdentifierColumn(column) || isTemporalColumn(column)) return false;
	if (looksMetric(column)) return true;
	if (isRoundWorthyNumericColumn(column) || isCountLikeNumericColumn(column)) return true;
	return /(temperature|temp|humidity|pressure|index|score|pct|percent|ratio|rate|latency|duration|minutes?|seconds?|hours?|kwh|kw|voltage|current|speed|distance|weight|mass|risk)/i.test(column);
}

function preferredAggregationForMetric(column: string): 'sum' | 'avg' {
	if (!column) return 'sum';
	if (/(temperature|temp|humidity|pressure|index|score|pct|percent|ratio|rate|latency|duration|minutes?|seconds?|hours?|risk)/i.test(column)) {
		return 'avg';
	}
	if (/(count|qty|quantity|units?|volume|amount|revenue|sales|income|cost|price|balance|kwh|usd)/i.test(column)) {
		return 'sum';
	}
	return 'avg';
}

function isBooleanOutcomeColumn(column: string, profile?: PresetColumnProfile | null): boolean {
	if (!column) return false;
	if (profile?.dataKind === 'boolean') return true;
	return /(^is_|^has_|\b(returned|return|refund|delivered_on_time|on_time|present|active|enabled|allowed|approved|rejected|passed|failed|escalated|admitted|occupied|fraud|alert|churn)\b)/i.test(column);
}

function preferredAggregationForQueryMetric(column: string, profile?: PresetColumnProfile | null): 'sum' | 'avg' {
	if (isBooleanOutcomeColumn(column, profile)) return 'avg';
	return preferredAggregationForMetric(column);
}

function detectIntentMetricColumn(
	query: string,
	availableColumns: string[],
	profiles?: Partial<Record<string, PresetColumnProfile>>
): string | null {
	const intentPatterns: Array<{ query: RegExp; column: RegExp }> = [
		{ query: /\b(pay|paid|spend|spent|purchase|purchased|bought|cost me)\b/i, column: /(withdrawn|outflow|debit|debited|spent|payment|charge|cost|amount)/i },
		{ query: /\b(return|returns|returned|refund)\b/i, column: /(return|returned|refund)/i },
		{ query: /\b(delivery|deliver(ed)?|on[-\s]?time|late)\b/i, column: /(deliver|delivered|delivered_on_time|on[_\s-]?time|shipping|shipped)/i },
		{ query: /\b(attendance|attending|present|absence|absent)\b/i, column: /(attendance|present|arrival|absent)/i },
		{ query: /\b(resolution|resolved|resolve|resolving|response|respond)\b/i, column: /(resolution|response)/i },
		{ query: /\b(wait|waits|waiting|longest wait|slow|slower|slowest)\b/i, column: /(wait|latency|duration|delay|minutes?)/i },
		{ query: /\b(defect|defects|quality)\b/i, column: /(defect|reject|scrap|failure|quality)/i },
		{ query: /\b(air|pollution|air quality|dirty)\b/i, column: /(air_quality|aqi|pollution|pm2|pm10)/i },
		{ query: /\b(rent|lease)\b/i, column: /(rent|lease|price)/i },
		{ query: /\b(distance|farthest|furthest|far)\b/i, column: /(distance|km|miles?)/i },
		{ query: /\b(churn)\b/i, column: /(churn|attrition|retention)/i },
		{ query: /\b(fraud|fraudulent|chargeback|chargebacks|risk)\b/i, column: /\b(is_)?fraud|chargeback|risk\b/i },
		{ query: /\b(units?|quantity|qty|sold)\b/i, column: /(units?|quantity|qty|sold)/i },
		{ query: /\b(amount|revenue|sales|mrr|arr|cost|price|usd|temperature|humidity)\b/i, column: /(amount|revenue|sales|mrr|arr|cost|price|usd|temperature|humidity)/i }
	];

	for (const intent of intentPatterns) {
		if (!intent.query.test(query)) continue;
		const matched = availableColumns.find((column) => {
			if (isIdentifierColumn(column) || isTemporalColumn(column)) return false;
			return intent.column.test(column);
		});
		if (matched) return matched;
	}

	const profilesFallback = availableColumns.find((column) => {
		const profile = columnProfileFor(profiles, column);
		if (!profile) return false;
		if (isIdentifierColumn(column) || isTemporalColumn(column)) return false;
		return isBooleanOutcomeColumn(column, profile) && new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(query);
	});
	if (profilesFallback) return profilesFallback;

	return null;
}

interface ParsedFilterIntent {
	filterColumn: string;
	filterValue: string;
	displayValue?: string;
	subjectColumn: string | null;
	op: Extract<GUIPipelineStage, { type: 'filter' }>['conditions'][number]['op'];
}

interface ParsedGroupTopIntent {
	groupColumn: string;
	metricColumn: string | null;
	take: number;
}

function resolveBestColumnFromPhrase(phrase: string, availableColumns: string[]): string | null {
	const normalizedPhrase = normalizeSearchToken(phrase);
	if (!normalizedPhrase) return null;
	const genericTokens = new Set(['id', 'name', 'date', 'time', 'at', 'no', 'number', 'code']);

	const scored = availableColumns
		.map((column) => {
			const normalizedColumn = normalizeSearchToken(column);
			const spacedColumn = column.toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
			const spacedPhrase = phrase.toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
			const phraseTokens = spacedPhrase.split(/\s+/g).filter(Boolean);
			const informativeTokens = phraseTokens.filter((token) => token.length >= 2 && !genericTokens.has(token));
			let score = 0;
			if (normalizedColumn === normalizedPhrase) score += 60;
			if (spacedColumn === spacedPhrase) score += 50;
			if (normalizedColumn.includes(normalizedPhrase) || normalizedPhrase.includes(normalizedColumn)) score += 32;
			if (spacedPhrase.includes(spacedColumn) || spacedColumn.includes(spacedPhrase)) score += 24;
			for (const token of phraseTokens) {
				if (token.length < 2) continue;
				if (!spacedColumn.includes(token)) continue;
				if (genericTokens.has(token)) {
					score += 2;
				} else {
					score += 10;
				}
			}
			if (informativeTokens.length > 0) {
				score += informativeTokens.filter((token) => spacedColumn.includes(token)).length * 6;
				const first = informativeTokens[0] ?? '';
				if (first && spacedColumn.startsWith(first)) score += 8;
			}
			return { column, score };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score);

	return scored[0]?.column ?? null;
}

function cleanFilterValue(value: string): string {
	return value
		.trim()
		.replace(/^["'`]+|["'`]+$/g, '')
		.replace(/[\s,.!?;:]+$/g, '');
}

const MONTH_NAME_TO_INDEX: Record<string, string> = {
	january: '01',
	february: '02',
	march: '03',
	april: '04',
	may: '05',
	june: '06',
	july: '07',
	august: '08',
	september: '09',
	october: '10',
	november: '11',
	december: '12'
};

function parseTemporalPhraseFilterIntent(query: string, availableColumns: string[]): ParsedFilterIntent | null {
	const temporalColumn = pickTimestampColumn(availableColumns);
	if (!temporalColumn) return null;

	const monthMatch = query.match(/\b(?:in|during|for)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i)
		?? query.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
	if (!monthMatch) return null;

	const monthName = monthMatch[1]?.toLowerCase() ?? '';
	const monthIndex = MONTH_NAME_TO_INDEX[monthName];
	if (!monthIndex) return null;

	const prefix = query
		.slice(0, monthMatch.index ?? query.length)
		.replace(/\b(?:in|during|for)\s*$/i, '')
		.trim();
	const subjectColumn = /\bwho\b/i.test(prefix)
		? (pickEntityColumn(availableColumns) ?? resolveBestColumnFromPhrase(prefix, availableColumns))
		: (prefix ? resolveBestColumnFromPhrase(prefix, availableColumns) : null);

	return {
		filterColumn: temporalColumn,
		filterValue: `-${monthIndex}-`,
		displayValue: humanizeColumnName(monthName),
		subjectColumn,
		op: 'like'
	};
}

function parseFilterIntent(query: string, availableColumns: string[]): ParsedFilterIntent | null {
	if (!/\bwhere\b/i.test(query)) {
		return parseTemporalPhraseFilterIntent(query, availableColumns);
	}
	const whereMatch = query.match(/^(.*)\bwhere\b\s+(.+)$/i);
	if (!whereMatch) return parseTemporalPhraseFilterIntent(query, availableColumns);

	const prefixPhrase = whereMatch[1]?.trim() ?? '';
	const whereClause = whereMatch[2]?.trim() ?? '';
	if (!whereClause) return null;

	const explicitCondition = whereClause.match(/^(.+?)\s*(==|=|!=|<>|>=|<=|>|<|is|equals?|like|contains)\s+(.+)$/i);
	const implicitCondition = whereClause.match(/^([a-z0-9_\.\s]+)\s+([a-z0-9_\."'`-]+)$/i);
	const leftPhrase = explicitCondition?.[1]?.trim() ?? implicitCondition?.[1]?.trim() ?? null;
	const rawOp = explicitCondition?.[2]?.trim().toLowerCase() ?? 'is';
	const rawValue = explicitCondition?.[3]?.trim() ?? implicitCondition?.[2]?.trim() ?? null;
	if (!leftPhrase || !rawValue) return null;

	const filterColumn = resolveBestColumnFromPhrase(leftPhrase, availableColumns);
	if (!filterColumn) return null;

	const subjectColumn = prefixPhrase ? resolveBestColumnFromPhrase(prefixPhrase, availableColumns) : null;
	const filterValue = cleanFilterValue(rawValue);
	if (!filterValue) return null;

	const op: ParsedFilterIntent['op'] =
		rawOp === '!=' || rawOp === '<>'
			? '!='
			: rawOp === '>'
				? '>'
				: rawOp === '>='
					? '>='
					: rawOp === '<'
						? '<'
						: rawOp === '<='
							? '<='
							: rawOp === 'contains'
								? 'like'
								: '==';

	return {
		filterColumn,
		filterValue,
		subjectColumn,
		op
	};
}

function parseGroupTopIntent(query: string, availableColumns: string[]): ParsedGroupTopIntent | null {
	if (!/\b(top|rank|count|show|most|least|highest|lowest|best|worst|longest|shortest|cheapest|farthest)\b/i.test(query)) return null;

	const groupedPhrase =
		query.match(/\bgroup\s+by\s+(.+?)(?:\s+\b(?:and|with|show|top|rank|where|order|limit)\b|$)/i)?.[1]
		?? query.match(/\bgroup\s+(.+?)(?:\s+\b(?:and|with|show|top|rank|where|order|limit)\b|$)/i)?.[1]
		?? query.match(/\btop(?:\s+\d+)?\s+([a-z0-9_\.\s]+?)\s+\bby\b/i)?.[1]
		?? query.match(/\bwhich\s+([a-z0-9_\.\s]+?)\s+\b(?:has|have|is|are)\b\s+(?:the\s+)?(?:most|least|highest|lowest|best|worst|longest|shortest|cheapest|farthest)\b/i)?.[1]
		?? (/\bwho\s+(?:did\s+)?i\s+(?:pay|paid|spend|spent)\b/i.test(query) ? pickEntityColumn(availableColumns) : null);
	if (!groupedPhrase) return null;

	const groupColumn = resolveBestColumnFromPhrase(groupedPhrase, availableColumns);
	if (!groupColumn) return null;

	const metricPhrase =
		query.match(/\bby\s+([a-z0-9_\.\s]+?)(?:\s+\b(?:where|for|in|per|on|at|order|limit)\b|$)/i)?.[1]
		?? query.match(/\btop(?:\s+\d+)?\s+([a-z0-9_\.\s]+?)(?:\s+\b(?:by|for|where|in|per|on|at)\b|$)/i)?.[1]
		?? query.match(/\bshow\s+top(?:\s+\d+)?\s+([a-z0-9_\.\s]+?)(?:\s+\b(?:by|for|where|in|per|on|at)\b|$)/i)?.[1]
		?? query.match(/\b(?:most|least|highest|lowest|best|worst|longest|shortest|cheapest|farthest)\s+([a-z0-9_\.\s]+?)(?:\s+\b(?:where|for|in|per|on|at)\b|$)/i)?.[1]
		?? null;
	const metricColumn = metricPhrase ? resolveBestColumnFromPhrase(metricPhrase, availableColumns) : null;
	const topN = Number(query.match(/\btop\s+(\d{1,3})\b/i)?.[1] ?? '20');

	return {
		groupColumn,
		metricColumn: metricColumn && metricColumn !== groupColumn ? metricColumn : null,
		take: Number.isFinite(topN) && topN > 0 ? topN : 20
	};
}

function inferSemanticColumnKind(column: string): SemanticDeriveColumn['kind'] {
	if (looksTemporal(column)) return 'date';
	if (looksMetric(column)) return 'numeric';
	if (/^(is_|has_)/i.test(column) || /\b(flag|active|enabled|allowed|present|approved|rejected|passed|failed)\b/i.test(column)) {
		return 'boolean';
	}
	return 'text';
}

function semanticDeriveColumns(columns: string[]): SemanticDeriveColumn[] {
	return columns.map((column) => ({
		name: column,
		kind: inferSemanticColumnKind(column),
		nullRatio: 0,
		distinctCount: 0,
		semanticType: undefined,
		confidence: looksMetric(column) || looksTemporal(column) ? 0.78 : 0.5
	}));
}

function buildSemanticStageLabel(stageType: StageType, columns: string[]): string {
	const [first = '', second = ''] = columns;
	if (stageType === 'derive') {
		if (second) return `Derive from ${humanizeColumnName(first)} and ${humanizeColumnName(second)}`;
		return `Derive from ${humanizeColumnName(first)}`;
	}
	if (stageType === 'group') {
		if (second) return `Group by ${humanizeColumnName(first)} and ${humanizeColumnName(second)}`;
		return `Group by ${humanizeColumnName(first)}`;
	}
	if (stageType === 'sort') return `Sort by ${humanizeColumnName(first)}`;
	if (stageType === 'filter') return `Filter by ${humanizeColumnName(first)}`;
	if (stageType === 'select') return `Select ${columns.length} columns`;
	if (stageType === 'join') return `Join on ${humanizeColumnName(first)}`;
	if (stageType === 'window') return `Window over ${humanizeColumnName(first)}`;
	if (stageType === 'append') return `Append ${humanizeColumnName(first)} sources`;
	if (stageType === 'loop') return `Loop with ${humanizeColumnName(first)}`;
	return `${stageType} with ${humanizeColumnName(first)}`;
}

function buildSemanticStageDescription(stageType: StageType, reasons: string[]): string {
	if (stageType === 'derive') return 'Semantic columns paired into derived expressions.';
	if (stageType === 'group') return 'Semantic dimensions paired with metric or count aggregations.';
	if (stageType === 'filter') return 'Semantic columns turned into focused row filters.';
	if (stageType === 'sort') return 'Semantic columns ranked by their likely ordering signal.';
	if (stageType === 'select') return 'Semantic column sets surfaced as a column subset.';
	if (stageType === 'join') return 'Semantic keys surfaced as a join scaffold.';
	if (stageType === 'window') return 'Semantic time-series candidates surfaced as a window scaffold.';
	if (stageType === 'append') return 'Semantic source stacks surfaced as append scaffolds.';
	if (stageType === 'loop') return 'Iterative refinement scaffolds based on semantic narrowing.';
	return reasons[0] ?? 'Semantic stage fan-out.';
}

function buildSemanticStageSuggestion(input: {
	stageType: StageType;
	columns: string[];
	stage: Exclude<GUIPipelineStage, { type: 'raw' }>;
	reasons: string[];
	score: number;
}): StageSemanticFanoutSuggestion {
	const label = buildSemanticStageLabel(input.stageType, input.columns);
	return {
		id: `${input.stageType}:${input.columns.join('|')}`,
		label,
		description: buildSemanticStageDescription(input.stageType, input.reasons),
		stageType: input.stageType,
		columns: input.columns,
		reasons: input.reasons,
		stage: input.stage,
		score: input.score
	};
}

function buildAnalysisPromptSuggestion(input: {
	label: string;
	prompt: string;
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[];
	reasons: string[];
	score: number;
}): StageAnalysisPromptSuggestion {
	const normalizedStages: Exclude<GUIPipelineStage, { type: 'raw' }>[] = input.stages.map((stage) => {
		if (stage.type !== 'group') return stage;
		if (stage.aggregations.length > 0) return stage;
		if (stage.window && (stage.window.sortKeys.length > 0 || stage.window.derives.length > 0)) {
			return stage;
		}
		return {
			...stage,
			aggregations: [{ name: 'row_count', func: 'count' as const, column: '' }]
		};
	});

	const confidence = Math.max(0.2, Math.min(0.98, input.score / 210));
	return {
		id: normalizeSearchToken(input.prompt),
		label: input.label,
		description: input.reasons[0] ?? input.label,
		prompt: input.prompt,
		stages: normalizedStages,
		reasons: input.reasons,
		score: input.score,
		confidence
	};
}

const ANALYSIS_TOKEN_SYNONYMS: Record<string, string[]> = {
	group: ['group', 'groupby', 'grouping', 'segment', 'breakdown', 'bucket'],
	trend: ['trend', 'timeline', 'timeseries', 'time-series', 'over time', 'trending', 'time'],
	compare: ['compare', 'comparison', 'versus', 'vs', 'against', 'correlation'],
	outlier: ['outlier', 'outliers', 'anomaly', 'anomalies', 'spike', 'spikes', 'weird', 'unusual'],
	rank: ['rank', 'ranking', 'top', 'highest', 'lowest', 'least', 'most', 'best', 'worst', 'longest', 'shortest', 'cheapest', 'expensive', 'farthest', 'leaderboard'],
	revenue: ['revenue', 'rev'],
	amount: ['amount', 'value', 'metric', 'measure'],
	quantity: ['quantity', 'qty', 'volume', 'units'],
	tenant: ['tenant', 'account', 'organization', 'org'],
	customer: ['customer', 'client', 'buyer']
};

function expandAnalysisTokens(tokens: string[]): string[] {
	const expanded = new Set<string>();
	for (const token of tokens) {
		expanded.add(token);
		for (const [canonical, synonyms] of Object.entries(ANALYSIS_TOKEN_SYNONYMS)) {
			if (synonyms.some((synonym) => synonym === token)) {
				expanded.add(canonical);
				synonyms.forEach((synonym) => expanded.add(synonym));
			}
		}
	}
	return [...expanded];
}

function isNearMatchToken(queryToken: string, candidateToken: string): boolean {
	if (queryToken === candidateToken) return true;
	const a = normalizeSearchToken(queryToken);
	const b = normalizeSearchToken(candidateToken);
	if (!a || !b) return false;
	if (a === b) return true;
	if (Math.abs(a.length - b.length) > 1) return false;

	let i = 0;
	let j = 0;
	let edits = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			i += 1;
			j += 1;
			continue;
		}
		edits += 1;
		if (edits > 1) return false;
		if (a.length > b.length) {
			i += 1;
		} else if (b.length > a.length) {
			j += 1;
		} else {
			i += 1;
			j += 1;
		}
	}
	if (i < a.length || j < b.length) edits += 1;
	return edits <= 1;
}

export function searchFunctionActions(input: {
	query: string;
	availableColumns?: string[];
	limit?: number;
}): FunctionSearchSuggestion[] {
	const availableColumns = input.availableColumns ?? [];
	const selectedColumn = findBestQueryColumn(input.query, availableColumns);

	const ranked = PRQL_FUNCTION_REGISTRY
		.map((option) => {
			const args = option.args.map((arg) => {
				if (arg.defaultKind === 'column') {
					return { kind: 'column' as const, value: selectedColumn ?? '' };
				}
				return { kind: 'literal' as const, value: arg.defaultValue ?? '' };
			});

			const canonicalFunc = canonicalizePrqlFunction(option.value);
			const stage: Extract<GUIPipelineStage, { type: 'derive' }> = {
				type: 'derive',
				columns: [
					{
						name: defaultColumnNameForFunction(option, selectedColumn),
						expr: {
							mode: 'func',
							func: canonicalFunc,
							args
						}
					}
				]
			};

			const score = scoreFunctionSuggestion(option, input.query);
			return {
				id: option.value,
				label: `${option.category} ${option.label}`,
				description: option.detail,
				keywords: option.keywords,
				stage,
				category: option.category,
				score
			};
		})
		.filter((entry) => (input.query.trim().length === 0 ? false : entry.score > 0))
		.sort((a, b) => b.score - a.score);

	const limit = Math.max(1, input.limit ?? 12);
	return ranked.slice(0, limit);
}

export function searchSemanticStageCombinations(input: {
	query: string;
	availableColumns?: string[];
	limit?: number;
}): StageSemanticFanoutSuggestion[] {
	const query = input.query.trim().toLowerCase();
	if (!query) return [];

	const availableColumns = input.availableColumns ?? [];
	if (availableColumns.length === 0) return [];

	const matchedStages = searchStages(query)
		.map((item) => item.type)
		.filter((type) => type !== 'from' && type !== 'raw');
	if (matchedStages.length === 0) return [];

	const semanticColumns = semanticDeriveColumns(availableColumns);
	const semanticDeriveCandidates = findSemanticDeriveCandidates(semanticColumns);
	const dimensions = availableColumns.filter((column) => looksDimension(column));
	const metrics = availableColumns.filter((column) => looksMetric(column) || inferSemanticColumnKind(column) === 'numeric');
	const temporal = availableColumns.filter((column) => looksTemporal(column));
	const categories = availableColumns.filter((column) => /status|stage|type|category|segment|group|region|country|city|channel|class|genre|mood|style/i.test(column));

	const suggestions: StageSemanticFanoutSuggestion[] = [];
	const seen = new Set<string>();
	const pushSuggestion = (suggestion: StageSemanticFanoutSuggestion): void => {
		if (seen.has(suggestion.id)) return;
		seen.add(suggestion.id);
		suggestions.push(suggestion);
	};

	if (matchedStages.includes('derive')) {
		for (const candidate of semanticDeriveCandidates) {
			const expression =
				candidate.pattern === 'composed_metric'
					? `${candidate.leftColumn} * ${candidate.rightColumn}`
					: candidate.pattern === 'flow_delta'
						? `${candidate.leftColumn} - ${candidate.rightColumn}`
						: candidate.pattern === 'efficiency_ratio'
							? `${candidate.leftColumn} / ${candidate.rightColumn}`
							: null;
			if (!expression) continue;
			const columns = candidate.rightColumn ? [candidate.leftColumn, candidate.rightColumn] : [candidate.leftColumn];
			const stage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
				type: 'derive',
				columns: [
					{
						name: candidate.outputName,
						expr: {
							mode: 'raw',
							expr: expression
						}
					}
				]
			};
			pushSuggestion(buildSemanticStageSuggestion({
				stageType: 'derive',
				columns,
				stage,
				reasons: [`semantic pair: ${candidate.pattern}`, `quality ${candidate.quality.toFixed(2)}`],
				score: candidate.quality * 100
			}));
		}
	}

	if (matchedStages.includes('group')) {
		for (const dimension of dimensions.slice(0, 6)) {
			const metricCandidates = metrics.length > 0 ? metrics : [''];
			for (const metric of metricCandidates.slice(0, 6)) {
				const stage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
					type: 'group',
					by: [dimension],
					aggregations: metric
						? [{ name: `sum_${metric.replace(/\W+/g, '_')}`, func: 'sum', column: metric }]
						: [{ name: 'row_count', func: 'count', column: '' }]
				};
				pushSuggestion(buildSemanticStageSuggestion({
					stageType: 'group',
					columns: metric ? [dimension, metric] : [dimension],
					stage,
					reasons: metric ? [`dimension ${dimension}`, `metric ${metric}`] : [`dimension ${dimension}`, 'count rows'],
					score: metric ? 82 : 70
				}));
			}
		}
	}

	if (matchedStages.includes('sort')) {
		for (const column of [...temporal, ...metrics, ...categories].slice(0, 8)) {
			const stage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
				type: 'sort',
				keys: [{ column, dir: looksTemporal(column) ? 'desc' : 'asc' }]
			};
			pushSuggestion(buildSemanticStageSuggestion({
				stageType: 'sort',
				columns: [column],
				stage,
				reasons: [looksTemporal(column) ? 'temporal ordering' : 'semantic ranking'],
				score: looksTemporal(column) ? 74 : 62
			}));
		}
	}

	if (matchedStages.includes('filter')) {
		for (const column of [...categories, ...dimensions, ...temporal].slice(0, 8)) {
			const stage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
				type: 'filter',
				conditions: [{ column, op: '==', value: '' }],
				logic: 'and'
			};
			pushSuggestion(buildSemanticStageSuggestion({
				stageType: 'filter',
				columns: [column],
				stage,
				reasons: ['semantic filter target'],
				score: 58
			}));
		}
	}

	return suggestions
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, input.limit ?? 18));
}

export function searchAnalysisPrompts(input: {
	query: string;
	availableColumns?: string[];
	availableColumnProfiles?: Partial<Record<string, PresetColumnProfile>>;
	dialect?: CoercionDialect;
	limit?: number;
}): StageAnalysisPromptSuggestion[] {
	const availableColumns = input.availableColumns ?? [];
	if (availableColumns.length === 0) return [];

	const dialect = normalizeCoercionDialect(input.dialect);
	const query = input.query.trim().toLowerCase();
	const normalizedQuery = normalizeSearchToken(query);
	const rawTokens = query.split(/[^a-z0-9_\.]+/g).map((token) => token.trim()).filter(Boolean);
	const stopTokens = new Set([
		'a', 'an', 'the', 'for', 'to', 'of', 'in', 'on', 'and', 'or', 'with', 'me', 'show', 'find', 'list',
		'from', 'at', 'by', 'about', 'please', 'analysis', 'analyze', 'analyse', 'look', 'into'
	]);
	const normalizeIntentToken = (token: string): string => {
		const lowered = token.toLowerCase();
		if (['groups', 'grouping', 'grouped', 'groupby'].includes(lowered)) return 'group';
		if (['tenants'].includes(lowered)) return 'tenant';
		if (['names'].includes(lowered)) return 'name';
		if (['ranked', 'ranking'].includes(lowered)) return 'rank';
		if (['highest', 'lowest', 'least', 'most', 'best', 'worst', 'longest', 'shortest', 'cheapest', 'expensive', 'farthest'].includes(lowered)) return 'rank';
		if (['trends', 'timeline', 'timeseries', 'time-series', 'becoming', 'recently', 'lately', 'increase', 'increasing', 'rising', 'growing'].includes(lowered)) return 'trend';
		if (['anomalies', 'outliers'].includes(lowered)) return 'outlier';
		if (['spikes'].includes(lowered)) return 'outlier';
		if (['compare', 'comparison', 'versus', 'vs'].includes(lowered)) return 'compare';
		if (['counts', 'counting'].includes(lowered)) return 'count';
		return lowered;
	};
	const tokens = rawTokens
		.filter((token) => !stopTokens.has(token))
		.map((token) => normalizeIntentToken(token));
	const expandedTokens = expandAnalysisTokens(tokens);
	const buildQueryPhrases = (parts: string[], maxGram = 3): string[] => {
		const phrases: string[] = [];
		for (let n = maxGram; n >= 1; n -= 1) {
			for (let i = 0; i <= parts.length - n; i += 1) {
				const phrase = parts.slice(i, i + n).join(' ').trim();
				if (phrase.length >= 3) phrases.push(phrase);
			}
		}
		return [...new Set(phrases)];
	};
	const queryPhrases = buildQueryPhrases(expandedTokens, 3);
	const tokenSet = new Set(tokens);
	const queryTemporalGrain = (() => {
		if (/\b(month|monthly)\b/.test(query)) return 'monthly';
		if (/\b(week|weekly)\b/.test(query)) return 'weekly';
		if (/\b(day|daily)\b/.test(query)) return 'daily';
		if (/\b(year|yearly|annual|annually)\b/.test(query)) return 'yearly';
		if (/\b(quarter|quarterly)\b/.test(query)) return 'quarterly';
		return null;
	})();
	const hasTemporalGranularityIntent = queryTemporalGrain !== null;
	const wantsGroup = tokenSet.has('group') || tokenSet.has('segment') || tokenSet.has('count') || query.includes('group by');
	const wantsTrend = tokenSet.has('trend') || tokenSet.has('time') || tokenSet.has('date') || tokenSet.has('temporal') || hasTemporalGranularityIntent || /\b(becoming|recently|lately|increasing|rising|growing)\b/.test(query);
	const prefersAscendingRank = /\b(least|lowest|cheapest|smallest|minimum|min|shortest)\b/.test(query);
	const prefersDescendingRank = /\b(most|highest|largest|biggest|maximum|max|longest|worst|best|farthest|expensive)\b/.test(query);
	const wantsTop = tokenSet.has('top') || tokenSet.has('rank') || tokenSet.has('leaderboard') || prefersAscendingRank || prefersDescendingRank;
	const wantsOutlier = tokenSet.has('outlier') || tokenSet.has('anomaly');
	const wantsCompare = tokenSet.has('compare') || tokenSet.has('correlation') || query.includes(' vs ');
	const derivePlan = findCompositeMetricPlan({ availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }, dialect);
	const temporal = pickTimestampColumn(availableColumns);
	const metric = pickProfileMetricColumn({ availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect })
		?? pickMetricColumn(availableColumns)
		?? availableColumns.find((column) => looksMetric(column))
		?? null;
	const dimension = pickDimensionColumn(availableColumns)
		?? availableColumns.find((column) => looksDimension(column))
		?? null;

	const prompts: StageAnalysisPromptSuggestion[] = [];
	const push = (suggestion: StageAnalysisPromptSuggestion): void => {
		if (prompts.some((entry) => entry.id === suggestion.id)) return;
		prompts.push(suggestion);
	};

	const matchedColumns = availableColumns
		.map((column) => {
			const lowered = column.toLowerCase();
			const normalized = normalizeSearchToken(column);
			const spaced = lowered.replace(/[_\.]+/g, ' ').replace(/\s+/g, ' ').trim();
			const columnWords = spaced.split(/\s+/g).filter(Boolean);
			let score = 0;

			if (query.length > 0 && lowered.includes(query)) score += 14;
			if (normalizedQuery.length > 0 && normalized.includes(normalizedQuery)) score += 12;
			if (normalizedQuery.length > 0 && normalizedQuery.includes(normalized)) score += 4;
			for (const token of expandedTokens) {
				if (lowered.includes(token)) score += 3;
				if (normalized.includes(normalizeSearchToken(token))) score += 2;
				if (columnWords.some((word) => isNearMatchToken(token, word))) score += 2;
			}
			for (const phrase of queryPhrases) {
				if (spaced.includes(phrase)) score += 9;
				if (normalized.includes(normalizeSearchToken(phrase))) score += 8;
			}
			if (expandedTokens.length > 1 && expandedTokens.every((token) => lowered.includes(token) || columnWords.some((word) => isNearMatchToken(token, word)))) score += 6;
			if (expandedTokens.length > 1 && expandedTokens.some((token) => token === 'group') && expandedTokens.filter((token) => token !== 'group').every((token) => lowered.includes(token) || columnWords.some((word) => isNearMatchToken(token, word)))) {
				score += 8;
			}

			return { column, score };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 5);

	const matchedMetricColumn = matchedColumns
		.map((entry) => entry.column)
		.find((column) => {
			const semantic = columnProfileFor(input.availableColumnProfiles, column)?.semanticType;
			return looksMetric(column) || isNumericSemanticHint(semantic);
		}) ?? null;
	const matchedDimensionColumn = matchedColumns
		.map((entry) => entry.column)
		.find((column) => {
			const semantic = columnProfileFor(input.availableColumnProfiles, column)?.semanticType;
			const semanticCategory = ['category', 'dimension', 'segment', 'status', 'class', 'group'].some((hint) =>
				(semantic ?? '').toLowerCase().includes(hint)
			);
			return looksDimension(column) || semanticCategory;
		}) ?? null;
	const matchedTemporalColumn = matchedColumns
		.map((entry) => entry.column)
		.find((column) => {
			const semantic = columnProfileFor(input.availableColumnProfiles, column)?.semanticType;
			return isTemporalColumn(column) || isTemporalSemanticHint(semantic);
		}) ?? null;
	const intentMetricColumn = detectIntentMetricColumn(query, availableColumns, input.availableColumnProfiles);
	const intentMetricProfile = intentMetricColumn ? columnProfileFor(input.availableColumnProfiles, intentMetricColumn) : null;
	const filterIntent = parseFilterIntent(query, availableColumns);
	const groupTopIntent = parseGroupTopIntent(query, availableColumns);
	const derivedRevenueIntent = /\b(revenue|total|totals|sales|spend|gmv)\b/.test(query) && derivePlan;
	const explicitMetricKeywordIntent = expandedTokens.some((token) => /mrr|arr|revenue|sales|amount|price|cost|value|metric|score|usd|kwh|qty|quantity|units?|hours?|minutes?|temperature|humidity|risk|rate/.test(token));
	const queryEntityCountIntent = /\b(leases?|orders?|tickets?|shipments?|visits?|transactions?|batches?|attendance|sessions?)\b/.test(query);
	const queryMetric = derivedRevenueIntent
		? 'revenue'
		: intentMetricColumn
			?? ((queryEntityCountIntent && !explicitMetricKeywordIntent) ? null : (matchedMetricColumn ?? metric));
	const queryHasMetricIntent =
		expandedTokens.some((token) => /mrr|arr|revenue|sales|total|spend|gmv|amount|price|cost|value|metric|score|usd|kwh|qty|quantity|units?|hours?|minutes?|temperature|humidity|attendance|delivery|returns?|resolution|fraud|risk|lease/.test(token))
		|| !!intentMetricColumn
		|| !!matchedMetricColumn;
	const rankSortDirection: 'asc' | 'desc' = prefersAscendingRank && !prefersDescendingRank ? 'asc' : 'desc';
	let queryIntent = {
		action: wantsGroup ? 'group' : wantsTrend ? 'trend' : wantsCompare ? 'compare' : wantsOutlier ? 'outlier' : wantsTop ? 'rank' : null,
		wantsGroup,
		wantsTrend,
		wantsTop,
		wantsOutlier,
		wantsCompare,
		metricHint: queryMetric,
		dimensionHint: matchedDimensionColumn ?? dimension,
		temporalHint: matchedTemporalColumn ?? temporal
	};
	if (groupTopIntent) {
		queryIntent = {
			...queryIntent,
			wantsGroup: true,
			wantsTop: true,
			dimensionHint: groupTopIntent.groupColumn,
			metricHint: groupTopIntent.metricColumn ?? queryIntent.metricHint
		};
	}
	const explicitDimensionIntent = /\b(by|per|for each|group(?:\s+by)?)\b/.test(query);
	if (queryIntent.wantsTrend && !explicitDimensionIntent && !groupTopIntent) {
		queryIntent = {
			...queryIntent,
			dimensionHint: null
		};
	}
	const matchedCategoricalColumns = matchedColumns
		.map((entry) => entry.column)
		.filter((column) => {
			const semantic = columnProfileFor(input.availableColumnProfiles, column)?.semanticType;
			const semanticCategory = ['category', 'dimension', 'segment', 'status', 'class', 'group'].some((hint) =>
				(semantic ?? '').toLowerCase().includes(hint)
			);
			const temporalLike = isTemporalColumn(column) || isTemporalSemanticHint(semantic);
			const measureLike = looksMeasureLikeColumn(column) || isNumericSemanticHint(semantic);
			const textLikeDimension = looksDimension(column) || semanticCategory || isLikelyTextColumn(column);
			return !temporalLike && !measureLike && textLikeDimension;
		});
	const dualDimensionIntent = !queryHasMetricIntent && matchedCategoricalColumns.length >= 2;
	const focusDimensions = dualDimensionIntent ? matchedCategoricalColumns.slice(0, 2) : [];
	const hasMixedMeasureDimensionIntent = !dualDimensionIntent && !!matchedMetricColumn && !!matchedDimensionColumn;
	const focusCandidateColumns = matchedColumns.slice(0, 4);
	const classifyPairKind = (column: string): 'temporal' | 'metric' | 'dimension' => {
		const semantic = columnProfileFor(input.availableColumnProfiles, column)?.semanticType;
		if (isTemporalColumn(column) || isTemporalSemanticHint(semantic)) return 'temporal';
		if (looksMeasureLikeColumn(column) || isNumericSemanticHint(semantic)) return 'metric';
		return 'dimension';
	};
	const classifyPairType = (
		kinds: Array<'temporal' | 'metric' | 'dimension'>
	): 'temporal-temporal' | 'metric-metric' | 'metric-dimension' | 'dimension-dimension' | 'mixed' => {
		if (kinds.every((kind) => kind === 'temporal')) return 'temporal-temporal';
		if (kinds.every((kind) => kind === 'metric')) return 'metric-metric';
		if (kinds.includes('metric') && kinds.includes('dimension')) return 'metric-dimension';
		if (kinds.every((kind) => kind === 'dimension')) return 'dimension-dimension';
		return 'mixed';
	};
	const focusPairCandidates: Array<{
		columns: [string, string];
		kinds: ['temporal' | 'metric' | 'dimension', 'temporal' | 'metric' | 'dimension'];
		type: 'temporal-temporal' | 'metric-metric' | 'metric-dimension' | 'dimension-dimension' | 'mixed';
		score: number;
	}> = [];
	for (let i = 0; i < focusCandidateColumns.length; i += 1) {
		for (let j = i + 1; j < focusCandidateColumns.length; j += 1) {
			const left = focusCandidateColumns[i];
			const right = focusCandidateColumns[j];
			const kinds: ['temporal' | 'metric' | 'dimension', 'temporal' | 'metric' | 'dimension'] = [
				classifyPairKind(left.column),
				classifyPairKind(right.column)
			];
			focusPairCandidates.push({
				columns: [left.column, right.column],
				kinds,
				type: classifyPairType(kinds),
				score: left.score + right.score
			});
		}
	}
	focusPairCandidates.sort((a, b) => b.score - a.score);
	const primaryPair = focusPairCandidates[0] ?? null;
	const focusPairColumns = primaryPair?.columns ?? [];
	const focusPairType = primaryPair?.type ?? null;

	if (filterIntent) {
		const filterValueText = filterIntent.displayValue ?? filterIntent.filterValue;
		const filterConditionValue = filterIntent.op === 'like' ? `%${filterIntent.filterValue}%` : filterIntent.filterValue;
		const filterReason = `${filterIntent.filterColumn} matched your where-clause intent`;
		const filterPromptText = `${humanizeColumnName(filterIntent.filterColumn)} ${filterIntent.op === '!=' ? 'is not' : 'is'} ${filterValueText}`;
		const safeLabel = filterPromptText.replace(/\s+/g, ' ').trim();
		const filterSummaryMetric = queryHasMetricIntent && queryIntent.metricHint && queryIntent.metricHint !== filterIntent.filterColumn
			? queryIntent.metricHint
			: null;
		const filterSummaryDimension = filterIntent.subjectColumn && filterIntent.subjectColumn !== filterIntent.filterColumn
			? filterIntent.subjectColumn
			: matchedDimensionColumn
				&& matchedDimensionColumn !== filterIntent.filterColumn
				&& matchedDimensionColumn !== temporal
				? matchedDimensionColumn
			: null;
		push(buildAnalysisPromptSuggestion({
			label: `Rows where ${humanizeColumnName(filterIntent.filterColumn)} ${filterIntent.op === '!=' ? 'is not' : 'is'} ${filterValueText}`,
			prompt: `Rows where ${humanizeColumnName(filterIntent.filterColumn)} ${filterIntent.op === '!=' ? 'is not' : 'is'} ${filterValueText}: filter ${filterIntent.filterColumn}`,
			reasons: [filterReason, 'explicit where-clause intent'],
			stages: [
				{
					type: 'filter',
					conditions: [{ column: filterIntent.filterColumn, op: filterIntent.op, value: filterConditionValue }],
					logic: 'and'
				}
			],
			score: 190
		}));

		if (filterSummaryMetric) {
			const metricProfile = columnProfileFor(input.availableColumnProfiles, filterSummaryMetric) ?? intentMetricProfile;
			const metricAgg = preferredAggregationForQueryMetric(filterSummaryMetric, metricProfile);
			const metricSlug = filterSummaryMetric.replace(/\W+/g, '_');
			const metricAggName = `${metricAgg}_${metricSlug}`;
			const summaryBy = [
				...(hasTemporalGranularityIntent && temporal && temporal !== filterIntent.filterColumn ? [temporal] : []),
				...(filterSummaryDimension ? [filterSummaryDimension] : [])
			];

			if (summaryBy.length > 0) {
				const groupLabel = summaryBy.map((column) => humanizeColumnName(column)).join(' by ');
				const grainPrefix = queryTemporalGrain ? `${queryTemporalGrain} ` : '';
				const summarySortColumn = queryIntent.wantsTop ? metricAggName : summaryBy[0];
				push(buildAnalysisPromptSuggestion({
					label: `${humanizeColumnName(filterSummaryMetric)} by ${groupLabel} with ${safeLabel}`,
					prompt: `${humanizeColumnName(filterSummaryMetric)} by ${groupLabel} with ${safeLabel}: ${metricAgg} ${filterSummaryMetric} by ${grainPrefix}${summaryBy.join(' and ')}`,
					reasons: [filterReason, `${filterSummaryMetric} matched the metric intent after filtering`],
					stages: [
						{
							type: 'filter',
							conditions: [{ column: filterIntent.filterColumn, op: filterIntent.op, value: filterConditionValue }],
							logic: 'and'
						},
						{
							type: 'group',
							by: summaryBy,
							aggregations: [{ name: metricAggName, func: metricAgg, column: filterSummaryMetric }]
						},
						{ type: 'sort', keys: [{ column: summarySortColumn, dir: queryIntent.wantsTop ? rankSortDirection : 'asc' }] },
						...(queryIntent.wantsTop ? [{ type: 'take' as const, n: groupTopIntent?.take ?? 15 }] : [])
					],
					score: 212
				}));
			}
		}

		if (filterIntent.subjectColumn && filterIntent.subjectColumn !== filterIntent.filterColumn) {
			push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(filterIntent.subjectColumn)} where ${humanizeColumnName(filterIntent.filterColumn)} ${filterIntent.op === '!=' ? 'is not' : 'is'} ${filterValueText}`,
				prompt: `${humanizeColumnName(filterIntent.subjectColumn)} where ${humanizeColumnName(filterIntent.filterColumn)} ${filterIntent.op === '!=' ? 'is not' : 'is'} ${filterValueText}: count rows by ${filterIntent.subjectColumn}`,
				reasons: [filterReason, `${filterIntent.subjectColumn} matched the subject phrase before where`],
				stages: [
					{
						type: 'filter',
						conditions: [{ column: filterIntent.filterColumn, op: filterIntent.op, value: filterConditionValue }],
						logic: 'and'
					},
					{
						type: 'group',
						by: [filterIntent.subjectColumn],
						aggregations: [{ name: 'row_count', func: 'count', column: '' }]
					},
					{ type: 'sort', keys: [{ column: 'row_count', dir: 'desc' }] }
				],
				score: 200
			}));
		}

		if (groupTopIntent && groupTopIntent.groupColumn !== filterIntent.filterColumn) {
			const topMetric = groupTopIntent.metricColumn ?? queryIntent.metricHint ?? null;
			const topMetricProfile = topMetric ? columnProfileFor(input.availableColumnProfiles, topMetric) : null;
			const topAgg: 'sum' | 'average' = topMetric
				? (preferredAggregationForQueryMetric(topMetric, topMetricProfile) === 'avg' ? 'average' : 'sum')
				: 'sum';
			const topMetricSlug = topMetric ? topMetric.replace(/\W+/g, '_') : 'rows';
			const topAggName = topMetric ? `${topAgg === 'average' ? 'avg' : 'sum'}_${topMetricSlug}` : 'row_count';

			push(buildAnalysisPromptSuggestion({
				label: `Top ${groupTopIntent.take} ${humanizeColumnName(groupTopIntent.groupColumn)} by ${topMetric ? humanizeColumnName(topMetric) : 'row count'} with ${safeLabel}`,
				prompt: `Top ${groupTopIntent.take} ${humanizeColumnName(groupTopIntent.groupColumn)} by ${topMetric ? humanizeColumnName(topMetric) : 'row count'} with ${safeLabel}: filter then rank`,
				reasons: [filterReason, 'explicit top-N intent after filtering'],
				stages: [
					{
						type: 'filter',
						conditions: [{ column: filterIntent.filterColumn, op: filterIntent.op, value: filterConditionValue }],
						logic: 'and'
					},
					{
						type: 'group',
						by: [groupTopIntent.groupColumn],
						aggregations: topMetric
							? [{ name: topAggName, func: topAgg, column: topMetric }]
							: [{ name: 'row_count', func: 'count', column: '' }]
					},
					{ type: 'sort', keys: [{ column: topAggName, dir: 'desc' }] },
					{ type: 'take', n: groupTopIntent.take }
				],
				score: 230
			}));
		}

		if (queryIntent.dimensionHint && queryIntent.dimensionHint !== filterIntent.filterColumn) {
			const dimension = queryIntent.dimensionHint;
			push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(dimension)} with ${safeLabel}`,
				prompt: `${humanizeColumnName(dimension)} with ${safeLabel}: group by ${dimension} after filtering`,
				reasons: [filterReason, `dimension ${dimension} can be summarized after filtering`],
				stages: [
					{
						type: 'filter',
						conditions: [{ column: filterIntent.filterColumn, op: filterIntent.op, value: filterConditionValue }],
						logic: 'and'
					},
					{
						type: 'group',
						by: [dimension],
						aggregations: [{ name: 'row_count', func: 'count', column: '' }]
					},
					{ type: 'sort', keys: [{ column: 'row_count', dir: 'desc' }] }
				],
				score: 186
			}));
		}
	}

	if (groupTopIntent) {
		const metricColumn = groupTopIntent.metricColumn ?? queryIntent.metricHint ?? null;
		const metricProfile = metricColumn ? columnProfileFor(input.availableColumnProfiles, metricColumn) : null;
		const agg: 'sum' | 'average' = metricColumn
			? (preferredAggregationForQueryMetric(metricColumn, metricProfile) === 'avg' ? 'average' : 'sum')
			: 'sum';
		const metricSlug = metricColumn ? metricColumn.replace(/\W+/g, '_') : 'rows';
		const aggName = metricColumn ? `${agg === 'average' ? 'avg' : 'sum'}_${metricSlug}` : 'row_count';
		const derivedTotalIntent =
			!groupTopIntent.metricColumn &&
			!!derivePlan &&
			/\b(total|revenue|sales|spend)\b/i.test(query);

		if (derivedTotalIntent && derivePlan) {
			push(buildAnalysisPromptSuggestion({
				label: `Top ${humanizeColumnName(groupTopIntent.groupColumn)} by Revenue`,
				prompt: `Top ${humanizeColumnName(groupTopIntent.groupColumn)} by Revenue: derive ${derivePlan.priceColumn} * ${derivePlan.quantityColumn}`,
				reasons: ['explicit top-total intent inferred a composed revenue metric'],
				stages: [
					{
						type: 'derive',
						columns: [{ name: derivePlan.name, expr: { mode: 'sstring', template: derivePlan.expressionSql } }]
					},
					{
						type: 'group',
						by: [groupTopIntent.groupColumn],
						aggregations: [{ name: 'sum_revenue', func: 'sum', column: derivePlan.name }]
					},
					{ type: 'sort', keys: [{ column: 'sum_revenue', dir: 'desc' }] },
					{ type: 'take', n: groupTopIntent.take }
				],
				score: 216
			}));
		}

		push(buildAnalysisPromptSuggestion({
			label: `Top ${humanizeColumnName(groupTopIntent.groupColumn)} by ${metricColumn ? humanizeColumnName(metricColumn) : 'row count'}`,
			prompt: `Top ${humanizeColumnName(groupTopIntent.groupColumn)} by ${metricColumn ? humanizeColumnName(metricColumn) : 'row count'}: group by ${groupTopIntent.groupColumn}`,
			reasons: ['explicit group and top intent detected in prompt'],
			stages: [
				{
					type: 'group',
					by: [groupTopIntent.groupColumn],
					aggregations: metricColumn
						? [{ name: aggName, func: agg, column: metricColumn }]
						: [{ name: 'row_count', func: 'count', column: '' }]
				},
				{ type: 'sort', keys: [{ column: aggName, dir: rankSortDirection }] },
				{ type: 'take', n: groupTopIntent.take }
			],
			score: 214
		}));
	}

	if (temporal && hasTemporalGranularityIntent) {
		const temporalMetric = queryMetric && queryMetric !== temporal ? queryMetric : null;
		const grainSqlMap: Record<string, string> = { monthly: 'month', weekly: 'week', daily: 'day', yearly: 'year', quarterly: 'quarter' };
		const grainSql = queryTemporalGrain ? (grainSqlMap[queryTemporalGrain] ?? 'month') : 'month';
		const periodKey = `period_${grainSql}`;
		const temporalColProfile = columnProfileFor(input.availableColumnProfiles, temporal);
		const temporalBaseExpr = buildTemporalSqlExpr(temporal, temporalColProfile, dialect);
		const truncExpr = temporalBaseExpr ? `date_trunc('${grainSql}', ${temporalBaseExpr})` : '';
		const groupByColumn = truncExpr ? periodKey : temporal;
		const deriveStage: Exclude<GUIPipelineStage, { type: 'raw' }>[] = truncExpr
			? [{ type: 'derive', columns: [{ name: periodKey, expr: { mode: 'sstring' as const, template: truncExpr } }] }]
			: [];

		if (temporalMetric) {
			const metricProfile = columnProfileFor(input.availableColumnProfiles, temporalMetric) ?? intentMetricProfile;
			const metricAgg = preferredAggregationForQueryMetric(temporalMetric, metricProfile);
			const grainPrefix = queryTemporalGrain ? `${queryTemporalGrain} ` : '';
			const metricSlug = temporalMetric.replace(/\W+/g, '_');
			push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(temporalMetric)} ${queryTemporalGrain ?? ''} trend`.trim(),
				prompt: `${humanizeColumnName(temporalMetric)} trend: ${metricAgg} ${temporalMetric} by ${grainPrefix}${temporal}`,
				reasons: ['temporal-granularity intent with matched metric column'],
				stages: [
					...deriveStage,
					{
						type: 'group',
						by: [groupByColumn],
						aggregations: [{ name: `${metricAgg}_${metricSlug}`, func: metricAgg, column: temporalMetric }]
					},
					{ type: 'sort', keys: [{ column: groupByColumn, dir: 'asc' }] }
				],
				score: 178
			}));

			// When the query has an explicit "by <dimension>" pattern, also generate a 2D prompt
			// that groups by both the dimension and the temporal bucket
			if (explicitDimensionIntent && queryIntent.dimensionHint && queryIntent.dimensionHint !== temporal) {
				const dimHint = queryIntent.dimensionHint;
				push(buildAnalysisPromptSuggestion({
					label: `${humanizeColumnName(temporalMetric)} by ${humanizeColumnName(dimHint)} ${queryTemporalGrain ?? 'monthly'} trend`.trim(),
					prompt: `${humanizeColumnName(temporalMetric)} ${grainPrefix}trend by ${dimHint}: ${metricAgg} ${temporalMetric} by ${dimHint} and ${grainPrefix}${temporal}`,
					reasons: ['temporal-granularity and explicit dimension intent in query'],
					stages: [
						...deriveStage,
						{
							type: 'group',
							by: [dimHint, groupByColumn],
							aggregations: [{ name: `${metricAgg}_${metricSlug}`, func: metricAgg, column: temporalMetric }]
						},
						{ type: 'sort', keys: [{ column: groupByColumn, dir: 'asc' }] }
					],
					score: 188
				}));
			}
		}

		if (queryEntityCountIntent || !temporalMetric) {
			push(buildAnalysisPromptSuggestion({
				label: `${queryTemporalGrain ?? 'temporal'} activity trend`,
				prompt: `${queryTemporalGrain ?? 'temporal'} activity trend: count rows by ${temporal}`,
				reasons: ['temporal-granularity intent with entity/count framing'],
				stages: [
					...deriveStage,
					{ type: 'group', by: [groupByColumn], aggregations: [{ name: 'row_count', func: 'count', column: '' }] },
					{ type: 'sort', keys: [{ column: groupByColumn, dir: 'asc' }] }
				],
				score: 174
			}));
		}
	}

	if (temporal && queryIntent.wantsTrend && !hasTemporalGranularityIntent) {
		const temporalMetric = queryMetric && queryMetric !== temporal
			? queryMetric
			: (intentMetricColumn && intentMetricColumn !== temporal ? intentMetricColumn : null);
		const trendTemporalColProfile = columnProfileFor(input.availableColumnProfiles, temporal);
		const trendTemporalBaseExpr = buildTemporalSqlExpr(temporal, trendTemporalColProfile, dialect);
		const trendTruncExpr = trendTemporalBaseExpr ? `date_trunc('month', ${trendTemporalBaseExpr})` : '';
		const trendGroupByColumn = trendTruncExpr ? 'period_month' : temporal;
		const trendDeriveStage: Exclude<GUIPipelineStage, { type: 'raw' }>[] = trendTruncExpr
			? [{ type: 'derive', columns: [{ name: 'period_month', expr: { mode: 'sstring' as const, template: trendTruncExpr } }] }]
			: [];

		if (temporalMetric) {
			const metricProfile = columnProfileFor(input.availableColumnProfiles, temporalMetric) ?? intentMetricProfile;
			const metricAgg = preferredAggregationForQueryMetric(temporalMetric, metricProfile);
			const metricSlug = temporalMetric.replace(/\W+/g, '_');
			push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(temporalMetric)} trend over time`,
				prompt: `${humanizeColumnName(temporalMetric)} trend over time: ${metricAgg} ${temporalMetric} by ${temporal}`,
				reasons: ['explicit over-time trend intent with matched temporal and metric columns'],
				stages: [
					...trendDeriveStage,
					{
						type: 'group',
						by: [trendGroupByColumn],
						aggregations: [{ name: `${metricAgg}_${metricSlug}`, func: metricAgg, column: temporalMetric }]
					},
					{ type: 'sort', keys: [{ column: trendGroupByColumn, dir: 'asc' }] }
				],
				score: 206
			}));
		}

		push(buildAnalysisPromptSuggestion({
			label: 'Activity trend over time',
			prompt: `Activity trend over time: count rows by ${temporal}`,
			reasons: ['explicit over-time trend intent without explicit grain'],
			stages: [
				...trendDeriveStage,
				{ type: 'group', by: [trendGroupByColumn], aggregations: [{ name: 'row_count', func: 'count', column: '' }] },
				{ type: 'sort', keys: [{ column: trendGroupByColumn, dir: 'asc' }] }
			],
			score: 188
		}));
	}

	if (intentMetricColumn && matchedDimensionColumn && !hasTemporalGranularityIntent) {
		const metricLooksMonetary = /(price|cost|rent|fee|amount|usd|revenue|sales|spend)/i.test(intentMetricColumn);
		const agg = (prefersAscendingRank && metricLooksMonetary)
			? 'avg'
			: preferredAggregationForQueryMetric(intentMetricColumn, intentMetricProfile);
		const metricSlug = intentMetricColumn.replace(/\W+/g, '_');
		push(buildAnalysisPromptSuggestion({
			label: `${humanizeColumnName(intentMetricColumn)} by ${humanizeColumnName(matchedDimensionColumn)}`,
			prompt: `${humanizeColumnName(intentMetricColumn)} by ${humanizeColumnName(matchedDimensionColumn)}: ${agg} ${intentMetricColumn} by ${matchedDimensionColumn}`,
			reasons: ['query intent phrase mapped to domain-specific metric column'],
			stages: [
				{
					type: 'group',
					by: [matchedDimensionColumn],
					aggregations: [{ name: `${agg}_${metricSlug}`, func: agg, column: intentMetricColumn }]
				},
				{ type: 'sort', keys: [{ column: `${agg}_${metricSlug}`, dir: rankSortDirection }] },
				{ type: 'take', n: 15 }
			],
			score: 172
		}));
	}

	if (queryIntent.wantsOutlier && queryMetric) {
		push(buildAnalysisPromptSuggestion({
			label: `Outlier scan for ${humanizeColumnName(queryMetric)}`,
			prompt: `Outlier scan for ${humanizeColumnName(queryMetric)}: inspect unusually high or low ${queryMetric} values`,
			reasons: ['explicit outlier intent with matched metric column'],
			stages: makePresetStages('anomaly-scan', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
			score: 208
		}));
	}

	for (const match of matchedColumns) {
		const column = match.column;
		const semantic = columnProfileFor(input.availableColumnProfiles, column)?.semanticType;
		const looksSemanticCategory = ['category', 'dimension', 'segment', 'status', 'class', 'group'].some((hint) =>
			(semantic ?? '').toLowerCase().includes(hint)
		);
		const looksTemporal = isTemporalColumn(column) || isTemporalSemanticHint(semantic);
		const looksNumeric = looksMetric(column) || isNumericSemanticHint(semantic);
		const looksCategorical = looksDimension(column) || looksSemanticCategory || (!looksTemporal && !looksNumeric);

		if (looksCategorical) {
			const scorePenaltyForMetricQuery = queryHasMetricIntent ? 18 : 0;
			const scorePenaltyForMixedMeasureIntent = hasMixedMeasureDimensionIntent ? 12 : 0;
			const scorePenaltyForTrendQuery = queryIntent.wantsTrend ? 24 : 0;
			push(buildAnalysisPromptSuggestion({
				label: `Group by ${humanizeColumnName(column)}`,
				prompt: `Group by ${humanizeColumnName(column)}: count rows per ${column}`,
				reasons: [`${column} matched your query and supports grouped analysis`],
				stages: [
					{
						type: 'group',
						by: [column],
						aggregations: [{ name: 'row_count', func: 'count', column: '' }]
					},
					{ type: 'sort', keys: [{ column: 'row_count', dir: 'desc' }] }
				],
				score: 102 + match.score + (queryIntent.wantsGroup ? 10 : 0) - scorePenaltyForMetricQuery - scorePenaltyForMixedMeasureIntent - scorePenaltyForTrendQuery
			}));

			push(buildAnalysisPromptSuggestion({
				label: `Value counts for ${humanizeColumnName(column)}`,
				prompt: `Value counts for ${humanizeColumnName(column)}: group by ${column} and count rows`,
				reasons: [`${column} matched your query and behaves like a grouping dimension`],
				stages: [
					{
						type: 'group',
						by: [column],
						aggregations: [{ name: 'row_count', func: 'count', column: '' }]
					},
					{ type: 'sort', keys: [{ column: 'row_count', dir: 'desc' }] },
					{ type: 'take', n: 15 }
				],
				score: 98 + match.score + (queryIntent.wantsGroup ? 8 : 0) - scorePenaltyForMetricQuery - scorePenaltyForMixedMeasureIntent - scorePenaltyForTrendQuery
			}));

			if (queryMetric && queryMetric !== column) {
				const metricSlug = queryMetric.replace(/\W+/g, '_');
				const metricAgg = preferredAggregationForMetric(queryMetric);
				push(buildAnalysisPromptSuggestion({
					label: `${humanizeColumnName(queryMetric)} by ${humanizeColumnName(column)}`,
					prompt: `${humanizeColumnName(queryMetric)} by ${humanizeColumnName(column)}: ${metricAgg} ${queryMetric} by ${column}`,
					reasons: [`${column} matched your query and can segment ${queryMetric}`],
					stages: [
						{
							type: 'group',
							by: [column],
							aggregations: [{ name: `${metricAgg}_${metricSlug}`, func: metricAgg, column: queryMetric }]
						},
						{ type: 'sort', keys: [{ column: `${metricAgg}_${metricSlug}`, dir: 'desc' }] },
						{ type: 'take', n: 15 }
					],
					score: 94 + match.score + (queryIntent.wantsGroup ? 6 : 0) + (queryIntent.wantsTop ? 4 : 0) + (queryHasMetricIntent ? 10 : 0) + (hasMixedMeasureDimensionIntent ? 10 : 0)
				}));
			}
		}

		if (looksNumeric) {
			push(buildAnalysisPromptSuggestion({
				label: `Outlier scan for ${humanizeColumnName(column)}`,
				prompt: `Outlier scan for ${humanizeColumnName(column)}: inspect unusually high or low values`,
				reasons: [`${column} matched your query and behaves like a numeric metric`],
				stages: makePresetStages('anomaly-scan', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
				score: 90 + match.score + (queryIntent.wantsOutlier ? 8 : 0)
			}));

			if (temporal && temporal !== column) {
				const metricAgg = preferredAggregationForMetric(column);
				const grainPrefix = queryTemporalGrain ? `${queryTemporalGrain} ` : '';
				push(buildAnalysisPromptSuggestion({
					label: `${queryTemporalGrain ? `${humanizeColumnName(column)} ${queryTemporalGrain} trend` : `${humanizeColumnName(column)} trend`}`,
					prompt: `${humanizeColumnName(column)} trend: ${metricAgg} ${column} by ${grainPrefix}${temporal}`,
					reasons: [`${column} matched your query and can be trended by ${temporal}`],
					stages: [
						{
							type: 'group',
							by: [temporal],
							aggregations: [{ name: `${metricAgg}_${column.replace(/\W+/g, '_')}`, func: metricAgg, column }]
						},
						{ type: 'sort', keys: [{ column: temporal, dir: 'asc' }] }
					],
					score: 92 + match.score + (queryIntent.wantsTrend ? 8 : 0)
				}));
			}
		}

		if (looksTemporal) {
			push(buildAnalysisPromptSuggestion({
				label: `Trend over ${humanizeColumnName(column)}`,
				prompt: `Trend over ${humanizeColumnName(column)}: aggregate ${metric ?? 'rows'} by ${column}`,
				reasons: [`${column} matched your query and behaves like a temporal axis`],
				stages: makePresetStages('temporal-trend', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
				score: 91 + match.score + (queryIntent.wantsTrend ? 10 : 0)
			}));
		}
	}

	if (focusDimensions.length === 2) {
		const [firstDimension, secondDimension] = focusDimensions;
		push(buildAnalysisPromptSuggestion({
			label: `${humanizeColumnName(firstDimension)} by ${humanizeColumnName(secondDimension)}`,
			prompt: `${humanizeColumnName(firstDimension)} by ${humanizeColumnName(secondDimension)}: count rows by ${firstDimension} and ${secondDimension}`,
			reasons: [`query mentions ${firstDimension} and ${secondDimension}`, 'two categorical dimensions suggest a cross-breakdown'],
			stages: [
				{
					type: 'group',
					by: [firstDimension, secondDimension],
					aggregations: [{ name: 'row_count', func: 'count', column: '' }]
				},
				{ type: 'sort', keys: [{ column: 'row_count', dir: 'desc' }] },
				{ type: 'take', n: 20 }
			],
			score: 160
		}));
	}

	for (const [pairIndex, pairCandidate] of focusPairCandidates.slice(0, 3).entries()) {
		const [pairA, pairB] = pairCandidate.columns;
		const pairKinds = pairCandidate.kinds;
		const pairScoreOffset = Math.max(0, 8 - pairIndex * 3);
		if (pairCandidate.type === 'temporal-temporal') {
			const pairGapDays = `days_between_${pairB.replace(/\W+/g, '_')}_and_${pairA.replace(/\W+/g, '_')}`;
			const pairAProfile = columnProfileFor(input.availableColumnProfiles, pairA);
			const pairBProfile = columnProfileFor(input.availableColumnProfiles, pairB);
			const pairGapDaysExpr = buildTemporalGapDaysSql(pairA, pairB, pairAProfile, pairBProfile, dialect);
			push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(pairB)} vs ${humanizeColumnName(pairA)}`,
				prompt: `Temporal relation: average days between ${pairA} and ${pairB}`,
				reasons: ['paired temporal columns are best analyzed as a relationship'],
				stages: [
					{
						type: 'derive',
						columns: [{ name: pairGapDays, expr: { mode: 'sstring', template: pairGapDaysExpr } }]
					},
					{
						type: 'group',
						by: [],
						aggregations: [{ name: `avg_${pairGapDays}`, func: 'avg', column: pairGapDays }]
					}
				],
				score: 166 + pairScoreOffset
			}));
		}

		if (pairCandidate.type === 'metric-dimension') {
			const metricColumn = pairKinds[0] === 'metric' ? pairA : pairB;
			const dimensionColumn = metricColumn === pairA ? pairB : pairA;
			const agg = preferredAggregationForMetric(metricColumn);
			const metricSlug = metricColumn.replace(/\W+/g, '_');
			push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(metricColumn)} by ${humanizeColumnName(dimensionColumn)}`,
				prompt: `${humanizeColumnName(metricColumn)} by ${humanizeColumnName(dimensionColumn)}: ${agg} ${metricColumn} by ${dimensionColumn}`,
				reasons: ['paired measure and dimension map to grouped aggregation'],
				stages: [
					{
						type: 'group',
						by: [dimensionColumn],
						aggregations: [{ name: `${agg}_${metricSlug}`, func: agg, column: metricColumn }]
					},
					{ type: 'sort', keys: [{ column: `${agg}_${metricSlug}`, dir: 'desc' }] },
					{ type: 'take', n: 15 }
				],
				score: 164 + pairScoreOffset
			}));
		}

		if (pairCandidate.type === 'metric-metric') {
			push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(pairA)} vs ${humanizeColumnName(pairB)}`,
				prompt: `Correlation check: compare ${pairA} and ${pairB}`,
				reasons: ['paired numeric signals suggest direct comparison'],
				stages: makePresetStages('segment-anomaly', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
				score: 162 + pairScoreOffset
			}));
		}

		if (pairCandidate.type === 'dimension-dimension' && !queryHasMetricIntent) {
			push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(pairA)} by ${humanizeColumnName(pairB)}`,
				prompt: `${humanizeColumnName(pairA)} by ${humanizeColumnName(pairB)}: count rows by ${pairA} and ${pairB}`,
				reasons: ['paired categorical columns suggest a cross-breakdown'],
				stages: [
					{ type: 'group', by: [pairA, pairB], aggregations: [{ name: 'row_count', func: 'count', column: '' }] },
					{ type: 'sort', keys: [{ column: 'row_count', dir: 'desc' }] }
				],
				score: 160 + pairScoreOffset
			}));
		}
	}

	if (derivePlan) {
		const derivedRevenueStages = makePresetStages('group-top', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect });
		push(buildAnalysisPromptSuggestion({
			label: 'Revenue analysis',
			prompt: `Revenue analysis: derive ${derivePlan.priceColumn} * ${derivePlan.quantityColumn}`,
			reasons: ['price and quantity columns support a composed revenue metric'],
			stages: derivedRevenueStages,
			score: 124
		}));

		if (dimension) {
			push(buildAnalysisPromptSuggestion({
				label: `Revenue by ${humanizeColumnName(dimension)}`,
				prompt: `Revenue by ${humanizeColumnName(dimension)}: aggregate derived revenue by ${dimension}`,
				reasons: [`${dimension} is the strongest business dimension for a revenue breakdown`],
				stages: derivedRevenueStages,
				score: 118
			}));
		}

		if (temporal) {
			push(buildAnalysisPromptSuggestion({
				label: 'Daily revenue trend',
				prompt: `Daily revenue trend: aggregate derived revenue by ${temporal}`,
				reasons: [`${temporal} supports a time-series revenue rollup`],
				stages: makePresetStages('temporal-trend', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
				score: 116
			}));
		}
	}

	if (metric && dimension) {
		push(buildAnalysisPromptSuggestion({
			label: 'Top contributors',
			prompt: `Top contributors: rank ${dimension} by ${metric}`,
			reasons: [`${dimension} and ${metric} support a ranked breakdown`],
			stages: makePresetStages('group-top', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
			score: 84
		}));

		if (queryIntent.wantsOutlier) {
			push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(metric)} outliers by ${humanizeColumnName(dimension)}`,
				prompt: `${humanizeColumnName(metric)} outliers by ${humanizeColumnName(dimension)}: inspect anomalous ${metric} across ${dimension}`,
				reasons: ['outlier intent with both metric and segment context'],
				stages: makePresetStages('segment-anomaly', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
				score: 220
			}));
		}
	}

	if (metric) {
		push(buildAnalysisPromptSuggestion({
			label: 'Outlier scan',
			prompt: `Outlier scan: check ${metric} beyond IQR bounds`,
			reasons: [`${metric} is a numeric measure worth inspecting for outliers`],
			stages: makePresetStages('anomaly-scan', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
			score: 78
		}));
	}

	if (metric && temporal) {
		const grainPrefix = queryTemporalGrain ? `${queryTemporalGrain} ` : '';
		push(buildAnalysisPromptSuggestion({
			label: queryTemporalGrain ? `${queryTemporalGrain} trend over time` : 'Trend over time',
			prompt: `Trend over time: aggregate ${metric} by ${grainPrefix}${temporal}`,
			reasons: [`${metric} and ${temporal} support a trend analysis`],
			stages: makePresetStages('temporal-trend', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
			score: 80 + (hasTemporalGranularityIntent ? 8 : 0)
		}));
	}

	if (metric && tokens.length > 1) {
		const numericCandidates = availableColumns.filter((column) => looksMeasureLikeColumn(column));
		const left = numericCandidates.find((column) => tokens.some((token) => column.toLowerCase().includes(token)))
			?? (numericCandidates.includes(metric) ? metric : numericCandidates[0]);
		const right = numericCandidates.find((column) => column !== left);
		if (left && right) {
		push(buildAnalysisPromptSuggestion({
			label: 'Correlation check',
			prompt: `Correlation check: compare ${left} and ${right}`,
			reasons: ['multiple numeric signals can be compared directly'],
			stages: makePresetStages('segment-anomaly', { availableColumns, availableColumnProfiles: input.availableColumnProfiles, dialect }),
			score: 72 + (queryIntent.wantsCompare ? 10 : 0)
		}));
		}
	}

	if (prompts.length === 0) {
		const fallbackStage = makeDefaultStage('select') as Exclude<GUIPipelineStage, { type: 'raw' }>;
		push(buildAnalysisPromptSuggestion({
			label: 'Inspect value counts',
			prompt: `Inspect value counts for ${availableColumns[0]}`,
			reasons: ['fallback prompt for categorical inspection'],
			stages: [fallbackStage],
			score: 40
		}));
	}

	const queryBoost = (prompt: StageAnalysisPromptSuggestion): number => {
		if (expandedTokens.length === 0) return 0;
		const text = `${prompt.label} ${prompt.prompt} ${prompt.reasons.join(' ')}`.toLowerCase();
		let score = 0;
		const hasFilterStage = prompt.stages.some((stage) => stage.type === 'filter');
		const wantsRate = /\brate\b/.test(query);
		for (const token of expandedTokens) {
			if (text.includes(token)) score += 4;
			if (normalizeSearchToken(text).includes(normalizeSearchToken(token))) score += 2;
		}
		if (filterIntent) {
			const filterColumnLower = filterIntent.filterColumn.toLowerCase();
			const filterValueLower = filterIntent.filterValue.toLowerCase();
			if (hasFilterStage) score += 34;
			if (!hasFilterStage) score -= 26;
			if (text.includes(filterColumnLower)) score += 14;
			if (text.includes(filterValueLower)) score += 10;
			if (filterIntent.subjectColumn && text.includes(filterIntent.subjectColumn.toLowerCase())) score += 8;
		}
		if (query.includes('revenue') && /revenue/i.test(prompt.prompt)) score += 6;
		if (query.includes('category') && /category/i.test(prompt.prompt)) score += 5;
		if (query.includes('date') && /trend|time|daily|temporal/i.test(prompt.prompt)) score += 4;
		if (queryIntent.wantsGroup && /group by|value counts|contributors/i.test(prompt.prompt)) score += 8;
		if (queryIntent.wantsTrend && /trend|time|daily|temporal/i.test(prompt.prompt)) score += 8;
		if (queryIntent.wantsTrend && /trend|time|daily|temporal/i.test(prompt.label)) score += 10;
		if (queryIntent.wantsTrend && !/trend|time|daily|weekly|monthly|quarterly|yearly|temporal/.test(text)) score -= 36;
		if (queryIntent.wantsTrend && /group by|value counts|top contributors/.test(text) && !/trend|time|daily|weekly|monthly|quarterly|yearly|temporal/.test(text)) score -= 16;
		if (queryIntent.wantsTrend && queryIntent.temporalHint && !text.includes(queryIntent.temporalHint.toLowerCase())) score -= 20;
		if (queryIntent.wantsTrend && /top contributors|rank/i.test(prompt.label)) score -= 8;
		if (hasTemporalGranularityIntent && /trend|time|daily|weekly|monthly|quarterly|yearly|temporal/i.test(prompt.prompt)) score += 10;
		if (hasTemporalGranularityIntent && queryTemporalGrain && (prompt.label.toLowerCase().includes(queryTemporalGrain) || prompt.prompt.toLowerCase().includes(queryTemporalGrain))) score += 12;
		if (hasTemporalGranularityIntent && /outlier|correlation|top contributors/i.test(prompt.label)) score -= 20;
		if (hasTemporalGranularityIntent && temporal && !text.includes(temporal.toLowerCase()) && !/trend|time|monthly|weekly|daily|yearly|quarterly/.test(text)) score -= 18;
		if (intentMetricColumn && text.includes(intentMetricColumn.toLowerCase())) score += 14;
		if (intentMetricColumn && !text.includes(intentMetricColumn.toLowerCase()) && !/count rows/.test(text)) score -= 10;
		if (queryIntent.wantsTop && /top|rank|contributors|sort/i.test(prompt.prompt)) score += 6;
		if (queryIntent.wantsTop && /least|lowest|cheapest|minimum|min/.test(query) && /\basc\b|low|small|minimum/.test(text)) score += 6;
		if (queryIntent.wantsOutlier && /outlier|anomaly|iqr/i.test(prompt.prompt)) score += 7;
		if (queryIntent.wantsOutlier && !/outlier|anomaly|iqr|spike/.test(text)) score -= 16;
		if (queryIntent.wantsCompare && /correlation|compare|versus/i.test(prompt.prompt)) score += 6;
		if (wantsRate && /count rows|row count|value counts/i.test(prompt.prompt)) score -= 28;
		if (wantsRate && queryMetric && text.includes(queryMetric.toLowerCase())) score += 14;
		if (wantsRate && hasFilterStage && /avg|average|rate/i.test(text)) score += 10;
		if (prompt.stages.some((stage) => stage.type === 'group') && queryIntent.wantsGroup) score += 4;
		if (queryMetric && prompt.prompt.toLowerCase().includes(queryMetric.toLowerCase())) score += 12;
		if (queryMetric && queryHasMetricIntent && !prompt.prompt.toLowerCase().includes(queryMetric.toLowerCase()) && /count rows|value counts/i.test(prompt.prompt)) score -= 10;
		if (matchedColumns.some((entry) => prompt.prompt.toLowerCase().includes(entry.column.toLowerCase()))) score += 8;
		if (queryIntent.dimensionHint && prompt.prompt.toLowerCase().includes(queryIntent.dimensionHint.toLowerCase())) score += 6;
		if (queryIntent.temporalHint && /trend|time|daily|temporal/i.test(prompt.prompt) && prompt.prompt.toLowerCase().includes(queryIntent.temporalHint.toLowerCase())) score += 6;
		if (focusDimensions.length > 0) {
			const missingFocusCount = focusDimensions.filter((column) => !text.includes(column.toLowerCase())).length;
			if (missingFocusCount === 0) score += 14;
			if (missingFocusCount === 1) score -= 3;
			if (missingFocusCount >= 2) score -= 14;
		}
		if (focusCandidateColumns.length >= 3) {
			const focusColumns = focusCandidateColumns.map((entry) => entry.column);
			const matchedFocusCount = focusColumns.filter((column) => text.includes(column.toLowerCase())).length;
			if (matchedFocusCount >= 3) score += 12;
			if (matchedFocusCount === 2) score += 5;
			if (matchedFocusCount <= 1) score -= 8;
		} else if (focusPairColumns.length === 2) {
			const missingPairCount = focusPairColumns.filter((column) => !text.includes(column.toLowerCase())).length;
			if (missingPairCount === 0) score += 12;
			if (missingPairCount === 1) score -= 2;
			if (missingPairCount >= 2) score -= 10;
		}
		if (focusPairType === 'temporal-temporal' && /trend over .*aggregate rows by/i.test(prompt.prompt.toLowerCase())) score -= 9;
		if (dualDimensionIntent && /count rows by/i.test(prompt.prompt)) score += 8;
		if (dualDimensionIntent && /top contributors|outlier|trend over time|correlation check/i.test(prompt.label)) score -= 8;
		if (query.includes('duplicate') && /outlier|inspect|count|value/i.test(prompt.prompt)) score += 2;

		// Penalize when the query has "by <dim>" intent but the dimension token doesn't resolve to any
		// available column — the fast planner can't address it, so confidence should fall below the
		// LLM bypass threshold and let the LLM handle the unresolved reference instead
		if (hasTemporalGranularityIntent && explicitDimensionIntent) {
			const intentSynonymValues = new Set(Object.values(ANALYSIS_TOKEN_SYNONYMS).flat());
			const unresolvableCount = rawTokens.filter((t) => {
				if (stopTokens.has(t)) return false;
				if (/^(month|monthly|week|weekly|day|daily|year|yearly|quarter|quarterly)$/.test(t)) return false;
				if (/^(sales|revenue|amount|cost|price|mrr|arr|usd|count|sum|total|avg|average|rate|spend|value|metric|score)$/.test(t)) return false;
				if (intentSynonymValues.has(t)) return false;
				if (t.length < 4) return false;
				return !availableColumns.some((col) =>
					col.toLowerCase().includes(t) ||
					normalizeSearchToken(col).includes(normalizeSearchToken(t))
				);
			}).length;
			if (unresolvableCount > 0) score -= unresolvableCount * 75;
		}

		return score;
	};

	const classifyPrompt = (prompt: StageAnalysisPromptSuggestion): string => {
		const text = `${prompt.label} ${prompt.prompt}`.toLowerCase();
		if (/\bwhere\b|\bfilter\b/.test(text) || prompt.stages.some((stage) => stage.type === 'filter')) return 'filter';
		if (/outlier|anomaly|iqr/.test(text)) return 'outlier';
		if (/correlation|compare|versus/.test(text)) return 'compare';
		if (/trend|time|daily|temporal/.test(text)) return 'trend';
		if (/top|rank|contributors|leader/.test(text)) return 'rank';
		if (/group by|value counts|aggregate .* by/.test(text)) return 'group';
		return 'other';
	};

	const requiredColumns = [
		...(hasTemporalGranularityIntent ? [] : (focusPairColumns.length === 2 ? focusPairColumns : [])),
		...(hasTemporalGranularityIntent && queryIntent.temporalHint ? [queryIntent.temporalHint] : []),
		...(hasTemporalGranularityIntent && intentMetricColumn ? [intentMetricColumn] : []),
		...(focusDimensions.length > 0 ? focusDimensions : []),
		...(queryIntent.dimensionHint ? [queryIntent.dimensionHint] : []),
		...(queryHasMetricIntent && queryIntent.metricHint ? [queryIntent.metricHint] : [])
	].filter((value, index, array) => value && array.indexOf(value) === index);

	let ranked = prompts
		.map((prompt) => {
			const text = `${prompt.label} ${prompt.prompt}`.toLowerCase();
			const missingRequired = requiredColumns.filter((column) => !text.includes(column.toLowerCase())).length;
			const finalScore = prompt.score + queryBoost(prompt) - missingRequired * 4;
			const confidence = Math.max(0.2, Math.min(0.98, finalScore / 210));
			return { ...prompt, score: finalScore, confidence, missingRequired };
		})
		.sort((a, b) => (a.missingRequired - b.missingRequired) || (b.score - a.score));

	if (hasTemporalGranularityIntent) {
		const temporalPrompts = ranked.filter((prompt) => /trend|time|monthly|weekly|daily|yearly|quarterly|temporal/.test(`${prompt.label} ${prompt.prompt}`.toLowerCase()));
		const nonTemporalPrompts = ranked.filter((prompt) => !/trend|time|monthly|weekly|daily|yearly|quarterly|temporal/.test(`${prompt.label} ${prompt.prompt}`.toLowerCase()));
		ranked = [...temporalPrompts, ...nonTemporalPrompts];
	}

	if (queryIntent.metricHint && queryHasMetricIntent && !queryIntent.wantsTrend) {
		const metricLower = queryIntent.metricHint.toLowerCase();
		const metricPrompts = ranked.filter((prompt) => `${prompt.label} ${prompt.prompt}`.toLowerCase().includes(metricLower));
		const nonMetricPrompts = ranked.filter((prompt) => !`${prompt.label} ${prompt.prompt}`.toLowerCase().includes(metricLower));
		const topMetric = metricPrompts.slice(0, 3);
		ranked = [...topMetric, ...metricPrompts.slice(3), ...nonMetricPrompts];
	}

	if (filterIntent) {
		const filterPrompts = ranked.filter((prompt) => prompt.stages.some((stage) => stage.type === 'filter'));
		const nonFilterPrompts = ranked.filter((prompt) => !prompt.stages.some((stage) => stage.type === 'filter'));
		const prioritizedFilterPrompts = filterPrompts.sort((a, b) => {
			const aText = `${a.label} ${a.prompt}`.toLowerCase();
			const bText = `${b.label} ${b.prompt}`.toLowerCase();
			const aSubject = filterIntent.subjectColumn && aText.includes(filterIntent.subjectColumn.toLowerCase()) ? 1 : 0;
			const bSubject = filterIntent.subjectColumn && bText.includes(filterIntent.subjectColumn.toLowerCase()) ? 1 : 0;
			if (aSubject !== bSubject) return bSubject - aSubject;
			return b.score - a.score;
		});
		if (prioritizedFilterPrompts.length > 0) {
			ranked = [...prioritizedFilterPrompts, ...nonFilterPrompts];
		}
	}

	const limit = Math.max(1, input.limit ?? 8);
	const diversityTarget = Math.min(limit, 5);
	const selected: StageAnalysisPromptSuggestion[] = [];
	const usedIds = new Set<string>();
	const usedArchetypes = new Set<string>();
	for (const prompt of ranked) {
		if (selected.length >= diversityTarget) break;
		const archetype = classifyPrompt(prompt);
		if (usedArchetypes.has(archetype)) continue;
		selected.push(prompt);
		usedIds.add(prompt.id);
		usedArchetypes.add(archetype);
	}
	for (const prompt of ranked) {
		if (selected.length >= limit) break;
		if (usedIds.has(prompt.id)) continue;
		selected.push(prompt);
		usedIds.add(prompt.id);
	}

	if (selected.length === 0 || (selected[0]?.confidence ?? 0) < 0.50) {
		const fallbackDimension = focusDimensions[0] ?? queryIntent.dimensionHint ?? matchedColumns[0]?.column ?? availableColumns[0];
		const fallbackMetric = queryHasMetricIntent ? (queryIntent.metricHint ?? matchedMetricColumn ?? null) : null;
		const conservative: StageAnalysisPromptSuggestion[] = [];
		if (fallbackDimension) {
			conservative.push(buildAnalysisPromptSuggestion({
				label: `Group by ${humanizeColumnName(fallbackDimension)}`,
				prompt: `Group by ${humanizeColumnName(fallbackDimension)}: count rows per ${fallbackDimension}`,
				reasons: ['low-confidence fallback', `dimension ${fallbackDimension}`],
				stages: [{ type: 'group', by: [fallbackDimension], aggregations: [{ name: 'row_count', func: 'count', column: '' }] }],
				score: 62
			}));
		}
		if (fallbackDimension && fallbackMetric && fallbackMetric !== fallbackDimension) {
			const metricSlug = fallbackMetric.replace(/\W+/g, '_');
			conservative.push(buildAnalysisPromptSuggestion({
				label: `${humanizeColumnName(fallbackMetric)} by ${humanizeColumnName(fallbackDimension)}`,
				prompt: `${humanizeColumnName(fallbackMetric)} by ${humanizeColumnName(fallbackDimension)}: aggregate ${fallbackMetric} by ${fallbackDimension}`,
				reasons: ['low-confidence fallback', `metric ${fallbackMetric}`],
				stages: [{ type: 'group', by: [fallbackDimension], aggregations: [{ name: `sum_${metricSlug}`, func: 'sum', column: fallbackMetric }] }],
				score: 60
			}));
		}
		if (conservative.length > 0) return conservative.slice(0, limit);
	}

	return selected.map((prompt) => ({
		...prompt,
		confidence: Math.max(0.2, Math.min(0.98, prompt.confidence ?? (prompt.score / 210)))
	}));
}

function isCompileResolutionIssue(reason: string): boolean {
	return /Unknown\s+(name|table|relation|column|field|variable|identifier)|cannot\s+resolve|not\s+found/i.test(reason);
}

function chooseClosestColumnName(column: string, availableColumns: string[]): string | null {
	if (!column) return null;
	const exact = availableColumns.find((candidate) => candidate.toLowerCase() === column.toLowerCase());
	if (exact) return exact;

	const normalizedColumn = normalizeSearchToken(column);
	if (!normalizedColumn) return null;

	const normalizedExact = availableColumns.find(
		(candidate) => normalizeSearchToken(candidate) === normalizedColumn
	);
	if (normalizedExact) return normalizedExact;

	const normalizedContains = availableColumns.find((candidate) => {
		const normalized = normalizeSearchToken(candidate);
		return normalized.includes(normalizedColumn) || normalizedColumn.includes(normalized);
	});
	if (normalizedContains) return normalizedContains;

	const near = availableColumns.find((candidate) => isNearMatchToken(column, candidate));
	if (near) return near;

	return null;
}

function repairDeriveExprColumns(
	expr: Extract<GUIPipelineStage, { type: 'derive' | 'window' }>,
	availableColumns: string[],
	repairState: { repaired: boolean; issues: string[] }
): void {
	if (expr.type !== 'derive' && expr.type !== 'window') return;
	const deriveColumns = expr.type === 'derive' ? expr.columns : expr.derives;
	for (const deriveColumn of deriveColumns) {
		const deriveExpr = deriveColumn.expr;
		if (deriveExpr.mode === 'binary') {
			if (deriveExpr.left.kind === 'column') {
				const repaired = chooseClosestColumnName(deriveExpr.left.value, availableColumns);
				if (repaired && repaired !== deriveExpr.left.value) {
					repairState.repaired = true;
					deriveExpr.left.value = repaired;
				}
			}
			if (deriveExpr.right.kind === 'column') {
				const repaired = chooseClosestColumnName(deriveExpr.right.value, availableColumns);
				if (repaired && repaired !== deriveExpr.right.value) {
					repairState.repaired = true;
					deriveExpr.right.value = repaired;
				}
			}
		}

		if (deriveExpr.mode === 'func') {
			for (const arg of deriveExpr.args) {
				if (arg.kind !== 'column') continue;
				const repaired = chooseClosestColumnName(arg.value, availableColumns);
				if (repaired && repaired !== arg.value) {
					repairState.repaired = true;
					arg.value = repaired;
				}
			}
		}
	}
}

function repairPromptStages(
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[],
	availableColumns: string[]
): {
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[];
	repaired: boolean;
	issues: string[];
} {
	const clone = JSON.parse(JSON.stringify(stages)) as Exclude<GUIPipelineStage, { type: 'raw' }>[];
	const repairState = { repaired: false, issues: [] as string[] };
	let currentAvailableColumns = [...availableColumns];

	for (const stage of clone) {
		switch (stage.type) {
			case 'filter': {
				stage.conditions = stage.conditions
					.map((condition) => {
						const repaired = chooseClosestColumnName(condition.column, currentAvailableColumns);
						if (!repaired) {
							repairState.issues.push(`unknown filter column: ${condition.column}`);
							return null;
						}
						if (repaired !== condition.column) {
							repairState.repaired = true;
						}
						return { ...condition, column: repaired };
					})
					.filter((condition): condition is NonNullable<typeof condition> => condition !== null);
				break;
			}

			case 'select': {
				stage.columns = stage.columns
					.map((column) => chooseClosestColumnName(column, currentAvailableColumns))
					.filter((column): column is string => !!column);
				if (stage.columns.length > 0) currentAvailableColumns = [...stage.columns];
				break;
			}

			case 'derive': {
				repairDeriveExprColumns(stage, currentAvailableColumns, repairState);
				currentAvailableColumns = [
					...currentAvailableColumns,
					...stage.columns.map((column) => column.name).filter(Boolean)
				];
				break;
			}

			case 'group': {
				stage.by = stage.by
					.map((column) => chooseClosestColumnName(column, currentAvailableColumns))
					.filter((column): column is string => !!column);

				stage.aggregations = stage.aggregations
					.map((aggregation) => {
						const normalizedFunc = aggregation.func === 'avg' ? 'average' : aggregation.func;
						if (!aggregation.column || aggregation.func === 'count' || aggregation.func === 'raw') {
							return {
								...aggregation,
								func: normalizedFunc
							};
						}
						const repaired = chooseClosestColumnName(aggregation.column, currentAvailableColumns);
						if (!repaired) {
							repairState.issues.push(`unknown aggregation column: ${aggregation.column}`);
							return null;
						}
						if (repaired !== aggregation.column) {
							repairState.repaired = true;
						}
						return {
							...aggregation,
							func: normalizedFunc,
							column: repaired
						};
					})
					.filter((aggregation): aggregation is NonNullable<typeof aggregation> => aggregation !== null);

				if (stage.aggregations.length === 0 && (!stage.window || (stage.window.sortKeys.length === 0 && stage.window.derives.length === 0))) {
					stage.aggregations = [{ name: 'row_count', func: 'count', column: '' }];
					repairState.repaired = true;
					repairState.issues.push('inferred row_count aggregation for empty group stage');
				}
				if (stage.window) {
					currentAvailableColumns = [
						...stage.by,
						...stage.window.derives.map((derive) => derive.name).filter(Boolean)
					];
				} else {
					currentAvailableColumns = [
						...stage.by,
						...stage.aggregations.map((aggregation) => aggregation.name).filter(Boolean)
					];
				}
				break;
			}

			case 'sort': {
				stage.keys = stage.keys
					.map((key) => {
						const repaired = chooseClosestColumnName(key.column, currentAvailableColumns);
						if (!repaired) {
							repairState.issues.push(`unknown sort column: ${key.column}`);
							return null;
						}
						if (repaired !== key.column) {
							repairState.repaired = true;
						}
						return { ...key, column: repaired };
					})
					.filter((key): key is NonNullable<typeof key> => key !== null);
				break;
			}

			case 'join': {
				stage.conditions = stage.conditions
					.map((condition) => {
						const left = chooseClosestColumnName(condition.left, currentAvailableColumns);
						const right = chooseClosestColumnName(condition.right, currentAvailableColumns);
						if (!left || !right) {
							repairState.issues.push(`unknown join condition: ${condition.left} == ${condition.right}`);
							return null;
						}
						if (left !== condition.left || right !== condition.right) {
							repairState.repaired = true;
						}
						return { ...condition, left, right };
					})
					.filter((condition): condition is NonNullable<typeof condition> => condition !== null);
				break;
			}

			case 'window': {
				stage.sortKeys = stage.sortKeys
					.map((key) => {
						const repaired = chooseClosestColumnName(key.column, currentAvailableColumns);
						if (!repaired) {
							repairState.issues.push(`unknown window sort column: ${key.column}`);
							return null;
						}
						if (repaired !== key.column) {
							repairState.repaired = true;
						}
						return { ...key, column: repaired };
					})
					.filter((key): key is NonNullable<typeof key> => key !== null);
				repairDeriveExprColumns(stage, currentAvailableColumns, repairState);
				currentAvailableColumns = [
					...currentAvailableColumns,
					...stage.derives.map((derive) => derive.name).filter(Boolean)
				];
				break;
			}

			default:
				break;
		}
	}

	const pruned = clone.filter((stage) => {
		switch (stage.type) {
			case 'sort':
				if (stage.keys.length === 0) {
					repairState.issues.push('removed empty sort stage');
					repairState.repaired = true;
					return false;
				}
				return true;
			case 'filter':
				if (stage.conditions.length === 0) {
					repairState.issues.push('removed empty filter stage');
					repairState.repaired = true;
					return false;
				}
				return true;
			case 'select':
				if (stage.columns.length === 0) {
					repairState.issues.push('removed empty select stage');
					repairState.repaired = true;
					return false;
				}
				return true;
			case 'join':
				if (!stage.table || stage.conditions.length === 0) {
					repairState.issues.push('removed incomplete join stage');
					repairState.repaired = true;
					return false;
				}
				return true;
			case 'append':
				if (stage.sources.length === 0) {
					repairState.issues.push('removed empty append stage');
					repairState.repaired = true;
					return false;
				}
				return true;
			case 'window':
				if (stage.sortKeys.length === 0 && stage.derives.length === 0) {
					repairState.issues.push('removed empty window stage');
					repairState.repaired = true;
					return false;
				}
				return true;
			default:
				return true;
		}
	});

	return {
		stages: pruned,
		repaired: repairState.repaired,
		issues: repairState.issues
	};
}

function collectUnknownPromptColumns(
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[],
	availableColumns: string[]
): string[] {
	if (availableColumns.length === 0) return [];
	const unknown = new Set<string>();
	let currentAvailableColumns = [...availableColumns];
	const pushUnknown = (column: string): void => {
		if (!column) return;
		const normalizedAvailable = new Set(currentAvailableColumns.map((candidate) => normalizeSearchToken(candidate)));
		if (normalizedAvailable.has(normalizeSearchToken(column))) return;
		unknown.add(column);
	};

	for (const stage of stages) {
		switch (stage.type) {
			case 'filter':
				for (const condition of stage.conditions) pushUnknown(condition.column);
				break;
			case 'select':
				for (const column of stage.columns) pushUnknown(column);
				if (stage.columns.length > 0) currentAvailableColumns = [...stage.columns];
				break;
			case 'derive':
				for (const deriveColumn of stage.columns) {
					const expr = deriveColumn.expr;
					if (expr.mode === 'binary') {
						if (expr.left.kind === 'column') pushUnknown(expr.left.value);
						if (expr.right.kind === 'column') pushUnknown(expr.right.value);
					}
					if (expr.mode === 'func') {
						for (const arg of expr.args) {
							if (arg.kind === 'column') pushUnknown(arg.value);
						}
					}
				}
				currentAvailableColumns = [...currentAvailableColumns, ...stage.columns.map((column) => column.name).filter(Boolean)];
				break;
			case 'group':
				for (const byColumn of stage.by) pushUnknown(byColumn);
				for (const aggregation of stage.aggregations) {
					if (aggregation.column) pushUnknown(aggregation.column);
				}
				if (stage.window) {
					currentAvailableColumns = [...stage.by, ...stage.window.derives.map((derive) => derive.name).filter(Boolean)];
				} else {
					currentAvailableColumns = [...stage.by, ...stage.aggregations.map((aggregation) => aggregation.name).filter(Boolean)];
				}
				break;
			case 'sort':
				for (const key of stage.keys) pushUnknown(key.column);
				break;
			case 'join':
				for (const condition of stage.conditions) {
					pushUnknown(condition.left);
					pushUnknown(condition.right);
				}
				break;
			case 'window':
				for (const key of stage.sortKeys) pushUnknown(key.column);
				for (const deriveColumn of stage.derives) {
					const expr = deriveColumn.expr;
					if (expr.mode === 'binary') {
						if (expr.left.kind === 'column') pushUnknown(expr.left.value);
						if (expr.right.kind === 'column') pushUnknown(expr.right.value);
					}
					if (expr.mode === 'func') {
						for (const arg of expr.args) {
							if (arg.kind === 'column') pushUnknown(arg.value);
						}
					}
				}
				currentAvailableColumns = [...currentAvailableColumns, ...stage.derives.map((derive) => derive.name).filter(Boolean)];
				break;
			default:
				break;
		}
	}

	return [...unknown];
}

function buildFallbackPromptSuggestion(input: {
	query: string;
	availableColumns: string[];
	availableColumnProfiles?: Partial<Record<string, PresetColumnProfile>>;
}): StageAnalysisPromptSuggestion | null {
	const groupTopIntent = parseGroupTopIntent(input.query, input.availableColumns);
	if (groupTopIntent) {
		const metricColumn =
			groupTopIntent.metricColumn
			?? pickProfileMetricColumn({
				availableColumns: input.availableColumns,
				availableColumnProfiles: input.availableColumnProfiles
			})
			?? pickMetricColumn(input.availableColumns);
		const metricProfile = metricColumn
			? columnProfileFor(input.availableColumnProfiles, metricColumn)
			: null;
		const agg: 'sum' | 'avg' = metricColumn
			? preferredAggregationForQueryMetric(metricColumn, metricProfile)
			: 'sum';
		const metricSlug = metricColumn ? metricColumn.replace(/\W+/g, '_') : 'rows';
		const aggName = metricColumn ? `${agg}_${metricSlug}` : 'row_count';

		return buildAnalysisPromptSuggestion({
			label: `Top ${humanizeColumnName(groupTopIntent.groupColumn)} by ${metricColumn ? humanizeColumnName(metricColumn) : 'row count'}`,
			prompt: `Top ${humanizeColumnName(groupTopIntent.groupColumn)} by ${metricColumn ? humanizeColumnName(metricColumn) : 'row count'}: group by ${groupTopIntent.groupColumn}`,
			reasons: ['fallback prompt synthesis from explicit group/top intent'],
			stages: [
				{
					type: 'group',
					by: [groupTopIntent.groupColumn],
					aggregations: metricColumn
						? [{ name: aggName, func: agg, column: metricColumn }]
						: [{ name: 'row_count', func: 'count', column: '' }]
				},
				{ type: 'sort', keys: [{ column: aggName, dir: 'desc' }] },
				{ type: 'take', n: groupTopIntent.take }
			],
			score: 96
		});
	}

	const dimension = pickDimensionColumn(input.availableColumns) ?? input.availableColumns[0] ?? null;
	if (!dimension) return null;

	return buildAnalysisPromptSuggestion({
		label: `Group by ${humanizeColumnName(dimension)}`,
		prompt: `Group by ${humanizeColumnName(dimension)}: count rows per ${dimension}`,
		reasons: ['fallback prompt synthesis from available schema columns'],
		stages: [
			{ type: 'group', by: [dimension], aggregations: [{ name: 'row_count', func: 'count', column: '' }] },
			{ type: 'sort', keys: [{ column: 'row_count', dir: 'desc' }] }
		],
		score: 72
	});
}

export function generatePromptStagePlan(input: {
	query: string;
	availableColumns?: string[];
	availableColumnProfiles?: Partial<Record<string, PresetColumnProfile>>;
	dialect?: CoercionDialect;
	limit?: number;
	autoApplyThreshold?: number;
	validateCompile?: boolean;
}): PromptStageGenerationPlan | null {
	const availableColumns = input.availableColumns ?? [];
	if (availableColumns.length === 0) return null;

	const suggestions = searchAnalysisPrompts({
		query: input.query,
		availableColumns,
		availableColumnProfiles: input.availableColumnProfiles,
		dialect: input.dialect,
		limit: input.limit
	});

	let suggestion = suggestions[0];
	if (!suggestion || suggestion.stages.length === 0) {
		const fallbackSuggestion = buildFallbackPromptSuggestion({
			query: input.query,
			availableColumns,
			availableColumnProfiles: input.availableColumnProfiles
		});
		if (!fallbackSuggestion || fallbackSuggestion.stages.length === 0) return null;
		suggestion = fallbackSuggestion;
	}

	return finalizePromptStagePlanFromSuggestion({
		suggestion,
		availableColumns,
		autoApplyThreshold: input.autoApplyThreshold,
		validateCompile: input.validateCompile
	});
}

export function generatePromptStagePlanFromSuggestion(input: {
	query: string;
	availableColumns?: string[];
	suggestion: ExternalPromptStageSuggestionInput;
	autoApplyThreshold?: number;
	validateCompile?: boolean;
}): PromptStageGenerationPlan | null {
	const availableColumns = input.availableColumns ?? [];
	if (availableColumns.length === 0) return null;
	if (!input.suggestion || input.suggestion.stages.length === 0) return null;

	const score = Number.isFinite(input.suggestion.score)
		? Number(input.suggestion.score)
		: 130;
	const builtSuggestion = buildAnalysisPromptSuggestion({
		label: input.suggestion.label,
		prompt: input.suggestion.prompt ?? `${input.suggestion.label}: generated from prompt inference`,
		reasons: input.suggestion.reasons ?? ['LLM-inferred stage chain'],
		stages: input.suggestion.stages,
		score
	});
	const suggestion: StageAnalysisPromptSuggestion = {
		...builtSuggestion,
		confidence: Number.isFinite(input.suggestion.confidence)
			? Math.max(0.2, Math.min(0.98, Number(input.suggestion.confidence)))
			: builtSuggestion.confidence
	};

	return finalizePromptStagePlanFromSuggestion({
		suggestion,
		availableColumns,
		autoApplyThreshold: input.autoApplyThreshold,
		validateCompile: input.validateCompile
	});
}

function finalizePromptStagePlanFromSuggestion(input: {
	suggestion: StageAnalysisPromptSuggestion;
	availableColumns: string[];
	autoApplyThreshold?: number;
	validateCompile?: boolean;
}): PromptStageGenerationPlan {
	const repaired = repairPromptStages(input.suggestion.stages, input.availableColumns);
	const unknownColumns = collectUnknownPromptColumns(repaired.stages, input.availableColumns);
	const prql = guiToPreql(repaired.stages);

	let compileIssues: string[] = [];
	if (input.validateCompile) {
		const compileProbe = guiToPreql([
			{ type: 'from', table: '__prompt_validation_source__' },
			...repaired.stages
		]);
		const compileResult = compilePRQL(compileProbe);
		compileIssues = compileResult.errors
			.map((error) => error.reason)
			.filter((reason) => !isCompileResolutionIssue(reason));
	}

	const validationIssues = [...repaired.issues];
	if (unknownColumns.length > 0) {
		validationIssues.push(`unknown columns after repair: ${unknownColumns.join(', ')}`);
	}

	const validation: PromptStageValidation = {
		isValid: unknownColumns.length === 0 && compileIssues.length === 0 && repaired.stages.length > 0,
		repaired: repaired.repaired,
		unknownColumns,
		issues: validationIssues,
		compileIssues,
		prql
	};

	let confidence = input.suggestion.confidence;
	if (validation.repaired) confidence -= 0.06;
	if (unknownColumns.length > 0) confidence -= 0.3;
	if (compileIssues.length > 0) confidence -= 0.35;
	confidence = Math.max(0.2, Math.min(0.98, confidence));

	const autoApplyThreshold = input.autoApplyThreshold ?? 0.84;
	return {
		suggestion: input.suggestion,
		stages: repaired.stages,
		confidence,
		autoApply: validation.isValid && confidence >= autoApplyThreshold,
		validation
	};
}

export function recommendPresets(input: StageRecommendationInput): StagePresetSuggestion[] {
	const { stages, availableColumns = [], availableColumnCount, availableColumnProfiles } = input;
	const dialect = normalizeCoercionDialect(input.dialect);
	const compositeMetricPlan = findCompositeMetricPlan({
		availableColumns,
		availableColumnProfiles,
		dialect
	}, dialect);
	const hasGroup = stages.some((stage) => stage.type === 'group');
	const hasSort = stages.some((stage) => stage.type === 'sort');
	const hasTake = stages.some((stage) => stage.type === 'take');
	const hasDerive = stages.some((stage) => stage.type === 'derive');
	const hasFilter = stages.some((stage) => stage.type === 'filter');
	const hasAppend = stages.some((stage) => stage.type === 'append');
	const hasWindow = stages.some((stage) => stage.type === 'window');
	const hasLoop = stages.some((stage) => stage.type === 'loop');
	const lastStage = stages[stages.length - 1];
	const profileMetric = pickProfileMetricColumn({
		availableColumns,
		availableColumnProfiles,
		dialect
	});
	const hasProfileMetric = profileMetric !== null;
	const hasTemporal =
		availableColumns.some((column) => isTemporalColumn(column)) ||
		availableColumns.some((column) => isTemporalSemanticHint(columnProfileFor(availableColumnProfiles, column)?.semanticType));
	const hasMetric = pickNonTemporalMetricColumn(availableColumns) !== null || hasProfileMetricSignal({
		availableColumns,
		availableColumnProfiles,
		dialect
	});
	const hasEntity = availableColumns.some((column) =>
		/(payee|merchant|vendor|customer|user|account|company|name|entity|tenant|patient|student|operator|carrier)/i.test(column)
	);
	const hasDetail = availableColumns.some((column) =>
		/(details|detail|description|memo|message|note|narrative|title|diagnosis|issue|reason|summary)/i.test(column)
	);
	const hasInflowOutflowPair =
		availableColumns.some((column) => /(paid in|inflow|credit|deposit|received)/i.test(column)) &&
		availableColumns.some((column) => /(withdrawn|outflow|debit|spent|payment|charge)/i.test(column));
	const candidateDimensions = availableColumns.filter((column) => {
		if (isTemporalColumn(column) || isIdentifierColumn(column)) return false;
		if (column === profileMetric) return false;
		if (/(region|country|city|product|category|segment|channel|status|type|stage|payee|merchant|customer|department|plan|industry|grade|homeroom|priority|mode|carrier|plant|property|issue|diagnosis|account_type|payment_method|team|project|platform|source|medium|branch|office|division|tier|zone|class|brand|campaign)/i.test(column)) {
			return true;
		}
		const profile = columnProfileFor(availableColumnProfiles, column);
		return /(category|status|region|country|city|entity_name|code)/i.test(profile?.semanticType ?? '');
	});
	const hasTwoDimensions = candidateDimensions.length >= 2;
	const hasKey = availableColumns.some((column) => /(^id$|_id$|uuid|key|receipt|reference|ref)/i.test(column));
	const hasStageLike = availableColumns.some((column) => /(status|state|stage|step|phase|funnel|lifecycle)/i.test(column));
	const hasRevenueLike = availableColumns.some((column) => /(revenue|income|sales|paid|credited|inflow)/i.test(column));
	const hasCostLike = availableColumns.some((column) => /(cost|expense|withdrawn|debited|outflow|charge)/i.test(column));
	const hasComposedMetric = Boolean(compositeMetricPlan);
	const numericMeasurementColumns = availableColumns.filter((column) =>
		/(length|width|height|depth|diameter|radius|mass|weight|petal|sepal|measurement|feature|score|index)/i.test(column) &&
		!isTemporalColumn(column) &&
		!isIdentifierColumn(column)
	);
	const classLikeColumns = availableColumns.filter((column) =>
		/(species|class|target|label|category|type|status|segment|group)/i.test(column) &&
		!isTemporalColumn(column) &&
		!isIdentifierColumn(column)
	);
	const hasMeasurementMatrix =
		numericMeasurementColumns.length >= 3 &&
		classLikeColumns.length >= 1 &&
		!hasTemporal &&
		!hasInflowOutflowPair &&
		!hasDetail;

	return STAGE_PRESETS.map((preset) => {
		let score = 0;
		const reasons: string[] = [];

		if (availableColumnCount === 0) {
			score -= 20;
			reasons.push('needs available columns');
		} else {
			score += 10;
		}

		if (preset.id === 'top-metric') {
			if (!hasSort || !hasTake) {
				score += 10;
				reasons.push('quick ranking pattern');
			} else {
				score -= 8;
				reasons.push('pipeline already has sort+take ranking');
			}
			if (hasProfileMetric) {
				score += 9;
				reasons.push('confirmed numeric metric for direct ranking');
			} else if (hasMetric) {
				score += 6;
				reasons.push('metric detected for direct ranking');
			}
			if (lastStage?.type === 'group' || lastStage?.type === 'from') {
				score += 8;
				reasons.push('common follow-up to source or aggregate');
			}
			if (hasComposedMetric) {
				score += 12;
				reasons.push('supports composed business metric');
			}
		}

		if (preset.id === 'group-top') {
			if (!hasGroup) {
				score += 14;
				reasons.push('adds grouped summary');
			}
			if (availableColumns.length >= 2) {
				score += 6;
				reasons.push('enough columns for dimension and metric');
			}
			if (hasComposedMetric) {
				score += 15;
				reasons.push('composed metric supports richer group ranking');
			}
		}

		if (preset.id === 'dedup-exact') {
			if (availableColumns.length >= 2) {
				score += 16;
				reasons.push('multiple columns allow exact-row deduping');
			}
			if (!hasGroup) {
				score += 6;
				reasons.push('group stage not yet present');
			} else {
				score -= 8;
				reasons.push('group stage already deduplicates by dimension');
			}
			if (lastStage?.type === 'from' || lastStage?.type === 'append') {
				score += 4;
				reasons.push('best applied soon after source ingestion');
			}
		}

		if (preset.id === 'dedup-latest') {
			if (availableColumns.some((column) => /date|time|_at|timestamp/i.test(column))) {
				score += 12;
				reasons.push('timestamp-like column detected');
			}
			if (availableColumns.some((column) => /id|key|uuid/i.test(column))) {
				score += 8;
				reasons.push('key column detected');
			}
			if (hasGroup && hasTake) {
				score -= 6;
				reasons.push('pipeline already achieves key-dedup pattern');
			}
		}

		if (preset.id === 'temporal-trend') {
			if (hasTemporal) {
				score += 18;
				reasons.push('time dimension detected');
			}
			if (hasProfileMetric) {
				score += 10;
				reasons.push('confirmed numeric metric for trend aggregation');
			} else if (hasMetric) {
				score += 7;
				reasons.push('metric column detected');
			}
			if (hasTemporal && hasMetric && !hasGroup) {
				score += 8;
				reasons.push('prioritizes core temporal-metric baseline');
			}
			if (!hasDerive) {
				score += 6;
				reasons.push('adds temporal bucketing derive');
			}
			if (hasComposedMetric) {
				score += 9;
				reasons.push('can trend composed business metric');
			}
		}

		if (preset.id === 'text-categorize') {
			if (hasDetail) {
				score += 16;
				reasons.push('descriptive text column detected');
			}
			if (hasMetric) {
				score += 8;
				reasons.push('supports value-weighted categories');
			}
			if (!hasDerive) {
				score += 6;
				reasons.push('adds reusable case buckets');
			}
		}

		if (preset.id === 'anomaly-scan') {
			if (hasProfileMetric) {
				score += 15;
				reasons.push('confirmed numeric metric for outlier scan');
			} else if (hasMetric) {
				score += 10;
				reasons.push('metric present for outlier scan');
			}
			if (!hasSort || !hasTake) {
				score += 8;
				reasons.push('adds rank-and-trim flow');
			}
			if (!hasDerive) {
				score += 4;
				reasons.push('adds normalized absolute metric');
			}
		}

		if (preset.id === 'frequency-ranking') {
			if (hasEntity || candidateDimensions.length >= 1) {
				score += 12;
				reasons.push('entity or categorical dimension detected');
			}
			if (!hasGroup) {
				score += 8;
				reasons.push('adds count-based grouping');
			}
		}

		if (preset.id === 'cashflow-rollup') {
			if (hasInflowOutflowPair) {
				score += 20;
				reasons.push('complementary inflow/outflow columns detected');
			}
			if (hasTemporal) {
				score += 8;
				reasons.push('supports period rollup');
			}
			if (!hasGroup) {
				score += 6;
				reasons.push('adds net aggregation pattern');
			}
		}

		if (preset.id === 'hierarchical-rollup') {
			if (hasMetric) {
				score += 12;
				reasons.push('metric available for hierarchical aggregate');
			}
			if (hasTwoDimensions) {
				score += 14;
				reasons.push('two strong dimensions detected');
			}
			if (!hasGroup) {
				score += 8;
				reasons.push('adds grouped drilldown structure');
			}
		}

		if (preset.id === 'contribution-total') {
			if (hasProfileMetric) {
				score += 14;
				reasons.push('confirmed numeric metric for share analysis');
			} else if (hasMetric) {
				score += 9;
				reasons.push('metric supports contribution share analysis');
			}
			if (hasTwoDimensions) {
				score += 10;
				reasons.push('dimension pair supports segment contribution');
			}
			if (hasComposedMetric) {
				score += 8;
				reasons.push('composed metric improves share analysis');
			}
		}

		if (preset.id === 'period-variance') {
			if (hasTemporal) {
				score += 16;
				reasons.push('time column supports period deltas');
			}
			if (hasMetric) {
				score += 10;
				reasons.push('metric supports variance tracking');
			}
		}

		if (preset.id === 'segment-anomaly') {
			if (hasMetric) {
				score += 14;
				reasons.push('metric can be ranked by deviation');
			}
			if (hasTwoDimensions || hasEntity) {
				score += 8;
				reasons.push('segment context available for anomaly slices');
			}
		}

		if (preset.id === 'null-hotspots') {
			if (availableColumns.length >= 3) {
				score += 10;
				reasons.push('sufficient columns for quality segmentation');
			}
			if (hasTwoDimensions) {
				score += 8;
				reasons.push('dimension pair supports hotspot mapping');
			}
		}

		if (preset.id === 'duplicate-fingerprint') {
			if (hasKey) {
				score += 16;
				reasons.push('key-like column supports duplicate checks');
			}
			if (!hasGroup) {
				score += 6;
				reasons.push('adds grouped duplicate concentration view');
			}
		}

		if (preset.id === 'cohort-retention') {
			if (hasTemporal && (hasEntity || hasKey)) {
				score += 18;
				reasons.push('temporal + entity signal supports cohort analysis');
			}
		}

		if (preset.id === 'funnel-dropoff') {
			if (hasStageLike) {
				score += 16;
				reasons.push('stage-like status dimension detected');
			}
			if (hasTemporal) {
				score += 6;
				reasons.push('time context supports funnel progression');
			}
		}

		if (preset.id === 'outlier-explain') {
			if (hasMetric) {
				score += 12;
				reasons.push('metric available for outlier surfacing');
			}
			if (hasTwoDimensions || hasEntity) {
				score += 8;
				reasons.push('context dimensions available for explanation');
			}
		}

		if (preset.id === 'seasonal-pattern') {
			if (hasTemporal) {
				score += 18;
				reasons.push('timestamp supports seasonality projection');
			}
			if (hasMetric) {
				score += 6;
				reasons.push('metric supports seasonal comparison');
			}
		}

		if (preset.id === 'efficiency-lens') {
			if (hasRevenueLike && hasCostLike) {
				score += 18;
				reasons.push('paired revenue/cost semantics detected');
			}
			if (hasTwoDimensions) {
				score += 8;
				reasons.push('dimensions support efficiency segmentation');
			}
		}

		if (preset.id === 'drift-monitor') {
			if (hasTemporal) {
				score += 14;
				reasons.push('temporal signal supports baseline comparisons');
			}
			if (hasTwoDimensions) {
				score += 8;
				reasons.push('dimensions support drift breakdown');
			}
		}

		if (preset.id === 'append-union-stack') {
			score -= 6;
			if (!hasAppend) {
				score += 7;
				reasons.push('adds multi-source append scaffold');
			}
			if (lastStage?.type === 'from') {
				score += 5;
				reasons.push('natural follow-up after choosing a primary source');
			}
			if (availableColumns.length >= 3) {
				score += 3;
				reasons.push('sufficient schema to summarize appended sources');
			}
		}

		if (preset.id === 'window-rolling') {
			score -= 4;
			if (hasTemporal) {
				score += 12;
				reasons.push('time axis enables rolling windows');
			}
			if (hasMetric) {
				score += 7;
				reasons.push('metric supports rolling aggregation');
			}
			if (!hasWindow) {
				score += 4;
				reasons.push('introduces explicit window stage');
			} else {
				score -= 8;
				reasons.push('window stage already present');
			}
			if (hasTemporal && hasMetric && availableColumnCount > 0 && availableColumnCount <= 4) {
				score += 11;
				reasons.push('compact temporal-metric schemas benefit from dedicated rolling windows');
			}
		}

		if (preset.id === 'window-lag-delta') {
			score -= 5;
			if (hasTemporal) {
				score += 11;
				reasons.push('ordered timestamps support lag deltas');
			}
			if (hasMetric) {
				score += 7;
				reasons.push('metric enables delta magnitude analysis');
			}
			if (!hasWindow) {
				score += 4;
				reasons.push('adds window-based change detection');
			} else {
				score -= 8;
				reasons.push('window stage already present');
			}
			if (hasTemporal && hasMetric && availableColumnCount > 0 && availableColumnCount <= 4) {
				score += 10;
				reasons.push('compact temporal-metric schemas benefit from direct lag deltas');
			}
		}

		if (preset.id === 'loop-refine') {
			score -= 7;
			if (!hasLoop) {
				score += 6;
				reasons.push('adds iterative loop scaffold');
			}
			if (hasFilter || hasMetric) {
				score += 3;
				reasons.push('existing narrowing signals benefit from iterative refinement');
			}
			if (lastStage?.type === 'from' || lastStage?.type === 'append') {
				score += 2;
				reasons.push('useful early to stabilize noisy data');
			}
		}

		if (hasMeasurementMatrix) {
			if (preset.id === 'group-top') {
				score += 22;
				reasons.push('measurement matrix: compare feature means by class label');
			}
			if (preset.id === 'segment-anomaly') {
				score += 16;
				reasons.push('measurement matrix: surface class-level feature deviations');
			}
			if (preset.id === 'outlier-explain') {
				score += 14;
				reasons.push('measurement matrix: rank extreme feature rows for inspection');
			}
			if (preset.id === 'frequency-ranking') {
				score += 10;
				reasons.push('measurement matrix: class-frequency baseline is useful');
			}

			if (preset.id === 'null-hotspots' || preset.id === 'duplicate-fingerprint' || preset.id === 'hierarchical-rollup') {
				score -= 16;
				reasons.push('deprioritized low-signal quality preset for dense feature matrix');
			}
			if (preset.id === 'cashflow-rollup' || preset.id === 'cohort-retention' || preset.id === 'funnel-dropoff' || preset.id === 'drift-monitor' || preset.id === 'dedup-latest' || preset.id === 'dedup-exact') {
				score -= 18;
				reasons.push('deprioritized incompatible preset for non-temporal feature matrix');
			}
		}

		if (preset.id === 'top-metric' && hasInflowOutflowPair) {
			score -= 3;
			reasons.push('use cashflow rollup for paired flow columns');
		}

		if (preset.id === 'group-top' && hasTemporal && hasMetric) {
			score -= 2;
			reasons.push('temporal trend may be more informative');
		}

		if (preset.id === 'anomaly-scan' && hasFilter) {
			score -= 2;
			reasons.push('pipeline already narrowed with filter');
		}

		return {
			preset,
			score,
			reasons,
			stages: makePresetStages(preset.id, { availableColumns, availableColumnProfiles, dialect }),
			hydration: presetHydrationFor(preset.id),
			snippet: buildSnippet({
				title: preset.label,
				stages: makePresetStages(preset.id, { availableColumns, availableColumnProfiles, dialect }),
				tags: [preset.id, ...preset.keywords.slice(0, 4)]
			})
		};
	}).sort((a, b) => b.score - a.score);
}

export function getQuickChips(input: Pick<StageRecommendationInput, 'stages' | 'availableColumns'>): QuickChip[] {
	const columns = input.availableColumns ?? [];
	if (columns.length === 0) return [];

	const hasType = (type: StageType): boolean => input.stages.some((stage) => stage.type === type);
	const baseFrom = input.stages.find((stage): stage is Extract<GUIPipelineStage, { type: 'from' }> => stage.type === 'from')?.table ?? '';
	const quick: Array<Omit<QuickChip, 'snippet'> & { score: number; snippet?: StageSuggestionSnippet }> = [];

	const metric = pickNonTemporalMetricColumn(columns) ?? '';
	const dimension = pickDimensionFallback(columns, metric || null) ?? '';
	const timestamp = pickTimestampColumn(columns);
	const filterColumn =
		preferColumn(columns, ['status', 'state', 'category', 'type', 'kind', 'segment']) ?? columns[0] ?? '';

	if (!hasType('sort')) {
		const sortColumn = timestamp ?? metric;
		if (sortColumn) {
			const chip: QuickChip = {
				id: `sort-${sortColumn}`,
				label: `Sort by ${humanizeColumnName(sortColumn)}${timestamp ? ' (newest first)' : ''}`,
				icon: 'sort',
				stage: {
					type: 'sort',
					keys: [{ column: sortColumn, dir: timestamp ? 'desc' : 'asc' }]
				},
				tone: 'primary',
				hydration: quickChipHydrationFor({
					stage: {
						type: 'sort',
						keys: [{ column: sortColumn, dir: timestamp ? 'desc' : 'asc' }]
					},
					label: `Sort by ${humanizeColumnName(sortColumn)}${timestamp ? ' (newest first)' : ''}`
				})
			};
			quick.push({
				...chip,
				score: timestamp ? 28 : 20
			});
		}
	}

	if (!hasType('append') && baseFrom) {
		const appendStage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
			type: 'append',
			sources: [`${baseFrom}_archive`, `${baseFrom}_backfill`]
		};
		const appendLabel = `Append ${humanizeColumnName(baseFrom)} siblings`;
		quick.push({
			id: `append-${baseFrom}`,
			label: appendLabel,
			icon: 'append',
			stage: appendStage,
			tone: 'accent',
			hydration: quickChipHydrationFor({ stage: appendStage, label: appendLabel }),
			score: 19
		});
	}

	if (!hasType('filter') && filterColumn) {
		const filterStage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
			type: 'filter',
			conditions: [{ column: filterColumn, op: '==', value: '' }],
			logic: 'and'
		};
		const filterLabel = `Filter by ${humanizeColumnName(filterColumn)}`;
		quick.push({
			id: `filter-${filterColumn}`,
			label: filterLabel,
			icon: 'filter',
			stage: filterStage,
			tone: 'primary',
			hydration: quickChipHydrationFor({ stage: filterStage, label: filterLabel }),
			score: 24
		});
	}

	if (!hasType('group') && dimension && dimension !== metric) {
		const safeMetric = metric.replace(/\W+/g, '_');
		const groupStage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
			type: 'group',
			by: [dimension],
			aggregations: metric
				? [{ name: `sum_${safeMetric}`, func: 'sum', column: metric }]
				: [{ name: 'row_count', func: 'count', column: '' }]
		};
		const groupLabel = metric
			? `Group by ${humanizeColumnName(dimension)}, sum ${humanizeColumnName(metric)}`
			: `Group by ${humanizeColumnName(dimension)}, count rows`;
		quick.push({
			id: `group-${dimension}-${metric}`,
			label: groupLabel,
			icon: 'group',
			stage: groupStage,
			tone: 'primary',
			hydration: quickChipHydrationFor({ stage: groupStage, label: groupLabel }),
			score: metric ? 23 : 21
		});
	}

	if (!hasType('group') && columns.length >= 2) {
		const dedupStage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
			type: 'group',
			by: [...columns],
			aggregations: [{ name: 'row_count', func: 'count', column: '' }],
			take: 1
		};
		const dedupLabel = 'Remove exact duplicate rows';
		quick.push({
			id: 'dedup-exact-rows',
			label: dedupLabel,
			icon: 'group',
			stage: dedupStage,
			tone: 'accent',
			hydration: quickChipHydrationFor({ stage: dedupStage, label: dedupLabel }),
			score: 18
		});
	}

	if (!hasType('derive')) {
		const textDeriveColumn = columns.find(
			(column) =>
				!isTemporalColumn(column) &&
				!isIdentifierColumn(column) &&
				isLikelyTextColumn(column)
		);

		const numericDeriveColumn =
			(metric && !isTemporalColumn(metric) && !isIdentifierColumn(metric) ? metric : null) ??
			columns.find(
				(column) =>
					!isTemporalColumn(column) &&
					!isIdentifierColumn(column) &&
					!isLikelyTextColumn(column)
			);

		const deriveColumn = textDeriveColumn ?? numericDeriveColumn ?? null;

		if (!deriveColumn) {
			// Skip derive if we only have temporal/id-like columns in fallback mode.
		} else {
			const deriveNameBase = deriveColumn.replace(/\W+/g, '_');
			const textLike = isLikelyTextColumn(deriveColumn);
			const roundWorthy =
				!textLike &&
				(isRoundWorthyNumericColumn(deriveColumn) || !isCountLikeNumericColumn(deriveColumn));

			if (textLike || roundWorthy) {
				const deriveLabel = textLike
					? `Normalize ${humanizeColumnName(deriveColumn)} to lowercase`
					: `Derive ${humanizeColumnName(deriveColumn)} rounded`;
				const deriveExpr: DeriveExpr = textLike
					? { mode: 'func', func: 'text.lower', args: [{ kind: 'column', value: deriveColumn }] }
					: { mode: 'func', func: 'math.round', args: [{ kind: 'literal', value: '0' }, { kind: 'column', value: deriveColumn }] };
				const deriveStage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
					type: 'derive',
					columns: [
						{
							name: textLike ? `${deriveNameBase}_lower` : `${deriveNameBase}_rounded`,
							expr: deriveExpr
						}
					]
				};

				quick.push({
					id: `derive-${deriveColumn}`,
					label: deriveLabel,
					icon: 'derive',
					stage: deriveStage,
					tone: 'accent',
					hydration: quickChipHydrationFor({ stage: deriveStage, label: deriveLabel }),
					score: 17
				});
			}
		}
	}

	if (!hasType('select') && columns.length >= 9) {
		const chosen = columns.slice(0, 6);
		const selectStage: Exclude<GUIPipelineStage, { type: 'raw' }> = { type: 'select', columns: chosen };
		const selectLabel = `Select ${chosen.length} cols`;
		quick.push({
			id: 'select-focus',
			label: selectLabel,
			icon: 'select',
			stage: selectStage,
			tone: 'accent',
			hydration: quickChipHydrationFor({ stage: selectStage, label: selectLabel }),
			score: 14
		});
	}

	if (!hasType('take')) {
		const takeStage: Exclude<GUIPipelineStage, { type: 'raw' }> = { type: 'take', n: 100 };
		const takeLabel = 'Take 100';
		quick.push({
			id: 'take-100',
			label: takeLabel,
			icon: 'take',
			stage: takeStage,
			tone: 'accent',
			hydration: quickChipHydrationFor({ stage: takeStage, label: takeLabel }),
			score: 12
		});
	}

	if (!hasType('window')) {
		const windowMetric = metric;
		const windowSort = timestamp ?? metric ?? dimension;
		if (windowSort) {
			const windowStage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
				type: 'window',
				frame: 'rows:-6..0',
				sortKeys: [{ column: windowSort, dir: 'asc' }],
				derives: windowMetric
					? [{ name: `rolling_avg_${windowMetric.replace(/\W+/g, '_')}`, expr: { mode: 'raw', expr: `average ${quotePrqlIdentifier(windowMetric)}` } }]
					: []
			};
			const windowLabel = windowMetric
				? `Window rolling avg ${humanizeColumnName(windowMetric)}`
				: `Window over ${humanizeColumnName(windowSort)}`;
			quick.push({
				id: `window-${windowSort}`,
				label: windowLabel,
				icon: 'window',
				stage: windowStage,
				tone: 'primary',
				hydration: quickChipHydrationFor({ stage: windowStage, label: windowLabel }),
				score: timestamp ? (windowMetric ? 22 : 20) : 15
			});
		}
	}

	if (!hasType('loop')) {
		const loopBody = metric
			? `filter ${quotePrqlIdentifier(metric)} != null\nsort {-${quotePrqlIdentifier(metric)}}\ntake 500`
			: dimension
				? `filter ${quotePrqlIdentifier(dimension)} != null\ntake 500`
				: 'filter true\ntake 500';
		const loopStage: Exclude<GUIPipelineStage, { type: 'raw' }> = {
			type: 'loop',
			body: loopBody
		};
		const loopLabel = metric
			? `Loop refine by ${humanizeColumnName(metric)}`
			: 'Loop refine scaffold';
		quick.push({
			id: 'loop-refine',
			label: loopLabel,
			icon: 'loop',
			stage: loopStage,
			tone: 'accent',
			hydration: quickChipHydrationFor({ stage: loopStage, label: loopLabel }),
			score: 18
		});
	}

	return quick
		.sort((a, b) => b.score - a.score)
		.slice(0, 8)
		.map(({ score, ...chip }) => ({
			...chip,
			snippet: chip.snippet ?? buildSnippet({
				title: chip.label,
				stages: [chip.stage],
				tags: [chip.stage.type, chip.icon]
			})
		}));
}
