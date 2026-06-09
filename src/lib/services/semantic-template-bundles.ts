import type { SemanticCategory } from '$lib/services/stage-catalog';

interface ProfileLike {
	column_name: string;
	semantic_type?: string;
	data_kind?: string;
}

interface SemanticTemplateDefinition {
	id: string;
	title: string;
	semanticCategory: SemanticCategory;
	analysisPattern: string;
	tags: string[];
	prqlTemplate: string;
}

export interface SemanticTemplateHydrationInput {
	availableColumns: string[];
	profileRows?: ProfileLike[];
	maxResults?: number;
}

export interface HydratedSemanticTemplateBundle {
	id: string;
	title: string;
	semanticCategory: SemanticCategory;
	analysisPattern: string;
	tags: string[];
	prql: string;
	confidence: number;
	bindings: Record<string, string>;
}

const SEMANTIC_TEMPLATES: SemanticTemplateDefinition[] = [
	{
		id: 'temporal-monthly-rollup',
		title: 'Temporal: Monthly trend rollup',
		semanticCategory: 'temporal',
		analysisPattern: 'Time-Series Forecasting & Window Aggregation',
		tags: ['temporal', 'trend', 'aggregation'],
		prqlTemplate: `from events
derive month = s"DATE_TRUNC('month', {timestamp_col})"
group month (
  aggregate {
    count_events = count this,
    total_value  = sum {value_col}
  }
)
sort month`
	},
	{
		id: 'temporal-rolling-7d',
		title: 'Temporal: Rolling 7-day average',
		semanticCategory: 'temporal',
		analysisPattern: 'Time-Series Forecasting & Window Aggregation',
		tags: ['temporal', 'window', 'rolling'],
		prqlTemplate: `from daily_metrics
window rows := (-6..0) (
  derive rolling_avg = average {metric_col}
)
sort {date_col}`
	},
	{
		id: 'temporal-yoy',
		title: 'Temporal: Year-over-year comparison',
		semanticCategory: 'temporal',
		analysisPattern: 'Time-Series Forecasting & Window Aggregation',
		tags: ['temporal', 'yoy', 'comparison'],
		prqlTemplate: `from sales
derive {
  yr  = s"EXTRACT(YEAR FROM {order_date})",
  mo  = s"EXTRACT(MONTH FROM {order_date})"
}
group {yr, mo} (
  aggregate revenue = sum {amount}
)
sort {yr, mo}`
	},
	{
		id: 'geo-count-country',
		title: 'Geographic: Count by country/region',
		semanticCategory: 'geographic',
		analysisPattern: 'Segmentation, Grouping & Classification',
		tags: ['geo', 'group', 'count'],
		prqlTemplate: `from locations
group {country_col} (
  aggregate record_count = count this
)
sort {-record_count}`
	},
	{
		id: 'geo-haversine-distance',
		title: 'Geographic: Haversine distance filter',
		semanticCategory: 'geographic',
		analysisPattern: 'Graph Analysis & Hierarchy Traversal',
		tags: ['geo', 'distance', 'haversine'],
		prqlTemplate: `from stores
derive distance_km = s"""
  2 * 6371 * ASIN(SQRT(
    POWER(SIN(RADIANS({lat} - -1.2921) / 2), 2) +
    COS(RADIANS(-1.2921)) * COS(RADIANS({lon})) *
    POWER(SIN(RADIANS({lon} - 36.8219) / 2), 2)
  ))
"""
filter distance_km <= 50
sort distance_km
select {{store_id, {lat}, {lon}, distance_km}}`
	},
	{
		id: 'geo-null-coordinates',
		title: 'Geographic: Null coordinate audit',
		semanticCategory: 'geographic',
		analysisPattern: 'Entity Deduplication & Relationship Mapping',
		tags: ['geo', 'quality', 'null-audit'],
		prqlTemplate: `from locations
derive missing_coords = s"CASE WHEN {lat} IS NULL OR {lon} IS NULL THEN 1 ELSE 0 END"
aggregate {
  total          = count this,
  missing_coords = sum missing_coords,
  pct_missing    = s"ROUND(100.0 * SUM(CASE WHEN {lat} IS NULL OR {lon} IS NULL THEN 1 ELSE 0 END) / COUNT(*), 2)"
}`
	},
	{
		id: 'categorical-frequency',
		title: 'Categorical: Frequency distribution',
		semanticCategory: 'categorical',
		analysisPattern: 'Segmentation, Grouping & Classification',
		tags: ['categorical', 'frequency', 'distribution'],
		prqlTemplate: `from orders
group {status_col} (
  aggregate {
    count = count this,
    pct   = s"ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2)"
  }
)
sort {-count}`
	},
	{
		id: 'categorical-crosstab',
		title: 'Categorical: Cross-tab',
		semanticCategory: 'categorical',
		analysisPattern: 'Segmentation, Grouping & Classification',
		tags: ['categorical', 'cross-tab'],
		prqlTemplate: `from users
group {{plan_type, country}} (
  aggregate user_count = count this
)
sort {{plan_type, -user_count}}`
	},
	{
		id: 'id-uniqueness-audit',
		title: 'ID: Uniqueness and duplicate audit',
		semanticCategory: 'id',
		analysisPattern: 'Entity Deduplication & Relationship Mapping',
		tags: ['id', 'duplicate', 'uniqueness'],
		prqlTemplate: `from transactions
aggregate {
  total_rows    = count this,
  unique_ids    = count_distinct {txn_id},
  duplicate_cnt = s"COUNT(*) - COUNT(DISTINCT {txn_id})"
}`
	},
	{
		id: 'id-orphan-fk-check',
		title: 'ID: Orphan foreign key check',
		semanticCategory: 'id',
		analysisPattern: 'Entity Deduplication & Relationship Mapping',
		tags: ['id', 'foreign-key', 'orphan'],
		prqlTemplate: `from orders
join side:left customers=(from customers) (
  this.{customer_id} == customers.{customer_id}
)
filter customers.{customer_id} == null
select {{orders.order_id, orders.{customer_id}}}`
	},
	{
		id: 'numeric-distribution-summary',
		title: 'Numeric: Distribution summary',
		semanticCategory: 'continuous-numeric',
		analysisPattern: 'Statistical Summarization & Predictive Modeling',
		tags: ['numeric', 'distribution', 'percentiles'],
		prqlTemplate: `from sales
aggregate {
  cnt    = count this,
  mean   = average {amount},
  stddev = s"STDDEV({amount})",
  min    = min {amount},
  p25    = s"PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY {amount})",
  median = s"PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY {amount})",
  p75    = s"PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY {amount})",
  p95    = s"PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY {amount})",
  max    = max {amount}
}`
	},
	{
		id: 'numeric-zscore',
		title: 'Numeric: Z-score normalization',
		semanticCategory: 'continuous-numeric',
		analysisPattern: 'Statistical Summarization & Predictive Modeling',
		tags: ['numeric', 'zscore', 'normalization'],
		prqlTemplate: `from metrics
derive z_score = s"({value} - AVG({value}) OVER ()) / NULLIF(STDDEV({value}) OVER (), 0)"
select {{id, {value}, z_score}}
sort {-z_score}`
	},
	{
		id: 'boolean-event-rate',
		title: 'Boolean: Event rate',
		semanticCategory: 'boolean',
		analysisPattern: 'Event Rate Analysis & Propensity Modeling',
		tags: ['boolean', 'event-rate'],
		prqlTemplate: `from users
aggregate {
  total       = count this,
  converted   = sum s"CAST({is_converted} AS INT)",
  conv_rate   = s"ROUND(100.0 * SUM(CAST({is_converted} AS INT)) / COUNT(*), 2)"
}`
	},
	{
		id: 'boolean-null-audit',
		title: 'Boolean: Null vs false audit',
		semanticCategory: 'boolean',
		analysisPattern: 'Event Rate Analysis & Propensity Modeling',
		tags: ['boolean', 'null-audit'],
		prqlTemplate: `from flags
aggregate {
  total      = count this,
  true_count = sum s"CASE WHEN {flag_col} = true THEN 1 ELSE 0 END",
  false_count= sum s"CASE WHEN {flag_col} = false THEN 1 ELSE 0 END",
  null_count = sum s"CASE WHEN {flag_col} IS NULL THEN 1 ELSE 0 END"
}`
	},
	{
		id: 'text-length-distribution',
		title: 'Text: Length distribution',
		semanticCategory: 'text',
		analysisPattern: 'NLP & Thematic Extraction',
		tags: ['text', 'length', 'quality'],
		prqlTemplate: `from reviews
derive char_len = s"LENGTH({review_text})"
aggregate {
  avg_len    = average char_len,
  max_len    = max char_len,
  min_len    = min char_len,
  empty_rows = sum s"CASE WHEN LENGTH({review_text}) = 0 THEN 1 ELSE 0 END"
}`
	},
	{
		id: 'text-keyword-frequency',
		title: 'Text: Keyword frequency',
		semanticCategory: 'text',
		analysisPattern: 'NLP & Thematic Extraction',
		tags: ['text', 'keyword', 'frequency'],
		prqlTemplate: `from support_tickets
derive contains_kw = s"CASE WHEN LOWER({message}) LIKE '%refund%' THEN 1 ELSE 0 END"
aggregate {
  total        = count this,
  refund_mentions = sum contains_kw,
  pct          = s"ROUND(100.0 * SUM(CASE WHEN LOWER({message}) LIKE '%refund%' THEN 1 ELSE 0 END) / COUNT(*), 2)"
}`
	},
	{
		id: 'ordinal-rank-distribution',
		title: 'Ordinal: Rank distribution',
		semanticCategory: 'ordinal',
		analysisPattern: 'Segmentation, Grouping & Classification',
		tags: ['ordinal', 'distribution'],
		prqlTemplate: `from survey_responses
group {rating_col} (
  aggregate {
    count = count this,
    pct   = s"ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2)"
  }
)
sort {rating_col}`
	},
	{
		id: 'ordinal-median-mode',
		title: 'Ordinal: Median and mode',
		semanticCategory: 'ordinal',
		analysisPattern: 'Statistical Summarization & Predictive Modeling',
		tags: ['ordinal', 'median', 'mode'],
		prqlTemplate: `from nps_scores
aggregate {
  median     = s"PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {score})",
  mode_score = s"MODE() WITHIN GROUP (ORDER BY {score})"
}`
	},
	{
		id: 'ratio-percent-rank',
		title: 'Ratio: Percentile rank',
		semanticCategory: 'ratio-derived',
		analysisPattern: 'Performance Benchmarking & Decomposition',
		tags: ['ratio', 'percent-rank'],
		prqlTemplate: `from campaigns
derive pct_rank = s"PERCENT_RANK() OVER (ORDER BY {conversion_rate})"
select {{campaign_id, {conversion_rate}, pct_rank}}
sort {-{conversion_rate}}`
	},
	{
		id: 'ratio-variance-target',
		title: 'Ratio: Variance from target',
		semanticCategory: 'ratio-derived',
		analysisPattern: 'Performance Benchmarking & Decomposition',
		tags: ['ratio', 'variance', 'target'],
		prqlTemplate: `from kpis
derive variance_pct = s"ROUND(100.0 * ({actual} - {target}) / NULLIF({target}, 0), 2)"
sort {-s"ABS({variance_pct})"}
select {{kpi_name, {actual}, {target}, variance_pct}}`
	},
	{
		id: 'event-frequency-type',
		title: 'Event Log: Frequency by type',
		semanticCategory: 'event-log',
		analysisPattern: 'Sequence Analysis & Funnel Reconstruction',
		tags: ['event-log', 'frequency'],
		prqlTemplate: `from event_log
group {event_type} (
  aggregate {
    count    = count this,
    distinct_users = count_distinct {user_id}
  }
)
sort {-count}`
	},
	{
		id: 'event-session-reconstruction',
		title: 'Event Log: Session reconstruction',
		semanticCategory: 'event-log',
		analysisPattern: 'Sequence Analysis & Funnel Reconstruction',
		tags: ['event-log', 'session', 'lag'],
		prqlTemplate: `from clickstream
derive prev_ts   = s"LAG({event_ts}) OVER (PARTITION BY {user_id} ORDER BY {event_ts})"
derive gap_mins  = s"DATEDIFF('minute', {prev_ts}, {event_ts})"
derive new_session = s"CASE WHEN {gap_mins} > 30 OR {prev_ts} IS NULL THEN 1 ELSE 0 END"
derive session_id = s"SUM({new_session}) OVER (PARTITION BY {user_id} ORDER BY {event_ts})"
select {{ {user_id}, {event_ts}, {event_type}, session_id }}`
	},
	{
		id: 'network-out-degree',
		title: 'Network: Out-degree',
		semanticCategory: 'network-relational',
		analysisPattern: 'Graph Analysis & Hierarchy Traversal',
		tags: ['network', 'degree'],
		prqlTemplate: `from edges
group {source_id} (
  aggregate out_degree = count_distinct {target_id}
)
sort {-out_degree}`
	},
	{
		id: 'network-reciprocal-edge',
		title: 'Network: Reciprocal edge check',
		semanticCategory: 'network-relational',
		analysisPattern: 'Graph Analysis & Hierarchy Traversal',
		tags: ['network', 'reciprocal'],
		prqlTemplate: `from edges
join side:inner reverse=(from edges) (
  this.{source_id} == reverse.{target_id} &&
  this.{target_id} == reverse.{source_id}
)
select {{this.{source_id}, this.{target_id}}}
distinct`
	},
	{
		id: 'media-null-reference',
		title: 'Media: Null reference audit',
		semanticCategory: 'media-reference',
		analysisPattern: 'Entity Deduplication & Relationship Mapping',
		tags: ['media', 'null-audit'],
		prqlTemplate: `from product_images
derive is_null = s"CASE WHEN {image_url} IS NULL OR TRIM({image_url}) = '' THEN 1 ELSE 0 END"
aggregate {
  total      = count this,
  null_refs  = sum is_null,
  pct_null   = s"ROUND(100.0 * SUM({is_null}) / COUNT(*), 2)"
}`
	},
	{
		id: 'media-extension-distribution',
		title: 'Media: Extension distribution',
		semanticCategory: 'media-reference',
		analysisPattern: 'Segmentation, Grouping & Classification',
		tags: ['media', 'extension'],
		prqlTemplate: `from assets
derive extension = s"LOWER(REGEXP_EXTRACT({file_path}, '\\.([a-zA-Z0-9]+)$', 1))"
group extension (
  aggregate count = count this
)
sort {-count}`
	},
	{
		id: 'media-domain-extraction',
		title: 'Media: Domain extraction',
		semanticCategory: 'media-reference',
		analysisPattern: 'Segmentation, Grouping & Classification',
		tags: ['media', 'domain'],
		prqlTemplate: `from links
derive domain = s"REGEXP_EXTRACT({url_col}, 'https?://([^/]+)', 1)"
group domain (
  aggregate count = count this
)
sort {-count}`
	}
];

function tokenize(name: string): string {
	return name.trim().toLowerCase();
}

function prqlColumnIdentifier(column: string): string {
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) return column;
	return `\"${column.replace(/\"/g, '\\\"')}\"`;
}

function chooseColumnByRegex(columns: string[], regex: RegExp, fallback?: string | null): string | null {
	const hit = columns.find((column) => regex.test(column));
	if (hit) return hit;
	return fallback ?? null;
}

function chooseBySemantic(profiles: ProfileLike[], semanticPattern: RegExp): string | null {
	const hit = profiles.find((row) => semanticPattern.test(row.semantic_type ?? ''));
	return hit?.column_name ?? null;
}

function chooseTextColumn(columns: string[], profiles: ProfileLike[]): string | null {
	const bySemantic = chooseBySemantic(profiles, /(description|text|status|category|event_type|entity_name)/i);
	if (bySemantic) return bySemantic;
	return chooseColumnByRegex(columns, /(description|message|text|comment|body|details|status|category|type)/i, columns[0] ?? null);
}

function chooseMetricColumn(columns: string[], profiles: ProfileLike[]): string | null {
	const bySemantic = chooseBySemantic(profiles, /(amount|metric|count|ratio|percentage|quantity|duration|score)/i);
	if (bySemantic) return bySemantic;
	return chooseColumnByRegex(columns, /(amount|value|metric|score|count|total|price|cost|rate|ratio|duration|revenue|margin|conversion)/i, null);
}

function chooseTemporalColumn(columns: string[], profiles: ProfileLike[]): string | null {
	const bySemantic = chooseBySemantic(profiles, /(event_time|created_at|updated_at|date)/i);
	if (bySemantic) return bySemantic;
	return chooseColumnByRegex(columns, /(date|time|timestamp|_at|day|month|year|period|submitted|event_ts|log_ts)/i, null);
}

function chooseIdColumn(columns: string[], profiles: ProfileLike[]): string | null {
	const bySemantic = chooseBySemantic(profiles, /(id|foreign_key|session_id|source_id|target_id|parent_id)/i);
	if (bySemantic) return bySemantic;
	return chooseColumnByRegex(columns, /(^id$|_id$|uuid|guid|key$|session|source|target|parent|customer_id|user_id)/i, null);
}

function buildBindingResolver(columns: string[], profiles: ProfileLike[]): (token: string) => string | null {
	const temporal = chooseTemporalColumn(columns, profiles);
	const metric = chooseMetricColumn(columns, profiles);
	const text = chooseTextColumn(columns, profiles);
	const id = chooseIdColumn(columns, profiles);
	const lat = chooseColumnByRegex(columns, /(^lat$|latitude)/i, chooseBySemantic(profiles, /(latitude|geo_point)/i));
	const lon = chooseColumnByRegex(columns, /(^lon$|^lng$|longitude)/i, chooseBySemantic(profiles, /(longitude|geo_point)/i));
	const country = chooseColumnByRegex(columns, /(country|region|state|province)/i, chooseBySemantic(profiles, /(country|region)/i));
	const url = chooseColumnByRegex(columns, /(url|link|website|image_url|media_url)/i, chooseBySemantic(profiles, /(media_url|url)/i));
	const path = chooseColumnByRegex(columns, /(file_path|path|asset|media_path|image_path)/i, chooseBySemantic(profiles, /(media_path|media_extension)/i));
	const binary = chooseColumnByRegex(columns, /(is_|has_|flag|converted|churned|active|recovered)/i, chooseBySemantic(profiles, /(flag|binary_outcome)/i));
	const category = chooseColumnByRegex(columns, /(status|category|type|segment|plan|country|region|stage|rating)/i, text ?? country);
	const sourceId = chooseColumnByRegex(columns, /(source_id|src_id|from_id|source)/i, id);
	const targetId = chooseColumnByRegex(columns, /(target_id|dst_id|to_id|target)/i, id);
	const parentId = chooseColumnByRegex(columns, /(parent_id|ancestor_id|root_id|parent)/i, id);
	const userId = chooseColumnByRegex(columns, /(user_id|customer_id|account_id|member_id)/i, id);

	return (token: string): string | null => {
		switch (token) {
			case 'timestamp_col':
			case 'date_col':
			case 'order_date':
			case 'txn_date':
			case 'log_date':
			case 'event_ts':
			case 'log_ts':
			case 'submitted_at':
			case 'month_col':
				return temporal;
			case 'value_col':
			case 'metric_col':
			case 'amount':
			case 'amount_col':
			case 'price':
			case 'units_sold':
			case 'conversion_rate':
			case 'actual':
			case 'target':
			case 'margin_pct':
			case 'metric':
			case 'score':
				return metric;
			case 'created_at':
			case 'completed_at':
			case 'start_date':
			case 'churn_date':
				return temporal;
			case 'lat':
				return lat;
			case 'lon':
				return lon;
			case 'country_col':
			case 'region_col':
			case 'status_col':
			case 'plan_type':
			case 'rating_col':
				return category;
			case 'txn_id':
			case 'customer_id':
			case 'fk_id':
			case 'pk_id':
			case 'source_id':
			case 'target_id':
			case 'parent_id':
				return token === 'source_id' ? sourceId : token === 'target_id' ? targetId : token === 'parent_id' ? parentId : id;
			case 'user_id':
				return userId;
			case 'event_type':
				return chooseColumnByRegex(columns, /(event_type|action|verb|type|status)/i, category);
			case 'is_converted':
			case 'flag_col':
				return binary;
			case 'review_text':
			case 'description':
			case 'body':
			case 'message':
			case 'text_col':
				return text;
			case 'file_path':
				return path;
			case 'url_col':
			case 'image_url':
				return url;
			default:
				return chooseColumnByRegex(columns, new RegExp(token.replace(/_/g, '[_\\s]?'), 'i'), null);
		}
	};
}

function extractPlaceholders(prql: string): string[] {
	const matches = [...prql.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);
	return [...new Set(matches)];
}

export function hydrateSemanticTemplateBundles(input: SemanticTemplateHydrationInput): HydratedSemanticTemplateBundle[] {
	const columns = [...new Set((input.availableColumns ?? []).filter(Boolean))];
	if (columns.length === 0) return [];
	const profiles = input.profileRows ?? [];
	const resolveToken = buildBindingResolver(columns, profiles);
	const out: HydratedSemanticTemplateBundle[] = [];

	for (const template of SEMANTIC_TEMPLATES) {
		const placeholders = extractPlaceholders(template.prqlTemplate);
		const bindings: Record<string, string> = {};
		let unresolved = 0;
		for (const placeholder of placeholders) {
			const resolved = resolveToken(placeholder);
			if (!resolved) {
				unresolved += 1;
				continue;
			}
			bindings[placeholder] = prqlColumnIdentifier(resolved);
		}
		if (placeholders.length > 0 && unresolved > Math.floor(placeholders.length * 0.4)) continue;
		if (placeholders.length > 0 && Object.keys(bindings).length === 0) continue;

		let prql = template.prqlTemplate;
		for (const [token, value] of Object.entries(bindings)) {
			prql = prql.replaceAll(`{${token}}`, value);
		}

		const matchRatio = placeholders.length === 0 ? 1 : Object.keys(bindings).length / placeholders.length;
		out.push({
			id: template.id,
			title: template.title,
			semanticCategory: template.semanticCategory,
			analysisPattern: template.analysisPattern,
			tags: template.tags,
			prql,
			confidence: 0.64 + Math.min(0.32, matchRatio * 0.32),
			bindings
		});
	}

	return out
		.sort((a, b) => b.confidence - a.confidence)
		.slice(0, Math.max(1, input.maxResults ?? 24));
}
