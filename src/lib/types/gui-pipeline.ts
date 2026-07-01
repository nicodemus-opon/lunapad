// ── Filter ───────────────────────────────────────────────────────────────────
export type FilterOp =
	| '=='
	| '!='
	| '>'
	| '>='
	| '<'
	| '<='
	| 'like'
	| 'is null'
	| 'is not null'
	| 'in'
	| 'not in';

export interface FilterCondition {
	column: string;
	op: FilterOp;
	value: string;
}

// ── Derive ───────────────────────────────────────────────────────────────────
export type ExprOp = '+' | '-' | '*' | '/' | '||';
export type ExprFunc =
	| 'coalesce'
	| 'round'
	| 'floor'
	| 'ceil'
	| 'abs'
	| 'lower'
	| 'upper'
	| 'length'
	| 'trim'
	| 'math.abs'
	| 'math.acos'
	| 'math.asin'
	| 'math.atan'
	| 'math.ceil'
	| 'math.cos'
	| 'math.degrees'
	| 'math.exp'
	| 'math.floor'
	| 'math.ln'
	| 'math.log'
	| 'math.log10'
	| 'math.pi'
	| 'math.pow'
	| 'math.radians'
	| 'math.round'
	| 'math.sin'
	| 'math.sqrt'
	| 'math.tan'
	| 'text.contains'
	| 'text.ends_with'
	| 'text.extract'
	| 'text.length'
	| 'text.lower'
	| 'text.ltrim'
	| 'text.replace'
	| 'text.rtrim'
	| 'text.starts_with'
	| 'text.trim'
	| 'text.upper'
	| 'date.now'
	| 'date.to_text'
	| 'date.diff'
	| 'date.trunc';

export interface DeriveOperand {
	kind: 'column' | 'literal';
	value: string;
}

export interface DeriveExprBinary {
	mode: 'binary';
	left: DeriveOperand;
	op: ExprOp;
	right: DeriveOperand;
}

export interface DeriveExprFunc {
	mode: 'func';
	func: ExprFunc;
	args: DeriveOperand[];
}

export interface DeriveExprFString {
	mode: 'fstring';
	template: string;
}

export interface DeriveExprSString {
	mode: 'sstring';
	template: string;
}

export interface DeriveExprRaw {
	mode: 'raw';
	expr: string;
}

export type DeriveExpr =
	| DeriveExprBinary
	| DeriveExprFunc
	| DeriveExprFString
	| DeriveExprSString
	| DeriveExprRaw;

export interface DeriveColumn {
	name: string;
	expr: DeriveExpr;
}

// ── Group / Aggregate ────────────────────────────────────────────────────────
export type AggFunc =
	| 'sum'
	| 'avg'
	| 'average'
	| 'count'
	| 'count_distinct'
	| 'min'
	| 'max'
	| 'first'
	| 'last'
	| 'stddev'
	| 'all'
	| 'any'
	| 'concat_array'
	| 'raw';

export interface AggregationRow {
	name: string; // empty string = no alias in output
	func: AggFunc;
	column: string;
	expr?: string;
}

/** Body used by window-function groups: sort + derive (instead of aggregate). */
export interface GroupWindowBody {
	sortKeys: SortKey[];
	derives: DeriveColumn[];
}

// ── Sort ─────────────────────────────────────────────────────────────────────
export interface SortKey {
	column: string;
	dir: 'asc' | 'desc';
}

// ── Join ─────────────────────────────────────────────────────────────────────
export type JoinType = 'inner' | 'left' | 'right' | 'full';

export interface JoinCondition {
	left: string;
	right: string;
	shorthand?: boolean; // true → generates (==col) syntax
}

export interface GUISourceSchema {
	name: string;
	columns: string[];
}

// ── Stage union ──────────────────────────────────────────────────────────────
export interface FromStage {
	type: 'from';
	table: string;
	alias?: string; // e.g. t in `from t=tracks`
	disabled?: boolean;
}

export interface FilterStage {
	type: 'filter';
	conditions: FilterCondition[];
	logic: 'and' | 'or';
	disabled?: boolean;
}

export interface SelectStage {
	type: 'select';
	columns: string[];
	disabled?: boolean;
}

export interface DeriveStage {
	type: 'derive';
	columns: DeriveColumn[];
	disabled?: boolean;
}

export interface GroupStage {
	type: 'group';
	by: string[];
	aggregations: AggregationRow[];
	/** Optional per-group row cap used by docs-style distinct patterns: group ... (take 1). */
	take?: number;
	/** Present when the group body uses sort + derive (window functions) instead of aggregate. */
	window?: GroupWindowBody;
	disabled?: boolean;
}

export interface SortStage {
	type: 'sort';
	keys: SortKey[];
	disabled?: boolean;
}

export interface TakeStage {
	type: 'take';
	n: number;
	rangeFrom?: number; // set when using range syntax: take rangeFrom..n
	disabled?: boolean;
}

export interface JoinStage {
	type: 'join';
	joinType: JoinType;
	table: string;
	alias?: string; // table alias, e.g. c in join c=customers
	conditions: JoinCondition[];
	disabled?: boolean;
}

export interface AppendStage {
	type: 'append';
	sources: string[];
	disabled?: boolean;
}

export interface WindowStage {
	type: 'window';
	frame: string;
	sortKeys: SortKey[];
	derives: DeriveColumn[];
	disabled?: boolean;
}

export type LoopMiniStage = FilterStage | SelectStage | DeriveStage | SortStage | TakeStage;

export interface LoopStage {
	type: 'loop';
	body: string;
	mode?: 'raw' | 'structured';
	structuredBody?: LoopMiniStage[];
	disabled?: boolean;
}

/** Catch-all stage for valid PRQL that the GUI can't parse structurally. Round-trips faithfully. */
export interface RawStage {
	type: 'raw';
	prql: string;
	disabled?: boolean;
}

export type GUIPipelineStage =
	| FromStage
	| AppendStage
	| FilterStage
	| SelectStage
	| DeriveStage
	| GroupStage
	| WindowStage
	| LoopStage
	| SortStage
	| TakeStage
	| JoinStage
	| RawStage;

export type StageType = GUIPipelineStage['type'];

// ── Chart Config ─────────────────────────────────────────────────────────────
export type ChartType =
	| 'table'
	| 'big-value'
	| 'delta'
	| 'value'
	| 'line'
	| 'bar'
	| 'bar-horizontal'
	| 'area'
	| 'scatter'
	| 'bubble'
	| 'pie'
	| 'histogram'
	| 'heatmap'
	| 'calendar-heatmap'
	| 'funnel'
	| 'box-plot'
	| 'sankey'
	| 'custom';

export type ChartSeriesMode = 'auto' | 'grouped' | 'stacked';

export interface ChartRecommendationMeta {
	reason?: string;
	confidence?: number;
	signature?: string;
}

export type ChartSortOrder = 'none' | 'asc' | 'desc';

export interface ChartConfig {
	chartType: ChartType;
	xColumn: string;
	yColumns: string[];
	colorColumn: string | null;
	sizeColumn?: string | null;
	yColumnsSecondary?: string[];
	seriesMode?: ChartSeriesMode;
	sortOrder?: ChartSortOrder;
	histogramBins?: number;
	title?: string;
	description?: string;
	recommendation?: ChartRecommendationMeta | null;
	// custom: a Plot spec written in JS, evaluated with `rows`/`columns`/`Plot` in scope
	code?: string;
	// Evidence.dev data component extras
	// big-value: xColumn=value col, yColumns[0]=comparison col, colorColumn=sparkline date col
	// delta: xColumn=delta col; deltaDownIsGood=true reverses coloring
	deltaDownIsGood?: boolean;
	// value: xColumn=value col, valueRow=row index (default 0)
	valueRow?: number;
	// table / DataTable: rows per page, search enabled
	tableRows?: number;
	tableSearch?: boolean;
}

export type ResultViewMode = 'table' | 'chart' | 'stats';
