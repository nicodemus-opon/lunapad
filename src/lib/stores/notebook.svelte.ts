import { compilePRQL, type PRQLError } from '$lib/services/prql';
import {
	buildExecutionCode,
	buildGlobalExecutionCode,
	buildSQLExecutionCode,
	buildSQLGlobalExecutionCode,
	resolveDependencies,
	resolveGlobalDependencies
} from '$lib/services/cell-deps';
import { parseUdfSignature } from '$lib/services/udf';
import { substituteFilterTokens } from '$lib/services/filter-substitution';
import { maskDollarQuotedBlocks } from '$lib/utils/sql-dollar-quote';
import { deconflictName } from '$lib/utils/deconflict';
import { serializeCell as serializeCellToFile } from '$lib/services/prql-file';
import { serializeLunaFile } from '$lib/services/luna-file';
import {
	openProject as openProjectAPI,
	listProjectNotebooks,
	writeProjectFile,
	deleteProjectFile,
	renameProjectFile,
	watchProjectFolder,
	fetchDbtManifest,
	dbtTest,
	watchDbtLogs,
	updateProjectSchema,
	auditProject,
	backfillSchemaFromManifest,
	promoteCells,
	scaffoldProject,
	type PromotePlanItem,
	type PromoteResult
} from '$lib/services/project-client';
import type { DbtModel } from '$lib/server/dbt';
import type { DbtSchedule } from '$lib/types/schedule';
import {
	cancelConnectionQuery,
	materializeConnectionRelation,
	queryConnectionSQL,
	syncConnectionMetadata
} from '$lib/services/connections';
import {
	executeSQL,
	createView,
	dropView,
	setPrevView,
	dropRelation,
	materializeRelation,
	listMainSchemaRelations,
	type MaterializationMode as DBMaterializationMode,
	type RelationType
} from '$lib/services/duckdb';
import {
	getCellOutputReference,
	getPreviousCellOutputReference,
	makeInheritedGuiCode,
	makeInheritedGuiStages
} from '$lib/services/gui-defaults';
import {
	buildNotebookIntelligence,
	extractTablesTouched,
	type NotebookIntelligence,
	type SchemaTable
} from '$lib/services/notebook-intelligence';
import {
	recordCellExecutionMetadata,
	recordUploadedTableMetadata
} from '$lib/services/intelligence-db';
import { guiToPreql } from '$lib/services/gui-prql';
import {
	BUILTIN_DUCKDB_CONNECTION,
	BUILTIN_DUCKDB_CONNECTION_ID,
	getPRQLTargetForConnection,
	isBuiltinDuckDBConnection,
	resolveConnection,
	slugifyCatalogName,
	type BigQueryConnection,
	type CassandraConnection,
	type Connection,
	type ConnectionSecret,
	type ElasticsearchConnection,
	type GoogleSheetsConnection,
	type MariaDBConnection,
	type MongoDBConnection,
	type MySQLDataSource,
	type OracleConnection,
	type PRQLTarget,
	type RedshiftConnection,
	type SingleStoreConnection,
	type SnowflakeConnection,
	type SQLServerConnection
} from '$lib/types/connection';
import type { GUIPipelineStage } from '$lib/types/gui-pipeline';
import type { ChartConfig } from '$lib/types/gui-pipeline';
import type { ResultViewMode } from '$lib/types/gui-pipeline';
import {
	getWorkspaceStandards,
	setWorkspaceStandards,
	type WorkspaceStandards
} from './ai-chat.svelte';

export type CellStatus = 'idle' | 'running' | 'success' | 'error';
export type CellEditMode = 'gui' | 'prql';
export type CellType = 'query' | 'markdown' | 'udf';
export type CellMaterializationMode = DBMaterializationMode | 'ephemeral';
export type CellMaterializationStatus = 'idle' | 'running' | 'success' | 'error';
export type CellScheduleStatus = 'idle' | 'running' | 'success' | 'error';
export type CellScheduleScope = 'cell' | 'segment';
export type CellTestStatus = 'idle' | 'running' | 'pass' | 'fail';

export interface DbtTestResult {
	testName: string;
	column: string | null;
	status: 'pass' | 'fail';
	message?: string;
}

export type CellLanguage = 'prql' | 'sql';

// 'full' shows code + result, 'output' hides the code (reading mode),
// 'collapsed' reduces the cell to a one-line summary row.
export type CellDisplay = 'full' | 'output' | 'collapsed';

export interface Cell {
	id: string;
	cellType: CellType;
	connectionId: string | null;
	outputName: string;
	code: string;
	markdown: string;
	markdownPreview: boolean;
	// Python source for cellType 'udf'. Name/params/return type are parsed from
	// type hints (see services/udf.ts), not stored separately.
	udfBody: string;
	language: CellLanguage;
	status: CellStatus;
	result: { rows: Record<string, unknown>[]; columns: string[]; truncated?: boolean } | null;
	errors: PRQLError[];
	compiledSQL: string | null;
	executionMs: number | null;
	guiStages: GUIPipelineStage[];
	editMode: CellEditMode;
	resultViewMode: ResultViewMode;
	resultChartConfig: ChartConfig | null;
	display: CellDisplay;
	stageResultsCollapsed: boolean[];
	materializeMode: CellMaterializationMode;
	materializeTarget: string;
	materializeStatus: CellMaterializationStatus;
	materializeError: string | null;
	materializedRelationType: RelationType | null;
	// dbt model configuration (only relevant in filesystem/dbt project mode)
	description: string | null;
	dbtSchema: string | null;
	dbtTags: string[];
	// Set when this cell has been promoted out of its .luna notebook into its own
	// real model file (relative path from the project root). Promoted cells render
	// as a `{% model ref %}` placeholder in the originating .luna source.
	promotedModelPath: string | null;
	dbtTestStatus: CellTestStatus;
	dbtTestResults: DbtTestResult[];
	dbtTestLog: string[];
	scheduleEnabled: boolean;
	scheduleIntervalMinutes: number;
	scheduleScope: CellScheduleScope;
	scheduleStatus: CellScheduleStatus;
	scheduleLastRunAt: number | null;
	scheduleNextRunAt: number | null;
	scheduleLastError: string | null;
	intelligence: NotebookIntelligence | null;
	needsRun: boolean;
	staleReason: 'code-changed' | 'upstream-changed' | null;
	staleSources: string[]; // outputNames of upstream cells whose runs caused this cell to be stale
	lastRunAt: number | null;
}

export interface NotebookEvent {
	id: string;
	ts: number;
	notebookId: string;
	cellId: string;
	connectionId: string;
	eventType: 'run-success' | 'run-error';
	codeHash: string;
	runtimeMs: number | null;
	rowCount: number;
	columnCount: number;
	tablesTouched: string[];
}

export interface UploadedTable {
	name: string;
	fileName: string;
	rowCount: number;
	columns: string[];
	columnTypes: string[];
	relationType?: RelationType;
}

export interface ExternalSchemaTable {
	connectionId: string;
	connectionName: string;
	name: string;
	schema?: string;
	columns: string[];
	columnTypes: string[];
}

export interface Notebook {
	id: string;
	name: string;
	folderId: string | null;
	cells: Cell[];
	defaultCellLanguage: CellLanguage;
	// 'luna' notebooks are backed by a single `<id>.luna` file (multi-cell, Markdoc-
	// flavored prose + query cells in document order) — this is the default
	// authoring format for new notebooks. Unset/'flat' notebooks keep the
	// one-file-per-cell `.prql`/`.sql` representation: either a pre-existing model
	// file loaded from disk, or the result of explicitly promoting a `.luna` cell
	// to a standalone dbt model (see `promoteCellChain`).
	format?: 'luna' | 'flat';
	// Presentation flag: render every query cell as output-only with chrome
	// hidden (errors excepted). Does not mutate per-cell display.
	reportView?: boolean;
	// Last cell scrolled to via sidebar navigation — restored on tab re-open.
	lastActiveCellId?: string;
	// Current values for {% filter param="..." /%} controls declared in markdown cells, keyed by paramName.
	filters?: Record<string, string>;
	// When set (ms), all query cells in this notebook re-run on this interval. 0/undefined = off.
	autoRefreshIntervalMs?: number;
}

export interface NotebookFolder {
	id: string;
	name: string;
	parentId: string | null;
}

export type SidebarSection = 'notebooks' | 'tables';

export interface SidebarSectionsExpanded {
	notebooks: boolean;
	tables: boolean;
}

export interface ResultTabInfo {
	id: string;
	cellId: string;
	notebookId: string;
	name: string;
	viewMode: ResultViewMode;
	chartConfig: ChartConfig | null;
}

export interface ExtraTab {
	id: string;
	type: 'table-view' | 'profile' | 'lineage' | 'evidence-preview';
	tableName: string;
	name: string;
	viewMode: ResultViewMode;
	chartConfig: ChartConfig | null;
	// For lineage tabs: which model to center on (optional)
	focusedModelName?: string;
	// For evidence-preview tabs
	pagePath?: string;
}

export interface LLMConfig {
	provider: 'openapi-compatible' | 'ollama';
	baseUrl: string;
	model: string;
	apiKey?: string;
}

interface NotebookState {
	notebooks: Notebook[];
	folders: NotebookFolder[];
	connections: Connection[];
	externalSchemaTables: ExternalSchemaTable[];
	openNotebookTabIds: string[];
	expandedNotebookFolderIds: string[];
	expandedNotebookIds: string[];
	sidebarSectionsExpanded: SidebarSectionsExpanded;
	activeTabId: string;
	focusedCellId: string | null;
	openResultTabs: ResultTabInfo[];
	openExtraTabs: ExtraTab[];
	tables: UploadedTable[];
	theme: 'light' | 'dark' | 'system';
	autoRun: boolean;
	llmConfig: LLMConfig;
	notebookEvents: NotebookEvent[];
	// 'idle' until initWorkspaceMode() runs; otherwise reflects the last /api/workspace/*
	// load or save attempt — drives the "offline copy" / "couldn't save, retrying" banner.
	workspaceSyncStatus: 'idle' | 'synced' | 'offline' | 'error';
	// ── Filesystem / dbt project mode ──
	storageMode: 'local' | 'filesystem';
	projectFolder: string | null;
	isDbtProject: boolean;
	dbtModels: DbtModel[];
	dbtLastCompileAt: number | null;
	dbtRunningJobId: string | null;
	dbtSchedules: DbtSchedule[];
	// ── Evidence.dev project mode ──
	isEvidenceProject: boolean;
	evidenceRunningJobId: string | null;
	evidenceDevPort: number | null;
	evidencePages: string[];
}

const GUI_COMPILE_DEBOUNCE_MS = 120;
const SCHEDULE_POLL_MS = 30_000;
const MIN_SCHEDULE_INTERVAL_MINUTES = 1;
const MAX_SCHEDULE_INTERVAL_MINUTES = 24 * 60;
const guiCompileTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cellRunControllers = new Map<string, AbortController>();
const cellRunIds = new Map<string, string>(); // cellId → runId for server-side cancel
const MAX_COMPILE_CACHE_SIZE = 200;
const compileCache = new Map<string, { sql: string | null; errors: PRQLError[] }>();
const STORAGE_KEY = 'lunapad_notebook';
const PROJECT_FOLDER_KEY = 'lunapad_project_folder';
let schedulePollTimer: ReturnType<typeof setInterval> | null = null;
let scheduleRunInFlight = false;

// Whether to treat Postgres (via /api/workspace/*) as the source of truth for workspace
// content, with localStorage as a cache/offline fallback, instead of localStorage alone.
// False in demo mode (DEMO_MODE=1 — no auth, no Postgres at all) and by default until
// +page.svelte calls initWorkspaceMode() with the server-supplied demoMode flag, since
// DEMO_MODE is a server-only env var the client has no other way to see.
let useServerWorkspace = false;
export function initWorkspaceMode(demoMode: boolean): void {
	useServerWorkspace = !demoMode;
}

function clampScheduleIntervalMinutes(value: number): number {
	if (!Number.isFinite(value)) return MIN_SCHEDULE_INTERVAL_MINUTES;
	const normalized = Math.round(value);
	if (normalized < MIN_SCHEDULE_INTERVAL_MINUTES) return MIN_SCHEDULE_INTERVAL_MINUTES;
	if (normalized > MAX_SCHEDULE_INTERVAL_MINUTES) return MAX_SCHEDULE_INTERVAL_MINUTES;
	return normalized;
}

function computeNextRunAt(now: number, intervalMinutes: number): number {
	return now + intervalMinutes * 60_000;
}

function makeCompileCacheKey(fullCode: string, target: string): string {
	return `${target}\n${fullCode}`;
}

function cloneErrors(errors: PRQLError[]): PRQLError[] {
	return errors.map((error) => ({ ...error }));
}

/**
 * Parses a Postgres or ClickHouse error message to extract a [from, to] span
 * into the user's original cell code. Returns null if no position info found.
 *
 * Postgres format:  "ERROR: ... LINE N: ..."  (caret on next line)
 * ClickHouse format: "... (line N, col M)."
 */
function parseSQLErrorSpan(
	message: string,
	cellCode: string,
	fullSQL: string
): [number, number] | null {
	let errorLine: number | null = null;
	let errorCol: number | null = null;

	// Postgres: "LINE N:"
	const pgMatch = message.match(/\bLINE (\d+):/);
	if (pgMatch) {
		errorLine = parseInt(pgMatch[1], 10);
		// caret position on the line after "LINE N:  ..."
		const msgLines = message.split('\n');
		const lineIdx = msgLines.findIndex((l) => l.match(/\bLINE \d+:/));
		if (lineIdx >= 0) {
			// next line is the SQL snippet, the one after has the ^ position
			const caretLine = msgLines[lineIdx + 2] ?? '';
			const caretPos = caretLine.indexOf('^');
			if (caretPos >= 0) errorCol = caretPos + 1;
		}
	}

	// ClickHouse: "(line N, col M)" or "(line N, column M)"
	if (errorLine === null) {
		const chMatch = message.match(/\(line (\d+),\s*col(?:umn)?\s*(\d+)\)/i);
		if (chMatch) {
			errorLine = parseInt(chMatch[1], 10);
			errorCol = parseInt(chMatch[2], 10);
		}
	}

	if (errorLine === null) return null;

	// Compute how many lines the CTE prefix adds before the user's cell code.
	// fullSQL = "WITH ...\n<cellCode>" or just "<cellCode>".
	const trimmedCell = cellCode.trim();
	const cellStartInFull = fullSQL.indexOf(trimmedCell.split('\n')[0]);
	const ctePrefix = cellStartInFull > 0 ? fullSQL.substring(0, cellStartInFull) : '';
	const cteLineOffset = ctePrefix ? ctePrefix.split('\n').length - 1 : 0;

	const userLine = errorLine - cteLineOffset;
	if (userLine < 1) return null;

	const codeLines = cellCode.split('\n');
	let charPos = 0;
	for (let i = 0; i < userLine - 1 && i < codeLines.length; i++) {
		charPos += codeLines[i].length + 1; // +1 for newline
	}

	const lineText = codeLines[userLine - 1] ?? '';
	const col = errorCol != null ? Math.max(0, errorCol - 1) : 0;
	const from = Math.min(charPos + col, cellCode.length);
	// Highlight to end of the token (next whitespace) or end of line
	const tokenEnd = lineText.slice(col).search(/\s/);
	const to = tokenEnd > 0 ? from + tokenEnd : Math.min(charPos + lineText.length, cellCode.length);

	if (from === to) return [from, Math.min(from + 1, cellCode.length)];
	return [from, to];
}

export function compilePRQLCached(
	fullCode: string,
	target: PRQLTarget
): { sql: string | null; errors: PRQLError[] } {
	const key = makeCompileCacheKey(fullCode, target);
	const cached = compileCache.get(key);
	if (cached) {
		return { sql: cached.sql, errors: cloneErrors(cached.errors) };
	}

	const compiled = compilePRQL(fullCode, target);
	compileCache.set(key, { sql: compiled.sql, errors: cloneErrors(compiled.errors) });
	if (compileCache.size > MAX_COMPILE_CACHE_SIZE) {
		const oldestKey = compileCache.keys().next().value;
		if (oldestKey) compileCache.delete(oldestKey);
	}
	return compiled;
}

function makeId(): string {
	return Math.random().toString(36).slice(2, 10);
}

function makeCell(code = '', outputName = '', language: CellLanguage = 'prql'): Cell {
	return {
		id: makeId(),
		cellType: 'query',
		connectionId: null,
		outputName,
		code,
		markdown: '',
		markdownPreview: false,
		udfBody: '',
		language,
		status: 'idle',
		result: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: [{ type: 'from', table: '' }],
		// GUI mode is a PRQL feature (updateGuiStages writes PRQL into cell.code)
		editMode: language === 'sql' ? 'prql' : 'gui',
		resultViewMode: 'table',
		resultChartConfig: null,
		display: 'full',
		stageResultsCollapsed: [],
		materializeMode: 'table',
		materializeTarget: outputName,
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description: null,
		dbtSchema: null,
		dbtTags: [],
		promotedModelPath: null,
		dbtTestStatus: 'idle',
		dbtTestResults: [],
		dbtTestLog: [],
		scheduleEnabled: false,
		scheduleIntervalMinutes: 60,
		scheduleScope: 'cell',
		scheduleStatus: 'idle',
		scheduleLastRunAt: null,
		scheduleNextRunAt: null,
		scheduleLastError: null,
		intelligence: null,
		needsRun: false,
		staleReason: null,
		staleSources: [],
		lastRunAt: null
	};
}

function makeMarkdownCell(markdown = ''): Cell {
	return {
		...makeCell('', ''),
		cellType: 'markdown',
		markdown,
		markdownPreview: false,
		editMode: 'prql'
	};
}

const DEFAULT_UDF_BODY = `def my_udf(x: int) -> float:\n    return x * 1.5\n`;

function makeUdfCell(udfBody = DEFAULT_UDF_BODY): Cell {
	const sig = parseUdfSignature(udfBody);
	const outputName = 'error' in sig ? '' : sig.name;
	return {
		...makeCell('', outputName, 'sql'),
		cellType: 'udf',
		udfBody,
		editMode: 'prql'
	};
}

function makeNotebook(name: string, cells?: Cell[]): Notebook {
	return {
		id: makeId(),
		name,
		folderId: null,
		cells: cells ?? [makeCell('', 'result1', 'sql')],
		defaultCellLanguage: 'sql',
		filters: {}
	};
}

function makeDemoNotebook(): Notebook {
	// Pure SELECT so the execution engine can wrap it as a view.
	// PRQL downstream cells inline this via: let orders = (s"SELECT ...")
	const seedSQL = `SELECT
  range + 1 AS order_id,
  DATE '2023-01-01' + CAST((range * 13 % 730) AS INTEGER) * INTERVAL '1 day' AS order_date,
  (['Laptop','Phone','Tablet','Monitor','Keyboard','Mouse','Headset','Webcam'])[(range % 8) + 1] AS product,
  (['Electronics','Electronics','Electronics','Peripherals','Peripherals','Peripherals','Peripherals','Peripherals'])[(range % 8) + 1] AS category,
  1 + (range * 7 % 4) AS quantity,
  ([1200.0, 799.0, 449.0, 349.0, 79.0, 39.0, 149.0, 89.0])[(range % 8) + 1] AS unit_price,
  (['North','South','East','West','Central'])[(range % 5) + 1] AS region
FROM range(2000)`;

	// target_region (not "region") so the post-join schema has only one
	// unqualified `region` column — joining on same-named columns leaves both
	// table's copies in scope and makes `group region (...)` ambiguous.
	const regionTargetsSQL = `SELECT * FROM (VALUES
  ('North', 150000.0),
  ('South', 120000.0),
  ('East', 130000.0),
  ('West', 140000.0),
  ('Central', 100000.0)
) AS t(target_region, quota)`;

	const monthlyRevenuePRQL = `from orders
derive {
  month = s"date_trunc('month', order_date)",
  revenue = quantity * unit_price
}
group month (
  aggregate {
    total_revenue = sum revenue,
    order_count = count this
  }
)
sort month`;

	const regionPerformancePRQL = `from o=orders
derive { revenue = quantity * unit_price }
join rt=region_targets (this.region==rt.target_region)
group o.region (
  aggregate { total_revenue = sum revenue, quota = max rt.quota }
)
sort {-total_revenue}`;

	const categoryPRQL = `from orders
derive revenue = quantity * unit_price
group category (
  aggregate {
    total_revenue = sum revenue,
    order_count = count this
  }
)
sort {-total_revenue}`;

	const orderValueDistributionPRQL = `from orders
derive revenue = quantity * unit_price
select { revenue }`;

	const topProductsPRQL = `from orders
derive revenue = quantity * unit_price
group product (
  aggregate {
    total_revenue = sum revenue,
    units_sold = sum quantity
  }
)
sort {-total_revenue}
take 10`;

	const growthSQL = `SELECT
  month,
  total_revenue,
  total_revenue - LAG(total_revenue) OVER (ORDER BY month) AS mom_delta,
  ROUND(100.0 * (total_revenue - LAG(total_revenue) OVER (ORDER BY month))
        / NULLIF(LAG(total_revenue) OVER (ORDER BY month), 0), 1) AS mom_pct
FROM monthly_revenue
ORDER BY month`;

	const regionFilteredOrdersSQL = `SELECT region, product, category, quantity, unit_price, order_date
FROM orders
WHERE region = '\${region}'
ORDER BY order_date DESC
LIMIT 20`;

	const cells: Cell[] = [
		{
			...makeMarkdownCell(
				`# Sales Analytics Demo\nThis notebook shows the core features of Lunapad. Run cells from top to bottom — start with the **orders** cell, then explore the analysis cells below.\n\n{% callout type="info" %}\nCells reference each other by name — no boilerplate \`WITH\` needed. Charts, the GUI pipeline builder, Markdoc dashboards, and interactive filters are all live below.\n{% /callout %}`
			),
			markdownPreview: true
		},
		{
			...makeCell(seedSQL, 'orders', 'sql'),
			editMode: 'prql',
			resultViewMode: 'stats'
		},
		{
			...makeCell(regionTargetsSQL, 'region_targets', 'sql'),
			editMode: 'prql'
		},
		{
			...makeCell(monthlyRevenuePRQL, 'monthly_revenue', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'area',
				xColumn: 'month',
				yColumns: ['total_revenue'],
				colorColumn: null,
				title: 'Monthly Revenue'
			} satisfies ChartConfig
		},
		{
			...makeCell(regionPerformancePRQL, 'region_performance', 'prql'),
			editMode: 'gui',
			guiStages: [
				{ type: 'from', table: 'orders', alias: 'o' },
				{
					type: 'derive',
					columns: [
						{
							name: 'revenue',
							expr: {
								mode: 'binary',
								left: { kind: 'column', value: 'quantity' },
								op: '*',
								right: { kind: 'column', value: 'unit_price' }
							}
						}
					]
				},
				{
					type: 'join',
					joinType: 'left',
					table: 'region_targets',
					alias: 'rt',
					conditions: [{ left: 'this.region', right: 'target_region' }]
				},
				{
					type: 'group',
					by: ['o.region'],
					aggregations: [
						{ name: 'total_revenue', func: 'sum', column: 'revenue' },
						{ name: 'quota', func: 'max', column: 'rt.quota' }
					]
				},
				{ type: 'sort', keys: [{ column: 'total_revenue', dir: 'desc' }] }
			] as GUIPipelineStage[],
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar',
				xColumn: 'region',
				yColumns: ['total_revenue', 'quota'],
				colorColumn: null,
				seriesMode: 'grouped',
				title: 'Revenue vs Quota by Region'
			} satisfies ChartConfig
		},
		{
			...makeCell(categoryPRQL, 'category_breakdown', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar',
				xColumn: 'category',
				yColumns: ['total_revenue', 'order_count'],
				colorColumn: null,
				title: 'Revenue by Category'
			} satisfies ChartConfig
		},
		{
			...makeCell(orderValueDistributionPRQL, 'order_value_distribution', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'histogram',
				xColumn: '',
				yColumns: ['revenue'],
				histogramBins: 24,
				colorColumn: null,
				title: 'Order Value Distribution'
			} satisfies ChartConfig
		},
		{
			...makeCell(topProductsPRQL, 'top_products', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar-horizontal',
				xColumn: 'product',
				yColumns: ['total_revenue'],
				colorColumn: null,
				title: 'Top Products by Revenue'
			} satisfies ChartConfig
		},
		{
			...makeCell(growthSQL, 'growth_analysis', 'sql'),
			editMode: 'prql',
			resultViewMode: 'table'
		},
		{
			...makeMarkdownCell(
				`## Explore by region\n{% filter kind="dropdown" param="region" label="Region" options=["North","South","East","West","Central"] default="North" /%}\n\n{% grid cols=3 %}\n{% metric value=$category_breakdown.total_revenue label="Top Category Revenue" format="currency" /%}\n{% metric value=$region_performance.total_revenue vs=$region_performance.quota label="Top Region vs Quota" format="currency" /%}\n{% metric value=$top_products.total_revenue label="Best-Selling Product Revenue" format="currency" /%}\n{% /grid %}\n\n{% datatable data=$top_products.rows cols=["product","total_revenue","units_sold"] limit=10 /%}`
			),
			markdownPreview: true
		},
		{
			...makeCell(regionFilteredOrdersSQL, 'region_filtered_orders', 'sql'),
			editMode: 'prql',
			resultViewMode: 'table'
		},
		{
			...makeMarkdownCell(
				`## What you just ran\n- **PRQL & SQL cells** referencing each other as CTEs — no boilerplate \`WITH\` needed\n- **GUI pipeline editor** (\`region_performance\`) — includes a join, not just filter/derive/group\n- **Stats view** (\`orders\`) — per-column min/max/null/distinct counts, switch back to table anytime\n- **Chart variety** — area, grouped bar, horizontal bar, and histogram via each cell's view toolbar\n- **Markdoc dashboards** — the section above mixes a live filter, metric cards, and a data table in one markdown cell\n- **Interactive filters** — the region dropdown re-runs \`region_filtered_orders\` automatically\n- **UDF cells** also exist (Python, type-hinted) but need a Trino-backed connection (Postgres/ClickHouse/MySQL) — not shown here since this demo runs entirely on the builtin DuckDB engine`
			),
			markdownPreview: true
		}
	];

	return {
		id: makeId(),
		name: 'Sales Analytics Demo',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: { region: 'North' }
	};
}

export function loadDemoNotebook(): void {
	const n = makeDemoNotebook();
	n.folderId = ensureDefaultFolder();
	state.notebooks = [...state.notebooks, n];
	if (!state.openNotebookTabIds.includes(n.id)) {
		state.openNotebookTabIds = [...state.openNotebookTabIds, n.id];
	}
	state.activeTabId = n.id;
	scheduleSave();
}

// ── Active-cell insert bridge ───────────────────────────────────────────────
let _insertCallback = $state<((text: string) => void) | null>(null);

export function registerInsertCallback(fn: ((text: string) => void) | null): void {
	_insertCallback = fn;
}

export function insertIntoActiveCell(text: string): void {
	_insertCallback?.(text);
}

// ── Reactive state ──────────────────────────────────────────────────────────
const _initialFolder: NotebookFolder = { id: makeId(), name: 'Notebooks', parentId: null };
const _initialNotebook = makeNotebook('Notebook 1');
_initialNotebook.folderId = _initialFolder.id;
let state = $state<NotebookState>({
	notebooks: [_initialNotebook],
	folders: [_initialFolder],
	connections: [BUILTIN_DUCKDB_CONNECTION],
	externalSchemaTables: [],
	openNotebookTabIds: [_initialNotebook.id],
	expandedNotebookFolderIds: [],
	expandedNotebookIds: [],
	sidebarSectionsExpanded: {
		notebooks: true,
		tables: true
	},
	activeTabId: _initialNotebook.id,
	focusedCellId: null,
	openResultTabs: [],
	openExtraTabs: [],
	tables: [],
	theme: 'system',
	autoRun: false,
	llmConfig: {
		provider: 'ollama',
		baseUrl: 'http://127.0.0.1:11434',
		model: 'qwen3:4b'
	},
	notebookEvents: [],
	workspaceSyncStatus: 'idle',
	storageMode: 'local',
	projectFolder: null,
	isDbtProject: false,
	dbtModels: [],
	dbtLastCompileAt: null,
	dbtRunningJobId: null,
	dbtSchedules: [],
	isEvidenceProject: false,
	evidenceRunningJobId: null,
	evidenceDevPort: null,
	evidencePages: []
});

// ── Persistence ─────────────────────────────────────────────────────────────
type SerializedCell = Omit<Cell, 'errors' | 'needsRun' | 'staleReason' | 'staleSources'> & {
	errors: [];
	needsRun: boolean;
	staleReason: null;
	staleSources: [];
};

// Caps for persisting query results to localStorage. Results are kept so output survives
// reload/HMR (the main "output disappeared" complaint), but oversized results are dropped to
// avoid blowing the ~5MB localStorage quota — the cell is marked needsRun so the UI offers a re-run.
const PERSIST_RESULT_ROW_CAP = 2000;
const PERSIST_RESULT_BYTE_CAP = 256 * 1024;

function serializeCell(c: Cell, persistResults = true): SerializedCell {
	let result: Cell['result'] = null;
	let status: Cell['status'] = 'idle';
	let needsRun = Boolean(c.needsRun);
	if (persistResults && c.status === 'success' && c.result) {
		const rowCount = c.result.rows?.length ?? 0;
		let withinCap = rowCount <= PERSIST_RESULT_ROW_CAP;
		if (withinCap) {
			try {
				withinCap = JSON.stringify(c.result).length <= PERSIST_RESULT_BYTE_CAP;
			} catch {
				withinCap = false;
			}
		}
		if (withinCap) {
			result = c.result;
			status = 'success';
			needsRun = false;
		} else {
			needsRun = true; // result too big to persist — prompt a re-run on reload
		}
	}
	return { ...c, status, result, errors: [], needsRun, staleReason: null, staleSources: [] };
}

function serialize(persistResults = true): string {
	return JSON.stringify({
		notebooks: state.notebooks.map((n) => ({
			...n,
			cells: n.cells.map((c) => serializeCell(c, persistResults))
		})),
		folders: state.folders,
		connections: state.connections,
		externalSchemaTables: state.externalSchemaTables,
		openNotebookTabIds: state.openNotebookTabIds,
		expandedNotebookFolderIds: state.expandedNotebookFolderIds,
		expandedNotebookIds: state.expandedNotebookIds,
		sidebarSectionsExpanded: state.sidebarSectionsExpanded,
		activeTabId: state.activeTabId,
		openResultTabs: state.openResultTabs,
		tables: state.tables,
		theme: state.theme,
		autoRun: state.autoRun,
		llmConfig: state.llmConfig,
		notebookEvents: state.notebookEvents,
		workspaceStandards: getWorkspaceStandards()
	});
}

function sanitizeConnections(raw: unknown): Connection[] {
	if (!Array.isArray(raw)) return [BUILTIN_DUCKDB_CONNECTION];

	const connections: Connection[] = [BUILTIN_DUCKDB_CONNECTION];
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const candidate = entry as Partial<Connection>;
		if (candidate.type === 'duckdb-wasm') continue;
		if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') continue;

		if (
			candidate.type === 'postgres' &&
			typeof candidate.host === 'string' &&
			typeof candidate.port === 'number' &&
			typeof candidate.database === 'string' &&
			typeof candidate.username === 'string'
		) {
			const pgSslMode = (candidate as Record<string, unknown>).sslMode;
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'postgres',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				host: candidate.host,
				port: candidate.port,
				database: candidate.database,
				username: candidate.username,
				ssl: Boolean(candidate.ssl),
				sslMode: pgSslMode === 'require' || pgSslMode === 'verify-full' ? pgSslMode : undefined
			});
			continue;
		}

		if (
			candidate.type === 'clickhouse' &&
			typeof candidate.host === 'string' &&
			typeof candidate.port === 'number' &&
			typeof candidate.database === 'string' &&
			typeof candidate.username === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'clickhouse',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				host: candidate.host,
				port: candidate.port,
				database: candidate.database,
				username: candidate.username,
				secure: Boolean(candidate.secure)
			});
			continue;
		}

		if (
			candidate.type === 'mysql' &&
			typeof candidate.host === 'string' &&
			typeof candidate.port === 'number' &&
			typeof candidate.database === 'string' &&
			typeof candidate.username === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'mysql',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				host: candidate.host,
				port: candidate.port,
				database: candidate.database,
				username: candidate.username,
				ssl: Boolean((candidate as Partial<MySQLDataSource>).ssl)
			} satisfies MySQLDataSource);
			continue;
		}

		if (
			(candidate.type === 'mariadb' ||
				candidate.type === 'redshift' ||
				candidate.type === 'singlestore') &&
			typeof candidate.host === 'string' &&
			typeof candidate.port === 'number' &&
			typeof candidate.database === 'string' &&
			typeof candidate.username === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			const catalogName =
				typeof rawCatalogName === 'string' && rawCatalogName
					? rawCatalogName
					: slugifyCatalogName(candidate.name);
			const ssl = Boolean((candidate as Record<string, unknown>).ssl);
			if (candidate.type === 'mariadb') {
				connections.push({
					id: candidate.id,
					name: candidate.name,
					type: 'mariadb',
					catalogName,
					host: candidate.host,
					port: candidate.port,
					database: candidate.database,
					username: candidate.username,
					ssl
				} satisfies MariaDBConnection);
			} else if (candidate.type === 'redshift') {
				connections.push({
					id: candidate.id,
					name: candidate.name,
					type: 'redshift',
					catalogName,
					host: candidate.host,
					port: candidate.port,
					database: candidate.database,
					username: candidate.username,
					ssl
				} satisfies RedshiftConnection);
			} else {
				connections.push({
					id: candidate.id,
					name: candidate.name,
					type: 'singlestore',
					catalogName,
					host: candidate.host,
					port: candidate.port,
					database: candidate.database,
					username: candidate.username,
					ssl
				} satisfies SingleStoreConnection);
			}
			continue;
		}

		if (
			candidate.type === 'mongodb' &&
			typeof candidate.host === 'string' &&
			typeof candidate.port === 'number' &&
			typeof candidate.database === 'string' &&
			typeof candidate.username === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'mongodb',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				host: candidate.host,
				port: candidate.port,
				database: candidate.database,
				username: candidate.username,
				ssl: Boolean((candidate as Record<string, unknown>).ssl)
			} satisfies MongoDBConnection);
			continue;
		}

		if (
			candidate.type === 'elasticsearch' &&
			typeof candidate.host === 'string' &&
			typeof candidate.port === 'number' &&
			typeof candidate.database === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			const rawUsername = (candidate as Record<string, unknown>).username;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'elasticsearch',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				host: candidate.host,
				port: candidate.port,
				database: candidate.database,
				username: typeof rawUsername === 'string' && rawUsername ? rawUsername : undefined
			} satisfies ElasticsearchConnection);
			continue;
		}

		if (
			candidate.type === 'sqlserver' &&
			typeof candidate.host === 'string' &&
			typeof candidate.port === 'number' &&
			typeof candidate.database === 'string' &&
			typeof candidate.username === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'sqlserver',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				host: candidate.host,
				port: candidate.port,
				database: candidate.database,
				username: candidate.username,
				encrypt: Boolean((candidate as Record<string, unknown>).encrypt),
				trustServerCertificate: Boolean(
					(candidate as Record<string, unknown>).trustServerCertificate
				)
			} satisfies SQLServerConnection);
			continue;
		}

		if (
			candidate.type === 'oracle' &&
			typeof candidate.host === 'string' &&
			typeof candidate.port === 'number' &&
			typeof candidate.username === 'string' &&
			typeof (candidate as Record<string, unknown>).serviceName === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			const identifierType = (candidate as Record<string, unknown>).identifierType;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'oracle',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				host: candidate.host,
				port: candidate.port,
				username: candidate.username,
				identifierType: identifierType === 'sid' ? 'sid' : 'service_name',
				serviceName: (candidate as Record<string, unknown>).serviceName as string
			} satisfies OracleConnection);
			continue;
		}

		if (
			candidate.type === 'snowflake' &&
			typeof (candidate as Record<string, unknown>).account === 'string' &&
			typeof (candidate as Record<string, unknown>).warehouse === 'string' &&
			typeof candidate.database === 'string' &&
			typeof candidate.username === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			const rawRole = (candidate as Record<string, unknown>).role;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'snowflake',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				account: (candidate as Record<string, unknown>).account as string,
				warehouse: (candidate as Record<string, unknown>).warehouse as string,
				database: candidate.database,
				username: candidate.username,
				role: typeof rawRole === 'string' && rawRole ? rawRole : undefined
			} satisfies SnowflakeConnection);
			continue;
		}

		if (
			candidate.type === 'cassandra' &&
			typeof (candidate as Record<string, unknown>).contactPoints === 'string' &&
			typeof candidate.port === 'number' &&
			typeof (candidate as Record<string, unknown>).localDatacenter === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			const rawUsername = (candidate as Record<string, unknown>).username;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'cassandra',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				contactPoints: (candidate as Record<string, unknown>).contactPoints as string,
				port: candidate.port,
				localDatacenter: (candidate as Record<string, unknown>).localDatacenter as string,
				username: typeof rawUsername === 'string' && rawUsername ? rawUsername : undefined
			} satisfies CassandraConnection);
			continue;
		}

		if (
			candidate.type === 'gsheets' &&
			typeof (candidate as Record<string, unknown>).metadataSheetId === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'gsheets',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				metadataSheetId: (candidate as Record<string, unknown>).metadataSheetId as string
			} satisfies GoogleSheetsConnection);
			continue;
		}

		if (
			candidate.type === 'bigquery' &&
			typeof (candidate as Record<string, unknown>).projectId === 'string'
		) {
			const rawCatalogName = (candidate as Record<string, unknown>).catalogName;
			const rawParentProjectId = (candidate as Record<string, unknown>).parentProjectId;
			connections.push({
				id: candidate.id,
				name: candidate.name,
				type: 'bigquery',
				catalogName:
					typeof rawCatalogName === 'string' && rawCatalogName
						? rawCatalogName
						: slugifyCatalogName(candidate.name),
				projectId: (candidate as Record<string, unknown>).projectId as string,
				parentProjectId:
					typeof rawParentProjectId === 'string' && rawParentProjectId ? rawParentProjectId : undefined
			} satisfies BigQueryConnection);
			continue;
		}
	}

	return connections;
}

function normalizeConnectionId(
	connectionId: string | null | undefined,
	connections: Connection[]
): string | null {
	if (!connectionId || connectionId === BUILTIN_DUCKDB_CONNECTION_ID) return null;
	return connections.some((connection) => connection.id === connectionId) ? connectionId : null;
}

// Reads the persisted display state, falling back to the legacy boolean
// `collapsed` field for notebooks saved before the three-state model.
function normalizeCellDisplay(c: unknown): CellDisplay {
	const candidate = (c as { display?: unknown }).display;
	if (candidate === 'full' || candidate === 'output' || candidate === 'collapsed') return candidate;
	return (c as { collapsed?: unknown }).collapsed === true ? 'collapsed' : 'full';
}

function deserializeCell(c: Cell, i: number): Cell {
	const guiStages: GUIPipelineStage[] =
		Array.isArray(c.guiStages) && c.guiStages.length > 0
			? c.guiStages
			: [{ type: 'from', table: '' } as GUIPipelineStage];
	const language: CellLanguage = (c as Partial<Cell>).language === 'sql' ? 'sql' : 'prql';
	const editMode: CellEditMode = language === 'sql' || c.editMode === 'prql' ? 'prql' : 'gui';
	const persistedViewMode = (c as Partial<Cell>).resultViewMode;
	const persistedCellType = (c as Partial<Cell>).cellType;
	const cellType: CellType =
		persistedCellType === 'markdown' || persistedCellType === 'udf' ? persistedCellType : 'query';
	const markdown =
		typeof (c as Partial<Cell>).markdown === 'string'
			? ((c as Partial<Cell>).markdown as string)
			: '';
	const markdownPreview = Boolean((c as Partial<Cell>).markdownPreview);
	const udfBody =
		typeof (c as Partial<Cell>).udfBody === 'string'
			? ((c as Partial<Cell>).udfBody as string)
			: '';
	const resultViewMode: ResultViewMode =
		persistedViewMode === 'chart' || persistedViewMode === 'stats' || persistedViewMode === 'table'
			? persistedViewMode
			: 'table';
	return {
		...makeCell(c.code),
		id: c.id ?? makeId(),
		cellType,
		connectionId: null,
		outputName: c.outputName || `result${i + 1}`,
		markdown,
		markdownPreview,
		udfBody,
		language,
		guiStages,
		editMode,
		resultViewMode,
		resultChartConfig: (c as Partial<Cell>).resultChartConfig ?? null,
		// Restore persisted (capped) result so output survives reload/HMR.
		result: (c as Partial<Cell>).result ?? null,
		status: (c as Partial<Cell>).result ? 'success' : 'idle',
		executionMs:
			typeof (c as Partial<Cell>).executionMs === 'number'
				? ((c as Partial<Cell>).executionMs as number)
				: null,
		needsRun: (c as Partial<Cell>).result ? false : Boolean((c as Partial<Cell>).needsRun),
		display: normalizeCellDisplay(c),
		stageResultsCollapsed: Array.isArray((c as Partial<Cell>).stageResultsCollapsed)
			? ((c as Partial<Cell>).stageResultsCollapsed as boolean[])
			: [],
		materializeMode: (c as Partial<Cell>).materializeMode ?? 'table',
		materializeTarget:
			typeof (c as Partial<Cell>).materializeTarget === 'string'
				? ((c as Partial<Cell>).materializeTarget as string)
				: c.outputName || `result${i + 1}`,
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: (c as Partial<Cell>).materializedRelationType ?? null,
		description:
			typeof (c as Partial<Cell>).description === 'string'
				? ((c as Partial<Cell>).description as string)
				: null,
		dbtSchema:
			typeof (c as Partial<Cell>).dbtSchema === 'string'
				? ((c as Partial<Cell>).dbtSchema as string)
				: null,
		dbtTags: Array.isArray((c as Partial<Cell>).dbtTags)
			? ((c as Partial<Cell>).dbtTags as string[])
			: [],
		promotedModelPath:
			typeof (c as Partial<Cell>).promotedModelPath === 'string'
				? ((c as Partial<Cell>).promotedModelPath as string)
				: null,
		dbtTestStatus: 'idle',
		dbtTestResults: [],
		dbtTestLog: [],
		scheduleEnabled: Boolean((c as Partial<Cell>).scheduleEnabled),
		scheduleIntervalMinutes: clampScheduleIntervalMinutes(
			typeof (c as Partial<Cell>).scheduleIntervalMinutes === 'number'
				? ((c as Partial<Cell>).scheduleIntervalMinutes as number)
				: 60
		),
		scheduleScope: (c as Partial<Cell>).scheduleScope === 'segment' ? 'segment' : 'cell',
		scheduleStatus: 'idle',
		scheduleLastRunAt:
			typeof (c as Partial<Cell>).scheduleLastRunAt === 'number'
				? ((c as Partial<Cell>).scheduleLastRunAt as number)
				: null,
		scheduleNextRunAt:
			typeof (c as Partial<Cell>).scheduleNextRunAt === 'number'
				? ((c as Partial<Cell>).scheduleNextRunAt as number)
				: null,
		scheduleLastError:
			typeof (c as Partial<Cell>).scheduleLastError === 'string'
				? ((c as Partial<Cell>).scheduleLastError as string)
				: null,
		intelligence: (c as Partial<Cell>).intelligence ?? null
	};
}

function hashCode(input: string): string {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = (hash << 5) - hash + input.charCodeAt(i);
		hash |= 0;
	}
	return String(hash >>> 0);
}

function connectionIdForCell(cell: Cell): string {
	return cell.connectionId ?? BUILTIN_DUCKDB_CONNECTION_ID;
}

function getSchemaTablesForConnection(cell: Cell): SchemaTable[] {
	const connection = getCellConnection(cell);
	if (isBuiltinDuckDBConnection(connection)) {
		return state.tables.map((table) => ({
			name: table.name,
			columns: table.columns,
			columnTypes: table.columnTypes
		}));
	}
	return state.externalSchemaTables
		.filter((table) => table.connectionId === connection.id)
		.map((table) => ({
			name: table.name,
			schema: table.schema,
			columns: table.columns,
			columnTypes: table.columnTypes
		}));
}

function inferMaterializeTargetSchema(cell: Cell, connection: Connection): string | undefined {
	if (isBuiltinDuckDBConnection(connection)) return undefined;

	const availableSchemas = state.externalSchemaTables
		.filter((table) => table.connectionId === connection.id)
		.map((table) => table.schema)
		.filter((schema): schema is string => typeof schema === 'string' && schema.length > 0);

	if (connection.type === 'postgres') {
		if (availableSchemas.includes('public')) return 'public';
		return availableSchemas[0] ?? 'public';
	}

	if (connection.type === 'clickhouse') {
		if (availableSchemas.includes(connection.database)) return connection.database;
		return availableSchemas[0] ?? connection.database;
	}

	if (
		connection.type === 'mysql' ||
		connection.type === 'mariadb' ||
		connection.type === 'redshift' ||
		connection.type === 'singlestore' ||
		connection.type === 'mongodb' ||
		connection.type === 'elasticsearch' ||
		connection.type === 'sqlserver' ||
		connection.type === 'snowflake'
	) {
		if (availableSchemas.includes(connection.database)) return connection.database;
		return availableSchemas[0] ?? connection.database;
	}

	if (connection.type === 'gsheets') {
		if (availableSchemas.includes('default')) return 'default';
		return availableSchemas[0] ?? 'default';
	}

	// Oracle, Cassandra, and BigQuery have no static schema-equivalent field to guess
	// from — only return a schema once one has actually been discovered.
	if (connection.type === 'oracle' || connection.type === 'cassandra' || connection.type === 'bigquery') {
		return availableSchemas[0];
	}

	return undefined;
}

function recordNotebookEvent(
	notebookId: string,
	cell: Cell,
	eventType: 'run-success' | 'run-error',
	fullCode: string
): void {
	const rowCount = cell.result?.rows.length ?? 0;
	const columnCount = cell.result?.columns.length ?? 0;
	const event: NotebookEvent = {
		id: makeId(),
		ts: Date.now(),
		notebookId,
		cellId: cell.id,
		connectionId: connectionIdForCell(cell),
		eventType,
		codeHash: hashCode(fullCode),
		runtimeMs: cell.executionMs,
		rowCount,
		columnCount,
		tablesTouched: extractTablesTouched(fullCode)
	};
	state.notebookEvents = [...state.notebookEvents, event].slice(-1000);
}

function normalizeRelationName(name: string, fallback = 'model'): string {
	const sanitized = name
		.trim()
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.replace(/^([0-9])/, '_$1');
	return sanitized || fallback;
}

function outputRelationNameForCell(cell: Cell): string {
	const outputRef = getCellOutputReference(cell);
	if (outputRef) return outputRef;
	return normalizeRelationName(cell.outputName || `_cell_${cell.id}`, 'result');
}

function normalizeEscapedQuotedString(raw: string): string {
	let value = raw.trim();
	let touchedEscapes = false;

	for (let i = 0; i < 3; i++) {
		const unescaped = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
		if (unescaped !== value) {
			touchedEscapes = true;
			value = unescaped.trim();
		}

		const startsDouble = value.startsWith('"') && value.endsWith('"');
		const startsSingle = value.startsWith("'") && value.endsWith("'");
		if (!startsDouble && !startsSingle) break;

		const inner = value.slice(1, -1).trim();
		const numericLike = /^[\d\s,+\-().$€£¥₦₵₹%]+$/.test(inner);
		if (!touchedEscapes && !numericLike) break;
		value = inner;
	}

	return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object') return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function decodeHugeIntLimbs(l0: number, l1: number, l2: number, l3: number): bigint {
	const part0 = BigInt.asUintN(32, BigInt(l0));
	const part1 = BigInt.asUintN(32, BigInt(l1));
	const part2 = BigInt.asUintN(32, BigInt(l2));
	const part3 = BigInt.asUintN(32, BigInt(l3));
	const unsigned = part0 + (part1 << 32n) + (part2 << 64n) + (part3 << 96n);
	return BigInt.asIntN(128, unsigned);
}

function toSafeNumberOrString(value: bigint): number | string {
	const max = BigInt(Number.MAX_SAFE_INTEGER);
	const min = BigInt(Number.MIN_SAFE_INTEGER);
	if (value <= max && value >= min) return Number(value);
	return value.toString();
}

function tryDecodeHugeIntLike(value: unknown): number | string | null {
	let limbs: number[] | null = null;

	if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
		const arr = Array.from(value as unknown as ArrayLike<unknown>);
		if (
			arr.length === 4 &&
			arr.every((entry) => typeof entry === 'number' && Number.isInteger(entry))
		) {
			limbs = arr as number[];
		}
	} else if (isPlainObject(value)) {
		const keys = Object.keys(value);
		if (keys.length === 4 && ['0', '1', '2', '3'].every((key) => keys.includes(key))) {
			const arr = ['0', '1', '2', '3'].map((key) => (value as Record<string, unknown>)[key]);
			if (arr.every((entry) => typeof entry === 'number' && Number.isInteger(entry))) {
				limbs = arr as number[];
			}
		}
	}

	if (!limbs) return null;
	return toSafeNumberOrString(decodeHugeIntLimbs(limbs[0], limbs[1], limbs[2], limbs[3]));
}

function normalizeResultValue(value: unknown): unknown {
	const maybeHugeInt = tryDecodeHugeIntLike(value);
	if (maybeHugeInt !== null) {
		return maybeHugeInt;
	}
	if (typeof value === 'string') {
		return normalizeEscapedQuotedString(value);
	}
	if (Array.isArray(value)) {
		return value.map((entry) => normalizeResultValue(entry));
	}
	if (isPlainObject(value)) {
		const normalizedEntries = Object.entries(value as Record<string, unknown>).map(
			([key, entry]) => [key, normalizeResultValue(entry)]
		);
		return Object.fromEntries(normalizedEntries);
	}
	return value;
}

// Cap on rows materialized into cell results. Display/intelligence/metadata all
// work on the capped result; views are created from the unwrapped SQL so
// downstream cells still see the full relation.
export const AUTO_LIMIT = 1000;

// Scans a `WITH ...` clause for a top-level `FUNCTION` keyword (a Trino inline
// UDF spec) without descending into parenthesized CTE/UDF bodies — so a CTE
// body that merely mentions "function" in a comment or string doesn't false-positive.
function hasTopLevelFunctionClause(maskedBody: string): boolean {
	const head = /^\s*with\s+(recursive\s+)?/i.exec(maskedBody);
	if (!head) return false;
	let depth = 0;
	for (let i = head[0].length; i < maskedBody.length; ) {
		const ch = maskedBody[i];
		if (ch === '(') {
			depth++;
			i++;
		} else if (ch === ')') {
			depth--;
			i++;
		} else if (depth === 0) {
			const word = /^\w+/.exec(maskedBody.slice(i));
			if (word) {
				if (/^function$/i.test(word[0])) return true;
				i += word[0].length;
			} else {
				i++;
			}
		} else {
			i++;
		}
	}
	return false;
}

export function wrapWithAutoLimit(sql: string): { sql: string; wrapped: boolean } {
	const body = sql.trim().replace(/;\s*$/, '');
	// Test against the masked body so a Trino UDF's dollar-quoted Python source
	// (which may legitimately contain a semicolon) doesn't get mistaken for a
	// second statement — but still wrap the original, unmasked body.
	const maskedBody = maskDollarQuotedBlocks(body);
	// Only wrap a single SELECT-like statement — leave EXPLAIN/PRAGMA/multi-statement SQL alone.
	if (!/^\s*(select|with|values)\b/i.test(maskedBody) || maskedBody.includes(';')) {
		return { sql, wrapped: false };
	}
	// Trino only allows an inline `WITH FUNCTION ...` UDF definition at the root
	// of a query — subquery-wrapping it as `SELECT * FROM (WITH FUNCTION ...) t`
	// moves it into a derived table, which Trino's grammar rejects. Skip wrapping
	// (and thus auto-limiting) when the WITH list defines a UDF.
	if (hasTopLevelFunctionClause(maskedBody)) {
		return { sql, wrapped: false };
	}
	return {
		sql: `SELECT * FROM (${body}) AS _lunapad_limited LIMIT ${AUTO_LIMIT + 1}`,
		wrapped: true
	};
}

function applyAutoLimit(
	result: { rows: Record<string, unknown>[]; columns: string[] },
	wrapped: boolean
): { rows: Record<string, unknown>[]; columns: string[]; truncated?: boolean } {
	if (!wrapped || result.rows.length <= AUTO_LIMIT) return result;
	return { columns: result.columns, rows: result.rows.slice(0, AUTO_LIMIT), truncated: true };
}

function normalizeQueryResult(result: { rows: Record<string, unknown>[]; columns: string[] }): {
	rows: Record<string, unknown>[];
	columns: string[];
} {
	return {
		columns: result.columns,
		rows: result.rows.map((row) =>
			Object.fromEntries(
				Object.entries(row).map(([key, value]) => [key, normalizeResultValue(value)])
			)
		)
	};
}

function deserialize(raw: string): void {
	try {
		const data = JSON.parse(raw) as Record<string, unknown>;

		// ── Migration: old format had cells at root ──
		if (Array.isArray(data.cells)) {
			const migratedCells = (data.cells as Cell[]).map(deserializeCell);
			const nb = makeNotebook('Notebook 1', migratedCells);
			// legacy saved states predate the SQL default — keep their PRQL behavior
			nb.defaultCellLanguage = 'prql';
			state.notebooks = [nb];
			state.activeTabId = nb.id;
			state.openResultTabs = [];
			if (data.theme) state.theme = data.theme as NotebookState['theme'];
			return;
		}

		// ── New format ──
		if (Array.isArray(data.notebooks) && (data.notebooks as unknown[]).length > 0) {
			const connections = sanitizeConnections(data.connections);
			state.connections = connections;
			state.externalSchemaTables = Array.isArray(data.externalSchemaTables)
				? (data.externalSchemaTables as ExternalSchemaTable[])
						.filter(
							(entry) =>
								typeof entry.connectionId === 'string' &&
								typeof entry.connectionName === 'string' &&
								typeof entry.name === 'string' &&
								Array.isArray(entry.columns) &&
								Array.isArray(entry.columnTypes)
						)
						.map((entry) => ({
							connectionId: entry.connectionId,
							connectionName: entry.connectionName,
							name: entry.name,
							schema: typeof entry.schema === 'string' ? entry.schema : undefined,
							columns: entry.columns,
							columnTypes: entry.columnTypes
						}))
				: [];
			state.notebooks = (data.notebooks as Notebook[]).map((n) => ({
				id: n.id ?? makeId(),
				name: n.name || 'Notebook',
				folderId: typeof n.folderId === 'string' ? n.folderId : null,
				defaultCellLanguage:
					(n as Partial<Notebook>).defaultCellLanguage === 'sql' ? 'sql' : 'prql',
				reportView: Boolean((n as Partial<Notebook>).reportView),
				filters:
					(n as Partial<Notebook>).filters && typeof (n as Partial<Notebook>).filters === 'object'
						? (n as Partial<Notebook>).filters
						: {},
				autoRefreshIntervalMs:
					typeof (n as Partial<Notebook>).autoRefreshIntervalMs === 'number'
						? (n as Partial<Notebook>).autoRefreshIntervalMs
						: undefined,
				cells:
					Array.isArray(n.cells) && n.cells.length > 0
						? (n.cells as Cell[]).map((cell, idx) => ({
								...deserializeCell(cell, idx),
								connectionId: normalizeConnectionId(
									(cell as Partial<Cell>).connectionId,
									connections
								)
							}))
						: [makeCell('', 'result1')]
			}));
		} else {
			state.connections = [BUILTIN_DUCKDB_CONNECTION];
			state.externalSchemaTables = [];
		}

		if (Array.isArray(data.folders)) {
			state.folders = (data.folders as NotebookFolder[])
				.filter((f) => typeof f.id === 'string' && typeof f.name === 'string')
				.map((f) => ({
					id: f.id,
					name: f.name,
					parentId: typeof f.parentId === 'string' ? f.parentId : null
				}));
		}

		const folderIds = new Set(state.folders.map((f) => f.id));
		state.notebooks = state.notebooks.map((n) => ({
			...n,
			folderId: n.folderId && folderIds.has(n.folderId) ? n.folderId : null
		}));

		const notebookIds = new Set(state.notebooks.map((n) => n.id));

		if (Array.isArray(data.openNotebookTabIds)) {
			state.openNotebookTabIds = (data.openNotebookTabIds as string[]).filter((id) =>
				notebookIds.has(id)
			);
		} else {
			state.openNotebookTabIds = state.notebooks.map((n) => n.id);
		}

		if (state.openNotebookTabIds.length === 0 && state.notebooks.length > 0) {
			state.openNotebookTabIds = [state.notebooks[0].id];
		}

		if (Array.isArray(data.expandedNotebookFolderIds)) {
			state.expandedNotebookFolderIds = (data.expandedNotebookFolderIds as string[]).filter((id) =>
				folderIds.has(id)
			);
		}

		if (Array.isArray(data.expandedNotebookIds)) {
			state.expandedNotebookIds = (data.expandedNotebookIds as string[]).filter((id) =>
				notebookIds.has(id)
			);
		}

		if (data.sidebarSectionsExpanded && typeof data.sidebarSectionsExpanded === 'object') {
			const sections = data.sidebarSectionsExpanded as Partial<SidebarSectionsExpanded>;
			state.sidebarSectionsExpanded = {
				notebooks: sections.notebooks ?? true,
				tables: sections.tables ?? true
			};
		}

		if (Array.isArray(data.openResultTabs)) {
			state.openResultTabs = (data.openResultTabs as ResultTabInfo[]).filter((t) =>
				notebookIds.has(t.notebookId)
			);
		}

		const allTabIds = new Set([
			...state.openNotebookTabIds,
			...state.openResultTabs.map((t) => t.id)
		]);
		for (const et of state.openExtraTabs) allTabIds.add(et.id);
		state.activeTabId =
			typeof data.activeTabId === 'string' && allTabIds.has(data.activeTabId)
				? data.activeTabId
				: (state.openNotebookTabIds[0] ?? state.notebooks[0].id);

		if (data.theme) state.theme = data.theme as NotebookState['theme'];
		if (typeof data.autoRun === 'boolean') state.autoRun = data.autoRun;
		if (data.llmConfig && typeof data.llmConfig === 'object') {
			const llmConfig = data.llmConfig as Partial<LLMConfig>;
			state.llmConfig = {
				provider: llmConfig.provider === 'ollama' ? 'ollama' : 'openapi-compatible',
				baseUrl:
					typeof llmConfig.baseUrl === 'string' && llmConfig.baseUrl.trim().length > 0
						? llmConfig.baseUrl.trim()
						: 'http://127.0.0.1:11434/v1',
				model:
					typeof llmConfig.model === 'string' && llmConfig.model.trim().length > 0
						? llmConfig.model.trim()
						: 'qwen3:8b',
				...(typeof llmConfig.apiKey === 'string' && llmConfig.apiKey.trim().length > 0
					? { apiKey: llmConfig.apiKey.trim() }
					: {})
			};
		}
		state.notebookEvents = Array.isArray(data.notebookEvents)
			? (data.notebookEvents as NotebookEvent[]).filter(
					(event) =>
						typeof event.id === 'string' &&
						typeof event.cellId === 'string' &&
						typeof event.connectionId === 'string' &&
						typeof event.eventType === 'string'
				)
			: [];
		if (data.workspaceStandards && typeof data.workspaceStandards === 'object') {
			const standards = data.workspaceStandards as Partial<WorkspaceStandards>;
			setWorkspaceStandards({
				namingRules: Array.isArray(standards.namingRules) ? standards.namingRules : [],
				customInstructions:
					typeof standards.customInstructions === 'string' ? standards.customInstructions : ''
			});
		}
	} catch {
		// ignore corrupt state
	}
}

export function loadFromStorage(defaultProjectFolder?: string | null): void {
	if (typeof localStorage === 'undefined') return;
	if (useServerWorkspace) {
		void loadFromServer(defaultProjectFolder);
		return;
	}
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw) deserialize(raw);
	finishLoad(defaultProjectFolder);
}

// Postgres-backed hydration for full (authenticated, non-demo) mode. Seeds from the
// localStorage cache first for an instant paint, then overwrites with the server's
// copy once it resolves — Postgres is authoritative, localStorage is just the cache.
// On failure, the cached copy stays and workspaceSyncStatus flips to 'offline' so the
// UI can show a "showing offline copy" notice instead of silently looking normal.
async function loadFromServer(defaultProjectFolder?: string | null): Promise<void> {
	const cached = localStorage.getItem(STORAGE_KEY);
	if (cached) deserialize(cached);
	try {
		const res = await fetch('/api/workspace/load');
		if (!res.ok) throw new Error(`Workspace load failed: ${res.status}`);
		const body = (await res.json()) as { data: unknown };
		if (body.data) {
			deserialize(JSON.stringify(body.data));
			localStorage.setItem(STORAGE_KEY, serialize());
		}
		state.workspaceSyncStatus = 'synced';
	} catch {
		state.workspaceSyncStatus = 'offline';
	}
	finishLoad(defaultProjectFolder);
}

// Post-processing shared by both the local-only and server-backed load paths — runs
// once the final notebook state for this load is settled, regardless of where it came
// from.
function finishLoad(defaultProjectFolder?: string | null): void {
	// Migrate any notebooks that were saved without a folderId (local mode only).
	if (state.storageMode === 'local') {
		const unfoldered = state.notebooks.filter((nb) => !nb.folderId);
		if (unfoldered.length > 0) {
			const folderId = ensureDefaultFolder();
			for (const nb of unfoldered) nb.folderId = folderId;
			scheduleSave();
		}
	}
	ensureSchedulePoller();
	// Restart any auto-refresh timers that were enabled in the saved session.
	for (const nb of state.notebooks) {
		if (nb.autoRefreshIntervalMs) setNotebookAutoRefresh(nb.id, nb.autoRefreshIntervalMs);
	}
	// Restore project folder from last session
	const savedFolder = localStorage.getItem(PROJECT_FOLDER_KEY);
	if (savedFolder) {
		void openProject(savedFolder).catch(() => {
			// Folder may have moved — clear it silently
			localStorage.removeItem(PROJECT_FOLDER_KEY);
		});
	} else if (defaultProjectFolder) {
		// No project chosen yet this browser — open the deployment's default folder
		// (e.g. PROJECT_FOLDER in Docker). If it's empty, scaffold a real dbt project
		// into it first so the default isn't just an empty filesystem-mode shell.
		void openProject(defaultProjectFolder)
			.then(async () => {
				if (!state.isDbtProject) {
					const name = defaultProjectFolder.split('/').filter(Boolean).pop() || 'project';
					await scaffoldProject(defaultProjectFolder, name);
					await openProject(defaultProjectFolder);
				}
			})
			.catch(() => {
				// Permissions issue, etc. — fall back to local/in-memory mode silently.
			});
	}
}

function ensureSchedulePoller(): void {
	if (import.meta.env?.MODE === 'test') return;
	if (typeof window === 'undefined') return;
	if (schedulePollTimer) return;
	schedulePollTimer = setInterval(() => {
		void processScheduledMaterializations();
	}, SCHEDULE_POLL_MS);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSave(): void {
	if (typeof localStorage === 'undefined') return;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		let json = serialize();
		try {
			localStorage.setItem(STORAGE_KEY, json);
		} catch {
			// Quota exceeded (persisted results too large) — retry without results so the
			// rest of the workspace state still saves. Output is recomputed by re-running.
			json = serialize(false);
			try {
				localStorage.setItem(STORAGE_KEY, json);
			} catch {
				/* give up silently — nothing else we can do */
			}
		}
		// localStorage always gets written above, even in full mode — it's the cache that
		// loadFromServer() seeds from instantly, and the only persistence at all if a
		// Postgres outage makes saveToServer keep failing.
		if (useServerWorkspace) void saveToServer(json);
	}, 500);
}

let workspaceSaveRetryTimer: ReturnType<typeof setTimeout> | null = null;
async function saveToServer(serializedJson: string): Promise<void> {
	try {
		const res = await fetch('/api/workspace/save', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ data: JSON.parse(serializedJson) })
		});
		if (!res.ok) throw new Error(`Workspace save failed: ${res.status}`);
		state.workspaceSyncStatus = 'synced';
		if (workspaceSaveRetryTimer) {
			clearTimeout(workspaceSaveRetryTimer);
			workspaceSaveRetryTimer = null;
		}
	} catch {
		state.workspaceSyncStatus = 'error';
		// Retry once after 5s. If the user keeps editing in the meantime, scheduleSave's
		// own debounce will fire a fresher saveToServer call first, making this one moot.
		if (workspaceSaveRetryTimer) clearTimeout(workspaceSaveRetryTimer);
		workspaceSaveRetryTimer = setTimeout(() => scheduleSave(), 5000);
	}
}

export function getWorkspaceSyncStatus(): 'idle' | 'synced' | 'offline' | 'error' {
	return state.workspaceSyncStatus;
}

// ── Filesystem project file saves ────────────────────────────────────────────

/**
 * Relative path within the project folder for a notebook's .prql file.
 *
 * In filesystem mode, notebook IDs are set to the relative path without the
 * `.prql` extension (e.g. `models/staging/stg_orders`). For newly created
 * notebooks that don't yet have a path-based ID, we derive the path from the
 * notebook's folderId and outputName.
 */
function getRelativeNotebookPath(notebook: Notebook, cell: Cell): string | null {
	if (!cell.outputName) return null;
	const ext = cell.language === 'sql' ? '.sql' : '.prql';

	// Path-based ID (set when loading from filesystem or creating in fs mode)
	if (notebook.id.includes('/')) {
		// ID is already the relative path (without extension)
		// Use cell outputName as the final segment in case it was renamed
		const dir = notebook.id.substring(0, notebook.id.lastIndexOf('/'));
		return `${dir}/${cell.outputName}${ext}`;
	}

	// New notebook in filesystem mode: derive from folderId
	// folderId is a relative path like "models/staging" or null
	const folderPath = notebook.folderId ?? 'models';
	return `${folderPath}/${cell.outputName}${ext}`;
}

/** Relative path within the project folder for a single cell's .prql file. */
function getRelativeCellPath(notebook: Notebook, cell: Cell): string | null {
	return getRelativeNotebookPath(notebook, cell);
}

/** All known model outputNames across the project, for ref() injection on save. */
function allProjectModelNames(): string[] {
	return state.notebooks.flatMap((nb) =>
		nb.cells.filter((c) => c.cellType === 'query' && c.outputName).map((c) => c.outputName)
	);
}

const fileSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Separate timer map for `.luna` notebooks: one file = one notebook, so saves
// are debounced per-notebook rather than per-cell (see scheduleFileSave below).
const lunaSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let dirtyNotebookIds = $state(new Set<string>());

/** Cancel all pending debounced file saves. Call before switching storage modes. */
function cancelPendingFileSaves(): void {
	for (const timer of fileSaveTimers.values()) clearTimeout(timer);
	fileSaveTimers.clear();
	for (const timer of lunaSaveTimers.values()) clearTimeout(timer);
	lunaSaveTimers.clear();
	dirtyNotebookIds = new Set();
}

/** Returns true if the notebook has pending unsaved file changes. */
export function isNotebookDirty(id: string): boolean {
	return dirtyNotebookIds.has(id);
}

/** Debounced save of an entire `.luna`-backed notebook (one file, many cells,
 *  document order = cell order). */
function scheduleLunaNotebookSave(notebookId: string): void {
	const existing = lunaSaveTimers.get(notebookId);
	if (existing) clearTimeout(existing);
	dirtyNotebookIds = new Set([...dirtyNotebookIds, notebookId]);
	lunaSaveTimers.set(
		notebookId,
		setTimeout(() => {
			lunaSaveTimers.delete(notebookId);
			dirtyNotebookIds = new Set([...dirtyNotebookIds].filter((id) => id !== notebookId));
			const nb = state.notebooks.find((n) => n.id === notebookId);
			if (!nb || !state.projectFolder) return;
			const content = serializeLunaFile(nb.cells);
			writeProjectFile(state.projectFolder, `${nb.id}.luna`, content, state.isDbtProject).catch(
				() => {}
			);
		}, 500)
	);
}

/** Debounced save of a single cell's .prql file to the project folder
 *  (or, for `.luna`-backed notebooks, the whole notebook file). */
export function scheduleFileSave(notebookId: string, cellId: string): void {
	if (state.storageMode !== 'filesystem' || !state.projectFolder) return;
	const nb = state.notebooks.find((n) => n.id === notebookId);
	if (nb?.format === 'luna') {
		scheduleLunaNotebookSave(notebookId);
		return;
	}
	const key = `${notebookId}:${cellId}`;
	const existing = fileSaveTimers.get(key);
	if (existing) clearTimeout(existing);
	dirtyNotebookIds = new Set([...dirtyNotebookIds, notebookId]);
	fileSaveTimers.set(
		key,
		setTimeout(() => {
			fileSaveTimers.delete(key);
			// Clear dirty flag when all timers for this notebook are gone
			if (![...fileSaveTimers.keys()].some((k) => k.startsWith(`${notebookId}:`))) {
				dirtyNotebookIds = new Set([...dirtyNotebookIds].filter((id) => id !== notebookId));
			}
			const nb = state.notebooks.find((n) => n.id === notebookId);
			const cell = nb?.cells.find((c) => c.id === cellId);
			if (!nb || !cell || !state.projectFolder) return;
			const relPath = getRelativeCellPath(nb, cell);
			if (!relPath) return;
			const knownModels = allProjectModelNames();
			// Secondary cells (outputName ≠ notebook name) get a @notebook annotation
			// so the file-watcher reload re-groups them under the correct notebook.
			const notebookAnnotation = cell.outputName !== nb.name ? nb.id : undefined;
			const content = serializeCellToFile(cell, knownModels, notebookAnnotation);
			writeProjectFile(state.projectFolder, relPath, content, state.isDbtProject).catch(() => {});
		}, 500)
	);
}

// ── Project management ───────────────────────────────────────────────────────

let _fsWatcherUnsubscribe: (() => void) | null = null;

/** Open a project folder, detect dbt, load notebooks. */
export async function openProject(folder: string): Promise<void> {
	const info = await openProjectAPI(folder);

	// Cancel any pending local-mode file saves before switching to filesystem.
	// Without this, timers set while in local mode can fire after storageMode
	// flips and write local notebooks into the project folder.
	cancelPendingFileSaves();

	// Persist folder path
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(PROJECT_FOLDER_KEY, folder);
	}

	state.projectFolder = folder;
	state.isDbtProject = info.isDbtProject;
	state.isEvidenceProject = info.isEvidenceProject;
	state.storageMode = 'filesystem';

	await loadProjectNotebooks();

	// Load dbt manifest if available
	if (info.isDbtProject) {
		try {
			state.dbtModels = await fetchDbtManifest(folder);
		} catch {
			state.dbtModels = [];
		}
		// Load persisted schedules
		void loadDbtSchedules().catch(() => {});
		// Audit: stub missing YML entries, clean orphaned .sql files (best-effort)
		void auditProject(folder).catch(() => {});
	}

	// Load Evidence pages if available
	if (info.isEvidenceProject) {
		void refreshEvidencePages().catch(() => {});
	}

	// Start file watcher
	_fsWatcherUnsubscribe?.();
	_fsWatcherUnsubscribe = watchProjectFolder(
		folder,
		(_filename) => {
			// Re-load notebooks when external changes are detected
			void loadProjectNotebooks();
		},
		() => {
			// target/manifest.json or run_results.json changed externally
			void refreshDbtManifest();
		}
	);
}

/** Close the project and revert to localStorage mode. */
export function closeProject(): void {
	_fsWatcherUnsubscribe?.();
	_fsWatcherUnsubscribe = null;
	state.storageMode = 'local';
	state.projectFolder = null;
	state.isDbtProject = false;
	state.dbtModels = [];
	state.dbtLastCompileAt = null;
	state.dbtRunningJobId = null;
	state.dbtSchedules = [];
	state.isEvidenceProject = false;
	state.evidenceRunningJobId = null;
	state.evidenceDevPort = null;
	state.evidencePages = [];
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(PROJECT_FOLDER_KEY);
	}
}

/** Reload all notebooks from the project folder. */
export async function loadProjectNotebooks(): Promise<void> {
	if (!state.projectFolder) return;
	try {
		const { notebooks, folders } = await listProjectNotebooks(state.projectFolder);
		const newIds = new Set(notebooks.map((n) => n.id));

		// Merge fresh disk data with transient in-memory state so that cells
		// currently running (or with results) are not reset by a background reload.
		const prevMap = new Map(state.notebooks.map((nb) => [nb.id, nb]));
		state.notebooks = notebooks.map((freshNb) => {
			const prevNb = prevMap.get(freshNb.id);
			if (!prevNb) return freshNb;
			// A pending whole-notebook .luna save means every in-memory cell is
			// newer than disk — skip per-cell merging entirely (the save will
			// overwrite the file shortly anyway).
			if (lunaSaveTimers.has(freshNb.id)) return prevNb;

			const mergedCells = freshNb.cells.map((freshCell) => {
				const prev = prevNb.cells.find((c) => c.id === freshCell.id);
				if (!prev) return freshCell;
				// A pending file save means the in-memory cell is newer than disk
				// (the save will overwrite the file). Taking disk code here would
				// revert the editor mid-typing and destroy the cursor.
				if (fileSaveTimers.has(`${freshNb.id}:${freshCell.id}`)) return prev;
				// Disk fields win for everything that lives on disk.
				// Preserve only runtime/transient state that is never written to disk.
				return {
					...freshCell,
					status: prev.status,
					result: prev.result,
					errors: prev.errors,
					compiledSQL: prev.compiledSQL,
					executionMs: prev.executionMs,
					needsRun: prev.needsRun,
					staleReason: prev.staleReason,
					staleSources: prev.staleSources,
					lastRunAt: prev.lastRunAt,
					materializeStatus: prev.materializeStatus,
					materializeError: prev.materializeError,
					materializedRelationType: prev.materializedRelationType,
					dbtTestStatus: prev.dbtTestStatus,
					dbtTestResults: prev.dbtTestResults,
					dbtTestLog: prev.dbtTestLog,
					scheduleStatus: prev.scheduleStatus,
					scheduleLastRunAt: prev.scheduleLastRunAt,
					scheduleNextRunAt: prev.scheduleNextRunAt,
					scheduleLastError: prev.scheduleLastError,
					intelligence: prev.intelligence
				};
			});

			// Keep in-memory cells whose file save is still pending (debounce window).
			// Without this, a watcher reload triggered by another file change would
			// drop a freshly-added cell before its @notebook-annotated file is written.
			const freshCellIds = new Set(freshNb.cells.map((c) => c.id));
			const pendingCells = prevNb.cells.filter(
				(c) => !freshCellIds.has(c.id) && fileSaveTimers.has(`${freshNb.id}:${c.id}`)
			);

			return { ...freshNb, cells: [...mergedCells, ...pendingCells] };
		});

		state.folders = folders;
		state.openNotebookTabIds = state.openNotebookTabIds.filter((id) => newIds.has(id));
		if (state.openNotebookTabIds.length === 0 && notebooks.length > 0) {
			state.openNotebookTabIds = [notebooks[0].id];
			state.activeTabId = notebooks[0].id;
		}

		if (import.meta.env.DEV) warnOnDuplicateCellIds();
	} catch {
		// ignore — keep current state
	}
}

/** Dev-only: a duplicate cell id (== outputName for file-backed cells) anywhere
 *  in the project corrupts NotebookTree's keyed each-blocks, this function's own
 *  merge-by-id above, and cell-deps.ts's outputName lookups. The loaders in
 *  project.ts deconflict on load, so this should never fire — if it does, it's
 *  a regression, not expected/corrupted user data, hence the loud console.error.
 *
 *  Cells with `promotedModelPath` set are deliberately excluded: a `.luna`
 *  notebook's `model` ref intentionally mirrors a standalone model cell's
 *  id/outputName elsewhere in the project (see hydrateLunaEntries in
 *  project.ts) — that's a feature, not a collision. */
function warnOnDuplicateCellIds(): void {
	const seen = new Map<string, string>(); // id -> notebookId
	for (const nb of state.notebooks) {
		for (const c of nb.cells) {
			if (c.promotedModelPath) continue;
			const prevNotebookId = seen.get(c.id);
			if (prevNotebookId !== undefined) {
				console.error(
					`[lunapad] duplicate cell id "${c.id}" in notebooks "${prevNotebookId}" and "${nb.id}" — this indicates a missing dedup guard, not corrupted project data.`
				);
			} else {
				seen.set(c.id, nb.id);
			}
		}
	}
}

/** Refresh dbt manifest and update model metadata. */
export async function refreshDbtManifest(): Promise<void> {
	if (!state.projectFolder || !state.isDbtProject) return;
	try {
		state.dbtModels = await fetchDbtManifest(state.projectFolder);
		state.dbtLastCompileAt = Date.now();
		// Backfill column names from manifest into _models.yml (best-effort)
		void backfillSchemaFromManifest(state.projectFolder);
	} catch {
		// ignore
	}
}

/** Getters for project state. */
export function getProjectFolder(): string | null {
	return state.projectFolder;
}
export function getIsDbtProject(): boolean {
	return state.isDbtProject;
}
export function getDbtModels(): DbtModel[] {
	return state.dbtModels;
}
export function getDbtRunningJobId(): string | null {
	return state.dbtRunningJobId;
}
export function getDbtLastCompileAt(): number | null {
	return state.dbtLastCompileAt;
}
export function getStorageMode(): 'local' | 'filesystem' {
	return state.storageMode;
}
export function setDbtRunningJobId(jobId: string | null): void {
	state.dbtRunningJobId = jobId;
}
export function getDbtSchedules(): DbtSchedule[] {
	return state.dbtSchedules;
}

export async function loadDbtSchedules(): Promise<void> {
	if (!state.projectFolder) return;
	try {
		const res = await fetch(`/api/schedules?folder=${encodeURIComponent(state.projectFolder)}`);
		const body = (await res.json()) as { schedules?: DbtSchedule[] };
		state.dbtSchedules = body.schedules ?? [];
	} catch {
		// ignore
	}
}

export async function saveDbtSchedule(schedule: DbtSchedule): Promise<void> {
	if (!state.projectFolder) return;
	const res = await fetch(`/api/schedules?folder=${encodeURIComponent(state.projectFolder)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ schedule })
	});
	const body = (await res.json()) as { error?: string; schedule?: DbtSchedule };
	if (!res.ok) throw new Error(body.error ?? 'Failed to save schedule');
	// Update local state
	const idx = state.dbtSchedules.findIndex((s) => s.id === body.schedule!.id);
	if (idx !== -1) {
		state.dbtSchedules = state.dbtSchedules.map((s) =>
			s.id === body.schedule!.id ? body.schedule! : s
		);
	} else {
		state.dbtSchedules = [...state.dbtSchedules, body.schedule!];
	}
}

export async function deleteDbtSchedule(id: string): Promise<void> {
	if (!state.projectFolder) return;
	await fetch(
		`/api/schedules?folder=${encodeURIComponent(state.projectFolder)}&id=${encodeURIComponent(id)}`,
		{
			method: 'DELETE'
		}
	);
	state.dbtSchedules = state.dbtSchedules.filter((s) => s.id !== id);
}

// ── Evidence.dev project functions ────────────────────────────────────────────
export function getIsEvidenceProject(): boolean {
	return state.isEvidenceProject;
}
export function getEvidenceDevPort(): number | null {
	return state.evidenceDevPort;
}
export function getEvidencePages(): string[] {
	return state.evidencePages;
}
export function getEvidenceRunningJobId(): string | null {
	return state.evidenceRunningJobId;
}

export async function refreshEvidencePages(): Promise<void> {
	if (!state.projectFolder) return;
	try {
		const res = await fetch(
			`/api/evidence/pages?folder=${encodeURIComponent(state.projectFolder)}`
		);
		const body = (await res.json()) as { pages?: string[] };
		state.evidencePages = body.pages ?? [];
	} catch {
		// ignore
	}
}

export async function startEvidenceServer(): Promise<string | null> {
	if (!state.projectFolder) return null;
	try {
		const res = await fetch('/api/evidence/start', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ folder: state.projectFolder })
		});
		const body = (await res.json()) as { jobId?: string };
		if (body.jobId) {
			state.evidenceRunningJobId = body.jobId;
			return body.jobId;
		}
	} catch {
		// ignore
	}
	return null;
}

export async function stopEvidenceServer(): Promise<void> {
	if (!state.evidenceRunningJobId) return;
	const jobId = state.evidenceRunningJobId;
	state.evidenceRunningJobId = null;
	state.evidenceDevPort = null;
	try {
		await fetch('/api/evidence/stop', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jobId })
		});
	} catch {
		// ignore
	}
}

export function setEvidenceDevPort(port: number | null): void {
	state.evidenceDevPort = port;
}

export function openEvidencePreviewTab(pagePath: string): void {
	const name = pagePath.replace(/^pages\//, '').replace(/\.md$/, '');
	const existing = state.openExtraTabs.find(
		(t) => t.type === 'evidence-preview' && t.pagePath === pagePath
	);
	if (existing) {
		state.activeTabId = existing.id;
		return;
	}
	const tab: ExtraTab = {
		id: makeId(),
		type: 'evidence-preview',
		tableName: '',
		name: `Evidence: ${name}`,
		viewMode: 'table',
		chartConfig: null,
		pagePath
	};
	state.openExtraTabs = [...state.openExtraTabs, tab];
	state.activeTabId = tab.id;
}

// Parse "PASS not_null_stg_orders_id" or "FAIL 1 unique_stg_orders_id" from dbt test logs
function parseDbtTestLine(line: string, modelName: string): DbtTestResult | null {
	const passMatch = line.match(/\bPASS\b\s+([\w_]+)/);
	const failMatch = line.match(/\bFAIL\b\s+\d+\s+([\w_]+)/);
	const match = passMatch ?? failMatch;
	if (!match) return null;
	const testName = match[1];
	// Extract column: test names follow convention not_null_MODEL_COLUMN or unique_MODEL_COLUMN
	const prefix = testName.toLowerCase();
	const modelSlug = modelName.toLowerCase().replace(/[^a-z0-9]/g, '_');
	let column: string | null = null;
	for (const sep of [`${modelSlug}_`, `${modelName}_`]) {
		const idx = prefix.indexOf(sep);
		if (idx !== -1) {
			column = testName.slice(idx + sep.length) || null;
			break;
		}
	}
	return { testName, column, status: passMatch ? 'pass' : 'fail' };
}

export async function testCell(cellId: string): Promise<void> {
	const context = findCellContext(cellId);
	if (!context || !state.projectFolder) return;
	const { cell } = context;
	if (cell.cellType !== 'query') return;

	cell.dbtTestStatus = 'running';
	cell.dbtTestResults = [];
	cell.dbtTestLog = [];

	const jobId = await dbtTest(state.projectFolder, cell.outputName).catch(() => null);
	if (!jobId) {
		cell.dbtTestStatus = 'fail';
		return;
	}

	const results: DbtTestResult[] = [];
	const unsubscribe = watchDbtLogs(
		jobId,
		(line: string) => {
			const ctx2 = findCellContext(cellId);
			if (!ctx2) return;
			ctx2.cell.dbtTestLog = [...ctx2.cell.dbtTestLog, line];
			const result = parseDbtTestLine(line, cell.outputName);
			if (result) results.push(result);
		},
		(exitCode: number) => {
			const ctx2 = findCellContext(cellId);
			if (!ctx2) return;
			ctx2.cell.dbtTestResults = results;
			ctx2.cell.dbtTestStatus = exitCode === 0 ? 'pass' : 'fail';
			unsubscribe();
		}
	);
}

// ── Internal helper ──────────────────────────────────────────────────────────
function getActiveNotebook(): Notebook {
	const nb = state.notebooks.find((n) => n.id === state.activeTabId);
	if (nb) return nb;
	const rt = state.openResultTabs.find((t) => t.id === state.activeTabId);
	if (rt) {
		const owner = state.notebooks.find((n) => n.id === rt.notebookId);
		if (owner) return owner;
	}
	return state.notebooks[0];
}

function findCellContext(id: string): { notebook: Notebook; cell: Cell; idx: number } | null {
	for (const notebook of state.notebooks) {
		const idx = notebook.cells.findIndex((c) => c.id === id);
		if (idx !== -1) {
			return { notebook, cell: notebook.cells[idx], idx };
		}
	}
	return null;
}

function getGlobalOutputRegistry(): Map<string, { cell: Cell; notebookId: string }> {
	const registry = new Map<string, { cell: Cell; notebookId: string }>();
	for (const nb of state.notebooks) {
		for (const cell of nb.cells) {
			if ((cell.cellType === 'query' || cell.cellType === 'udf') && cell.outputName) {
				registry.set(cell.outputName, { cell, notebookId: nb.id });
			}
		}
	}
	return registry;
}

/** All cells across every notebook — used so Markdoc cells can reference cells in other notebooks. */
export function getAllCellsAcrossNotebooks(): Cell[] {
	return state.notebooks.flatMap((nb) => nb.cells);
}

// ── Promote to dbt model ─────────────────────────────────────────────────────

export interface PromotionChainItem {
	cell: Cell;
	/** Default target path (no extension), editable by the user before submitting. */
	suggestedRelPath: string;
}

/** True when a cell lives in a `.luna` notebook and isn't already backed by a
 *  real model file — i.e. it's eligible for "Promote to dbt model". */
export function isCellPromotable(cellId: string): boolean {
	if (state.storageMode !== 'filesystem') return false;
	const ctx = findCellContext(cellId);
	if (!ctx) return false;
	return (
		ctx.notebook.format === 'luna' && ctx.cell.cellType === 'query' && !ctx.cell.promotedModelPath
	);
}

/**
 * Returns the ordered list of cells that must be promoted (un-promoted
 * ancestors first, the requested cell last) to turn `cellId` into a real dbt
 * model. Promoting requires promoting the whole un-promoted upstream chain —
 * ancestors already backed by a model file (`promotedModelPath` set) are
 * excluded since they're already real models.
 */
export function getPromotionChain(cellId: string): PromotionChainItem[] {
	const ctx = findCellContext(cellId);
	if (!ctx) return [];
	const { notebook, cell, idx } = ctx;
	if (cell.cellType !== 'query' || cell.promotedModelPath) return [];

	const globalRegistry = new Map<string, Cell>();
	for (const [name, { cell: c }] of getGlobalOutputRegistry()) globalRegistry.set(name, c);

	const ancestors = resolveGlobalDependencies(notebook.cells, idx, globalRegistry).filter(
		(c) => !c.promotedModelPath
	);
	const chain = [...ancestors, cell];

	const defaultDir =
		notebook.id.startsWith('models/') || notebook.id.startsWith('analyses/')
			? notebook.id.substring(0, notebook.id.lastIndexOf('/'))
			: 'models/staging';

	return chain.map((c) => ({ cell: c, suggestedRelPath: `${defaultDir}/${c.outputName}` }));
}

/**
 * Explodes `cellId` and its un-promoted upstream chain into real dbt model
 * files. `overrides` lets the caller (PromoteDialog) adjust target path /
 * materialization / schema / tags per cell before submitting; cells without
 * an override fall back to their current metadata and a default `models/staging/<name>` path.
 */
export async function promoteCellChain(
	cellId: string,
	overrides: Map<
		string,
		{
			targetRelPath?: string;
			materialized?: CellMaterializationMode;
			schema?: string | null;
			tags?: string[];
		}
	> = new Map()
): Promise<PromoteResult> {
	if (!state.projectFolder) throw new Error('No project open');
	const ctx = findCellContext(cellId);
	if (!ctx) throw new Error('Cell not found');
	const { notebook } = ctx;
	if (notebook.format !== 'luna') throw new Error('Only cells in .luna notebooks can be promoted');

	const chain = getPromotionChain(cellId);
	if (chain.length === 0) throw new Error('Nothing to promote');

	const plan: PromotePlanItem[] = chain.map(({ cell, suggestedRelPath }) => {
		const o = overrides.get(cell.id);
		return {
			outputName: cell.outputName,
			code: cell.code,
			language: cell.language,
			connectionId: cell.connectionId,
			targetRelPath: o?.targetRelPath ?? suggestedRelPath,
			materialized: o?.materialized ?? cell.materializeMode,
			schema: o?.schema ?? cell.dbtSchema,
			tags: o?.tags ?? cell.dbtTags
		};
	});

	const result = await promoteCells(state.projectFolder, `${notebook.id}.luna`, plan);

	if (result.promoted.length > 0) {
		const promotedMap = new Map(result.promoted.map((p) => [p.outputName, p.relPath]));
		notebook.cells = notebook.cells.map((c) =>
			promotedMap.has(c.outputName)
				? { ...c, promotedModelPath: promotedMap.get(c.outputName)! }
				: c
		);
		if (state.isDbtProject) void refreshDbtManifest();
	}

	return result;
}

// ── Notebook-scoped filters ({% filter %} tags in markdown cells) ─────────────

export function getNotebookFilterValue(notebookId: string, paramName: string): string {
	const nb = state.notebooks.find((n) => n.id === notebookId);
	return nb?.filters?.[paramName] ?? '';
}

export function setNotebookFilterValue(notebookId: string, paramName: string, value: string): void {
	const nb = state.notebooks.find((n) => n.id === notebookId);
	if (!nb) return;
	nb.filters = { ...(nb.filters ?? {}), [paramName]: value };
	scheduleSave();

	const token = `\${${paramName}}`;
	const affected = nb.cells.filter((c) => c.cellType === 'query' && c.code.includes(token));
	for (const cell of affected) {
		void runCellAndDownstream(cell.id);
	}
}

/** Substitutes ${paramName} tokens in query cell code with the notebook's current filter values. */
function applyFilterSubstitution(cells: Cell[], notebookId: string): Cell[] {
	const nb = state.notebooks.find((n) => n.id === notebookId);
	const filters = nb?.filters;
	if (!filters || Object.keys(filters).length === 0) return cells;
	return cells.map((c) => {
		if (c.cellType !== 'query' || !c.code) return c;
		const code = substituteFilterTokens(c.code, filters);
		return code === c.code ? c : { ...c, code };
	});
}

// ── Notebook-scoped auto-refresh ──────────────────────────────────────────────

const autoRefreshTimers = new Map<string, ReturnType<typeof setInterval>>();

export function setNotebookAutoRefresh(notebookId: string, intervalMs: number): void {
	const nb = state.notebooks.find((n) => n.id === notebookId);
	if (!nb) return;
	nb.autoRefreshIntervalMs = intervalMs > 0 ? intervalMs : undefined;
	scheduleSave();

	const existing = autoRefreshTimers.get(notebookId);
	if (existing) {
		clearInterval(existing);
		autoRefreshTimers.delete(notebookId);
	}

	if (intervalMs > 0) {
		const timer = setInterval(() => {
			const current = state.notebooks.find((n) => n.id === notebookId);
			if (!current) {
				clearInterval(timer);
				autoRefreshTimers.delete(notebookId);
				return;
			}
			for (const cell of current.cells) {
				if (cell.cellType === 'query') void runCell(cell.id);
			}
		}, intervalMs);
		autoRefreshTimers.set(notebookId, timer);
	}
}

export function getNotebookAutoRefresh(notebookId: string): number {
	return state.notebooks.find((n) => n.id === notebookId)?.autoRefreshIntervalMs ?? 0;
}

export function getCrossNotebookUsageCount(outputName: string, ownNotebookId: string): number {
	if (!outputName) return 0;
	const re = new RegExp(`\\b${outputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
	let count = 0;
	for (const nb of state.notebooks) {
		if (nb.id === ownNotebookId) continue;
		for (const cell of nb.cells) {
			if (cell.cellType === 'query' && re.test(cell.code)) count++;
		}
	}
	return count;
}

/**
 * Counts cells in the same notebook (other than ownCellId) whose code references
 * outputName as a whole word. This is the actual "who references this output"
 * count — distinct from getRunImpact's contiguous rerun-segment heuristic.
 */
export function getSameNotebookUsageCount(
	outputName: string,
	notebookId: string,
	ownCellId: string
): number {
	if (!outputName) return 0;
	const nb = state.notebooks.find((n) => n.id === notebookId);
	if (!nb) return 0;
	const re = new RegExp(`\\b${outputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
	let count = 0;
	for (const cell of nb.cells) {
		if (cell.id === ownCellId) continue;
		if (cell.cellType === 'query' && re.test(cell.code)) count++;
	}
	return count;
}

/**
 * Marks all query cells (except sourceId) that reference outputName as needsRun,
 * then recurses transitively. sourceId excludes the cell that just ran from being
 * marked stale by its own output (e.g. a cell named "orders" with code "from orders").
 */
function markDownstreamStale(
	outputName: string,
	reason: 'code-changed' | 'upstream-changed',
	visited = new Set<string>(),
	sourceId = ''
): void {
	if (!outputName || visited.has(outputName)) return;
	visited.add(outputName);

	const re = new RegExp(`\\b${outputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
	for (const nb of state.notebooks) {
		for (const cell of nb.cells) {
			if (cell.cellType !== 'query') continue;
			if (cell.id === sourceId) continue; // never mark the source cell stale
			if (!re.test(cell.code)) continue;
			cell.needsRun = true;
			cell.staleReason = reason;
			if (reason === 'upstream-changed' && !cell.staleSources.includes(outputName)) {
				cell.staleSources = [...cell.staleSources, outputName];
			}
			if (cell.outputName && !visited.has(cell.outputName)) {
				markDownstreamStale(cell.outputName, reason, visited, sourceId);
			}
		}
	}
}

function markCellsReferencingTableStale(tableName: string): void {
	const re = new RegExp(`\\b${tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
	for (const nb of state.notebooks) {
		for (const cell of nb.cells) {
			if (cell.cellType !== 'query') continue;
			if (!re.test(cell.code)) continue;
			cell.needsRun = true;
			cell.staleReason = 'upstream-changed';
		}
	}
}

function markNotebookCellsStale(notebookId: string): void {
	const nb = state.notebooks.find((n) => n.id === notebookId);
	if (!nb) return;
	for (const cell of nb.cells) {
		if (cell.cellType !== 'query') continue;
		cell.needsRun = true;
		cell.staleReason = 'upstream-changed';
	}
}

function markCellsForConnectionStale(connectionId: string): void {
	for (const nb of state.notebooks) {
		for (const cell of nb.cells) {
			if (cell.cellType !== 'query') continue;
			const effectiveConnection = cell.connectionId ?? BUILTIN_DUCKDB_CONNECTION_ID;
			if (effectiveConnection !== connectionId) continue;
			cell.needsRun = true;
			cell.staleReason = 'upstream-changed';
		}
	}
}

function clearGuiCompileTimer(id: string): void {
	const timer = guiCompileTimers.get(id);
	if (!timer) return;
	clearTimeout(timer);
	guiCompileTimers.delete(id);
}

function scheduleGuiCompile(id: string): void {
	clearGuiCompileTimer(id);
	const timer = setTimeout(() => {
		guiCompileTimers.delete(id);
		const context = findCellContext(id);
		if (!context) return;
		const { notebook, cell, idx } = context;
		if (cell.language === 'sql') return; // GUI editor only used for PRQL cells
		const { errors, sql } = getCompiledCellSQL(notebook.cells, idx);
		cell.errors = errors;
		cell.compiledSQL = sql;
	}, GUI_COMPILE_DEBOUNCE_MS);
	guiCompileTimers.set(id, timer);
}

// ── Getters ──────────────────────────────────────────────────────────────────
export function getCells(): Cell[] {
	return getActiveNotebook().cells;
}

export function getLastCellId(): string {
	const cells = getActiveNotebook().cells;
	return cells.length > 0 ? cells[cells.length - 1].id : '';
}

export function getConnections(): Connection[] {
	return state.connections;
}

export function getTables(): UploadedTable[] {
	return state.tables;
}

export function getExternalSchemaTables(): ExternalSchemaTable[] {
	return state.externalSchemaTables;
}

export function getTheme(): 'light' | 'dark' | 'system' {
	return state.theme;
}

export function getNotebooks(): Notebook[] {
	return state.notebooks;
}

export function getFolders(): NotebookFolder[] {
	return state.folders;
}

export function getOpenNotebookTabIds(): string[] {
	return state.openNotebookTabIds;
}

export function getOpenNotebookTabs(): Notebook[] {
	const notebookById = new Map(state.notebooks.map((n) => [n.id, n]));
	return state.openNotebookTabIds
		.map((id) => notebookById.get(id))
		.filter((n): n is Notebook => Boolean(n));
}

export function getExpandedNotebookFolderIds(): string[] {
	return state.expandedNotebookFolderIds;
}

export function getSidebarSectionsExpanded(): SidebarSectionsExpanded {
	return state.sidebarSectionsExpanded;
}

export function getOpenResultTabs(): ResultTabInfo[] {
	return state.openResultTabs;
}

export function getOpenExtraTabs(): ExtraTab[] {
	return state.openExtraTabs;
}

export function getActiveTabId(): string {
	return state.activeTabId;
}

export function getAutoRun(): boolean {
	return state.autoRun;
}

export function getLLMConfig(): LLMConfig {
	return state.llmConfig;
}

export function setAutoRun(value: boolean): void {
	state.autoRun = value;
	scheduleSave();
}

export function setLLMConfig(next: Partial<LLMConfig>): void {
	state.llmConfig = {
		...state.llmConfig,
		...next
	};
	scheduleSave();
}

export function getCellForResultTab(tabId: string): Cell | null {
	const tab = state.openResultTabs.find((t) => t.id === tabId);
	if (!tab) return null;
	const nb = state.notebooks.find((n) => n.id === tab.notebookId);
	if (!nb) return null;
	return nb.cells.find((c) => c.id === tab.cellId) ?? null;
}

export function getNotebookState() {
	return state;
}

export function getNotebookEvents(): NotebookEvent[] {
	return state.notebookEvents;
}

// ── Notebook actions ──────────────────────────────────────────────────────────

function _createNotebook(folderId: string | null): Notebook {
	const n = makeNotebook('new_model');
	n.folderId = folderId;

	if (state.storageMode === 'filesystem') {
		// New notebooks default to the `.luna` format (one file, many cells) — the
		// source-of-truth authoring format. Flat per-cell `.prql`/`.sql` files only
		// come from cells explicitly promoted to a standalone dbt model.
		n.format = 'luna';
		// ID = relative path (without extension) so getRelativeCellPath/scheduleLunaNotebookSave
		// can derive the on-disk path.
		const dir = folderId ?? 'models';
		// dbt requires model names to be globally unique across the entire project, and
		// cross-notebook CTE resolution (cell-deps.ts) resolves outputNames project-wide
		// too — check all notebooks (any directory), not just the current folder.
		let name = 'new_model';
		let counter = 1;
		while (state.notebooks.some((nb) => nb.cells.some((c) => c.outputName === name))) {
			name = `new_model_${counter++}`;
		}
		n.name = name;
		n.id = `${dir}/${name}`;
		// Cell: use the model name as outputName and stable id
		n.cells[0].outputName = name;
		n.cells[0].materializeTarget = name;
		n.cells[0].id = name;
	} else {
		// local mode: generate globally unique outputName and a numbered display name
		const outputName = generateUniqueOutputName();
		n.cells[0].outputName = outputName;
		n.name = `Notebook ${state.notebooks.length + 1}`;
	}

	return n;
}

export function addNotebook(): void {
	// Always place new notebooks in a folder. For filesystem mode, only consider
	// folders under models/ so we never create files outside the configured
	// model-paths directory. Prefer models/staging — the conventional home for
	// new (unpromoted) work in a freshly scaffolded dbt project.
	let folderId: string;
	if (state.storageMode === 'filesystem') {
		const stagingFolder = state.folders.find((f) => f.id === 'models/staging');
		const anyModelsFolder = state.folders.find(
			(f) => f.parentId === null && f.id.startsWith('models/')
		);
		folderId = stagingFolder?.id ?? anyModelsFolder?.id ?? ensureDefaultFolder();
	} else {
		folderId = ensureDefaultFolder();
	}
	const n = _createNotebook(folderId);
	state.notebooks = [...state.notebooks, n];
	if (!state.openNotebookTabIds.includes(n.id)) {
		state.openNotebookTabIds = [...state.openNotebookTabIds, n.id];
	}
	state.activeTabId = n.id;
	scheduleSave();
	if (state.storageMode === 'filesystem') {
		for (const cell of n.cells) scheduleFileSave(n.id, cell.id);
	}
}

export function addNotebookInFolder(folderId: string | null): void {
	const n = _createNotebook(folderId);
	state.notebooks = [...state.notebooks, n];
	if (!state.openNotebookTabIds.includes(n.id)) {
		state.openNotebookTabIds = [...state.openNotebookTabIds, n.id];
	}
	state.activeTabId = n.id;
	scheduleSave();
	if (state.storageMode === 'filesystem') {
		for (const cell of n.cells) scheduleFileSave(n.id, cell.id);
	}
}

function getNextActiveTabId(closedNotebookId?: string): string {
	const notebookTabIds = state.openNotebookTabIds.filter((id) => id !== closedNotebookId);
	if (notebookTabIds.length > 0) return notebookTabIds[notebookTabIds.length - 1];
	if (state.openResultTabs.length > 0)
		return state.openResultTabs[state.openResultTabs.length - 1].id;
	if (state.openExtraTabs.length > 0) return state.openExtraTabs[state.openExtraTabs.length - 1].id;
	const fallback = state.notebooks.find((n) => n.id !== closedNotebookId) ?? state.notebooks[0];
	if (!fallback) return '';
	if (!state.openNotebookTabIds.includes(fallback.id)) {
		state.openNotebookTabIds = [...state.openNotebookTabIds, fallback.id];
	}
	return fallback.id;
}

export function openNotebookTab(id: string): void {
	const nb = state.notebooks.find((n) => n.id === id);
	if (!nb) return;
	const isNew = !state.openNotebookTabIds.includes(id);
	if (isNew) {
		state.openNotebookTabIds = [...state.openNotebookTabIds, id];
		if (nb.lastActiveCellId && nb.cells.some((c) => c.id === nb.lastActiveCellId)) {
			state.focusedCellId = nb.lastActiveCellId;
		}
	}
	state.activeTabId = id;
	scheduleSave();
}

export function closeNotebookTab(id: string): void {
	if (!state.openNotebookTabIds.includes(id)) return;
	if (state.openNotebookTabIds.length <= 1) return;
	state.openNotebookTabIds = state.openNotebookTabIds.filter((tabId) => tabId !== id);
	if (state.activeTabId === id) {
		state.activeTabId = getNextActiveTabId(id);
	}
	scheduleSave();
}

export function closeOtherNotebookTabs(keepId: string): void {
	if (!state.openNotebookTabIds.includes(keepId)) return;
	state.openNotebookTabIds = [keepId];
	if (state.activeTabId !== keepId) {
		state.activeTabId = keepId;
	}
	scheduleSave();
}

export function closeAllNotebookTabs(): void {
	// Keep at least 1 — prefer the active notebook tab, otherwise the first open one
	const keepId =
		state.openNotebookTabIds.find((id) => id === state.activeTabId) ?? state.openNotebookTabIds[0];
	if (!keepId) return;
	state.openNotebookTabIds = [keepId];
	state.activeTabId = keepId;
	scheduleSave();
}

export function openNotebookTabAtCell(notebookId: string, cellId: string): void {
	const nb = state.notebooks.find((n) => n.id === notebookId);
	if (!nb) return;
	if (!state.openNotebookTabIds.includes(notebookId)) {
		state.openNotebookTabIds = [...state.openNotebookTabIds, notebookId];
	}
	state.activeTabId = notebookId;
	state.focusedCellId = cellId;
	state.notebooks = state.notebooks.map((n) =>
		n.id === notebookId ? { ...n, lastActiveCellId: cellId } : n
	);
	scheduleSave();
}

export function clearFocusedCell(): void {
	state.focusedCellId = null;
}

export function getFocusedCellId(): string | null {
	return state.focusedCellId;
}

export function toggleNotebookExpanded(notebookId: string): void {
	if (state.expandedNotebookIds.includes(notebookId)) {
		state.expandedNotebookIds = state.expandedNotebookIds.filter((id) => id !== notebookId);
	} else {
		state.expandedNotebookIds = [...state.expandedNotebookIds, notebookId];
	}
	scheduleSave();
}

export function getExpandedNotebookIds(): string[] {
	return state.expandedNotebookIds;
}

export function deleteNotebook(id: string): void {
	if (state.notebooks.length <= 1) return;
	const idx = state.notebooks.findIndex((n) => n.id === id);
	if (idx === -1) return;
	const nb = state.notebooks[idx];

	// Drop DuckDB views and mark any cross-notebook referencing cells stale
	for (const cell of nb.cells) {
		if (cell.cellType !== 'query') continue;
		const viewName = getCellOutputReference(cell);
		dropView(viewName).catch(() => {});
		// Cells in other notebooks that referenced this output are now broken
		if (cell.outputName)
			markDownstreamStale(cell.outputName, 'upstream-changed', new Set(), cell.id);
	}

	// In filesystem mode, delete the notebook's file(s) from disk.
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		if (nb.format === 'luna') {
			// Cancel any pending whole-file save first so it can't recreate the
			// file right after we delete it.
			const lunaTimer = lunaSaveTimers.get(nb.id);
			if (lunaTimer) {
				clearTimeout(lunaTimer);
				lunaSaveTimers.delete(nb.id);
			}
			deleteProjectFile(state.projectFolder, `${nb.id}.luna`).catch(() => {});
		} else {
			// Flat format: each cell has its own file(s) on disk.
			// PRQL cells: delete the .prql source + the sibling .sql (dbt-compiled output).
			// SQL cells: delete the .sql source only.
			for (const cell of nb.cells) {
				const key = `${nb.id}:${cell.id}`;
				const pending = fileSaveTimers.get(key);
				if (pending) {
					clearTimeout(pending);
					fileSaveTimers.delete(key);
				}
				const rel = getRelativeCellPath(nb, cell);
				if (rel) {
					deleteProjectFile(state.projectFolder, rel).catch(() => {});
					if (cell.language !== 'sql') {
						deleteProjectFile(state.projectFolder, rel.replace(/\.prql$/, '.sql')).catch(() => {});
					}
				}
			}
		}
	}

	state.openResultTabs = state.openResultTabs.filter((t) => t.notebookId !== id);
	state.openNotebookTabIds = state.openNotebookTabIds.filter((tabId) => tabId !== id);
	state.notebooks = state.notebooks.filter((n) => n.id !== id);
	if (state.openNotebookTabIds.length === 0 && state.notebooks.length > 0) {
		state.openNotebookTabIds = [
			state.notebooks[Math.max(0, Math.min(idx, state.notebooks.length - 1))].id
		];
	}
	if (
		state.activeTabId === id ||
		(!state.notebooks.find((n) => n.id === state.activeTabId) &&
			!state.openResultTabs.find((t) => t.id === state.activeTabId) &&
			!state.openExtraTabs.find((t) => t.id === state.activeTabId))
	) {
		state.activeTabId = getNextActiveTabId(id);
	}
	scheduleSave();
}

export function duplicateNotebook(id: string): void {
	const original = state.notebooks.find((n) => n.id === id);
	if (!original) return;
	const copy: Notebook = {
		id: makeId(),
		name: `${original.name} Copy`,
		folderId: original.folderId,
		defaultCellLanguage: original.defaultCellLanguage ?? 'prql',
		cells: original.cells.map((cell, i) => ({
			...makeCell(cell.code, cell.outputName || `result${i + 1}`, cell.language ?? 'prql'),
			cellType: cell.cellType,
			outputName: cell.outputName || `result${i + 1}`,
			markdown: cell.markdown,
			markdownPreview: cell.markdownPreview,
			udfBody: cell.udfBody,
			language: cell.language ?? 'prql',
			guiStages: JSON.parse(JSON.stringify(cell.guiStages)) as GUIPipelineStage[],
			editMode: cell.editMode,
			resultViewMode: cell.resultViewMode,
			resultChartConfig: cell.resultChartConfig
				? (JSON.parse(JSON.stringify(cell.resultChartConfig)) as ChartConfig)
				: null
		}))
	};
	state.notebooks = [...state.notebooks, copy];
	if (!state.openNotebookTabIds.includes(copy.id)) {
		state.openNotebookTabIds = [...state.openNotebookTabIds, copy.id];
	}
	state.activeTabId = copy.id;
	scheduleSave();
}

export function createFolder(name: string, parentId: string | null = null): string {
	let id: string;
	if (state.storageMode === 'filesystem') {
		const safe =
			name
				.toLowerCase()
				.replace(/\s+/g, '_')
				.replace(/[^a-z0-9_]/g, '') || 'folder';
		const parent = parentId ?? 'models';
		id = `${parent}/${safe}`;
		let n = 1;
		const base = id;
		while (state.folders.some((f) => f.id === id)) id = `${base}_${n++}`;
	} else {
		id = makeId();
	}
	const folder: NotebookFolder = { id, name, parentId };
	state.folders = [...state.folders, folder];
	if (!state.expandedNotebookFolderIds.includes(folder.id)) {
		state.expandedNotebookFolderIds = [...state.expandedNotebookFolderIds, folder.id];
	}
	scheduleSave();
	return folder.id;
}

function updateDescendantIds(oldPrefix: string, newPrefix: string): void {
	for (const f of state.folders) {
		if (f.id.startsWith(oldPrefix + '/')) f.id = newPrefix + f.id.slice(oldPrefix.length);
		if (f.parentId && f.parentId.startsWith(oldPrefix))
			f.parentId = newPrefix + f.parentId.slice(oldPrefix.length);
	}
	for (const nb of state.notebooks) {
		if (nb.folderId && nb.folderId.startsWith(oldPrefix))
			nb.folderId = newPrefix + nb.folderId.slice(oldPrefix.length);
		if (nb.id.startsWith(oldPrefix + '/')) {
			const newId = newPrefix + nb.id.slice(oldPrefix.length);
			state.openNotebookTabIds = state.openNotebookTabIds.map((t) => (t === nb.id ? newId : t));
			if (state.activeTabId === nb.id) state.activeTabId = newId;
			nb.id = newId;
		}
	}
}

export function renameFolder(id: string, name: string): void {
	const folder = state.folders.find((f) => f.id === id);
	if (!folder) return;
	folder.name = name;
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		const parts = id.split('/');
		const safe =
			name
				.toLowerCase()
				.replace(/\s+/g, '_')
				.replace(/[^a-z0-9_]/g, '') || 'folder';
		parts[parts.length - 1] = safe;
		const newId = parts.join('/');
		if (newId !== id) {
			renameProjectFile(state.projectFolder, id, newId).catch(() => {});
			folder.id = newId;
			updateDescendantIds(id, newId);
		}
	}
	scheduleSave();
}

export function isFolderEmpty(id: string): boolean {
	const hasChildFolders = state.folders.some((f) => f.parentId === id);
	const hasNotebooks = state.notebooks.some((n) => n.folderId === id);
	return !hasChildFolders && !hasNotebooks;
}

export function deleteFolderIfEmpty(id: string): boolean {
	if (!isFolderEmpty(id)) return false;
	state.folders = state.folders.filter((f) => f.id !== id);
	state.expandedNotebookFolderIds = state.expandedNotebookFolderIds.filter(
		(folderId) => folderId !== id
	);
	scheduleSave();
	return true;
}

export function ensureDefaultFolder(): string {
	// In filesystem mode, folder IDs are relative paths (e.g. models/notebooks).
	// Ignore UUID-based folders that may still be in state from local mode.
	const existing = state.folders.find(
		(f) =>
			f.parentId === null &&
			f.name === 'Notebooks' &&
			(state.storageMode !== 'filesystem' || f.id.startsWith('models/'))
	);
	if (existing) return existing.id;
	return createFolder('Notebooks', null);
}

export function moveNotebookToFolder(notebookId: string, folderId: string | null): void {
	if (folderId && !state.folders.some((f) => f.id === folderId)) return;
	const notebook = state.notebooks.find((n) => n.id === notebookId);
	if (!notebook) return;

	if (state.storageMode === 'filesystem' && state.projectFolder && notebook.id.includes('/')) {
		const targetDir = folderId ?? 'models';
		const modelName = notebook.id.split('/').pop() ?? notebook.name;
		const newId = `${targetDir}/${modelName}`;
		for (const cell of notebook.cells) {
			const oldRel = getRelativeCellPath(notebook, cell);
			if (oldRel) {
				const ext = cell.language === 'sql' ? '.sql' : '.prql';
				const newRel = `${targetDir}/${cell.outputName}${ext}`;
				renameProjectFile(state.projectFolder, oldRel, newRel).catch(() => {});
				if (cell.language !== 'sql') {
					renameProjectFile(
						state.projectFolder,
						oldRel.replace(/\.prql$/, '.sql'),
						newRel.replace(/\.prql$/, '.sql')
					).catch(() => {});
				}
			}
		}
		state.openNotebookTabIds = state.openNotebookTabIds.map((t) => (t === notebookId ? newId : t));
		if (state.activeTabId === notebookId) state.activeTabId = newId;
		notebook.id = newId;
	}

	notebook.folderId = folderId;
	scheduleSave();
}

export function renameNotebook(id: string, name: string): void {
	const nb = state.notebooks.find((n) => n.id === id);
	if (!nb) return;

	if (state.storageMode === 'filesystem' && state.projectFolder && nb.id.includes('/')) {
		// Rename the cell file on disk by moving it
		const dir = nb.id.substring(0, nb.id.lastIndexOf('/'));
		const newId = `${dir}/${name}`;
		const firstCell = nb.cells[0];
		const ext = firstCell?.language === 'sql' ? '.sql' : '.prql';
		const oldRel = `${nb.id}${ext}`;
		const newRel = `${newId}${ext}`;

		const oldCellId = firstCell?.id;
		nb.name = name;
		nb.id = newId;
		if (firstCell) {
			firstCell.outputName = name;
			firstCell.materializeTarget = name;
			firstCell.id = name;
		}

		// Update open tab references
		state.openNotebookTabIds = state.openNotebookTabIds.map((t) => (t === id ? newId : t));
		if (state.activeTabId === id) state.activeTabId = newId;

		renameProjectFile(state.projectFolder, oldRel, newRel).catch(() => {});
		if (firstCell?.language !== 'sql') {
			// Also rename the companion dbt-compiled .sql file for PRQL cells
			renameProjectFile(
				state.projectFolder,
				oldRel.replace(/\.prql$/, '.sql'),
				newRel.replace(/\.prql$/, '.sql')
			).catch(() => {});
		}
	} else {
		nb.name = name;
	}

	scheduleSave();
}

export function setFolderExpanded(folderId: string, expanded: boolean): void {
	const hasFolder = state.folders.some((f) => f.id === folderId);
	if (!hasFolder) return;
	const set = new Set(state.expandedNotebookFolderIds);
	if (expanded) set.add(folderId);
	else set.delete(folderId);
	state.expandedNotebookFolderIds = [...set];
	scheduleSave();
}

export function setSidebarSectionExpanded(section: SidebarSection, expanded: boolean): void {
	state.sidebarSectionsExpanded = {
		...state.sidebarSectionsExpanded,
		[section]: expanded
	};
	scheduleSave();
}

export function setActiveTab(tabId: string): void {
	state.activeTabId = tabId;
	scheduleSave();
}

export function openResultTab(
	cellId: string,
	notebookId: string,
	name: string,
	preferredViewMode: ResultViewMode = 'table'
): void {
	const existing = state.openResultTabs.find(
		(t) => t.cellId === cellId && t.notebookId === notebookId
	);
	if (existing) {
		existing.viewMode = preferredViewMode;
		state.activeTabId = existing.id;
		scheduleSave();
		return;
	}
	const tab: ResultTabInfo = {
		id: makeId(),
		cellId,
		notebookId,
		name,
		viewMode: preferredViewMode,
		chartConfig: null
	};
	state.openResultTabs = [...state.openResultTabs, tab];
	state.activeTabId = tab.id;
	scheduleSave();
}

export function closeResultTab(id: string): void {
	const idx = state.openResultTabs.findIndex((t) => t.id === id);
	state.openResultTabs = state.openResultTabs.filter((t) => t.id !== id);
	if (state.activeTabId === id) {
		if (state.openResultTabs.length > 0) {
			const newIdx = Math.max(0, idx - 1);
			state.activeTabId = state.openResultTabs[newIdx]?.id ?? state.notebooks[0].id;
		} else {
			state.activeTabId = state.notebooks[0].id;
		}
	}
	scheduleSave();
}

export function closeOtherResultTabs(keepId: string): void {
	const keep = state.openResultTabs.find((t) => t.id === keepId);
	if (!keep) return;
	state.openResultTabs = [keep];
	if (state.activeTabId !== keepId) state.activeTabId = keepId;
	scheduleSave();
}

export function closeAllResultTabs(): void {
	state.openResultTabs = [];
	if (
		!state.openNotebookTabIds.includes(state.activeTabId) &&
		!state.openExtraTabs.find((t) => t.id === state.activeTabId)
	) {
		state.activeTabId = state.openNotebookTabIds[0] ?? state.notebooks[0].id;
	}
	scheduleSave();
}

export function openTableViewTab(tableName: string): void {
	const existing = state.openExtraTabs.find(
		(t) => t.type === 'table-view' && t.tableName === tableName
	);
	if (existing) {
		state.activeTabId = existing.id;
		return;
	}
	const tab: ExtraTab = {
		id: makeId(),
		type: 'table-view',
		tableName,
		name: tableName,
		viewMode: 'table',
		chartConfig: null
	};
	state.openExtraTabs = [...state.openExtraTabs, tab];
	state.activeTabId = tab.id;
}

export function openProfileTab(tableName: string): void {
	const existing = state.openExtraTabs.find(
		(t) => t.type === 'profile' && t.tableName === tableName
	);
	if (existing) {
		state.activeTabId = existing.id;
		return;
	}
	const tab: ExtraTab = {
		id: makeId(),
		type: 'profile',
		tableName,
		name: `Profile: ${tableName}`,
		viewMode: 'table',
		chartConfig: null
	};
	state.openExtraTabs = [...state.openExtraTabs, tab];
	state.activeTabId = tab.id;
}

export function openLineageTab(focusedModelName?: string): void {
	const existing = state.openExtraTabs.find((t) => t.type === 'lineage');
	if (existing) {
		if (focusedModelName)
			(existing as ExtraTab & { focusedModelName?: string }).focusedModelName = focusedModelName;
		state.activeTabId = existing.id;
		return;
	}
	const tab: ExtraTab = {
		id: makeId(),
		type: 'lineage',
		tableName: '',
		name: 'Lineage',
		viewMode: 'table',
		chartConfig: null,
		focusedModelName
	};
	state.openExtraTabs = [...state.openExtraTabs, tab];
	state.activeTabId = tab.id;
}

export function closeExtraTab(id: string): void {
	const idx = state.openExtraTabs.findIndex((t) => t.id === id);
	state.openExtraTabs = state.openExtraTabs.filter((t) => t.id !== id);
	if (state.activeTabId === id) {
		if (state.openExtraTabs.length > 0) {
			const newIdx = Math.max(0, idx - 1);
			state.activeTabId = state.openExtraTabs[newIdx]?.id ?? state.notebooks[0].id;
		} else if (state.openResultTabs.length > 0) {
			state.activeTabId = state.openResultTabs[state.openResultTabs.length - 1].id;
		} else {
			state.activeTabId = state.notebooks[0].id;
		}
	}
}

export function closeOtherExtraTabs(keepId: string): void {
	const keep = state.openExtraTabs.find((t) => t.id === keepId);
	if (!keep) return;
	state.openExtraTabs = [keep];
	if (state.activeTabId !== keepId) state.activeTabId = keepId;
}

export function closeAllExtraTabs(): void {
	state.openExtraTabs = [];
	if (
		!state.openNotebookTabIds.includes(state.activeTabId) &&
		!state.openResultTabs.find((t) => t.id === state.activeTabId)
	) {
		state.activeTabId = state.openNotebookTabIds[0] ?? state.notebooks[0].id;
	}
}

export function setTabViewMode(tabId: string, mode: ResultViewMode): void {
	const rt = state.openResultTabs.find((t) => t.id === tabId);
	if (rt) {
		rt.viewMode = mode;
		scheduleSave();
		return;
	}
	const et = state.openExtraTabs.find((t) => t.id === tabId);
	if (et) {
		et.viewMode = mode;
		scheduleSave();
	}
}

export function setCellResultViewMode(cellId: string, mode: ResultViewMode): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === cellId);
	if (!cell) return;
	cell.resultViewMode = mode;
	scheduleSave();
}

export function setCellResultChartConfig(cellId: string, config: ChartConfig | null): void {
	// Search all notebooks so this works regardless of which tab is active.
	for (const nb of state.notebooks) {
		const cell = nb.cells.find((c) => c.id === cellId);
		if (cell) {
			cell.resultChartConfig = config;
			scheduleSave();
			return;
		}
	}
}

export function setTabChartConfig(tabId: string, config: ChartConfig | null): void {
	const rt = state.openResultTabs.find((t) => t.id === tabId);
	if (rt) {
		rt.chartConfig = config;
		scheduleSave();
		return;
	}
	const et = state.openExtraTabs.find((t) => t.id === tabId);
	if (et) {
		et.chartConfig = config;
		scheduleSave();
	}
}

// ── Cell actions ─────────────────────────────────────────────────────────────

/** Generate a project-unique outputName for a new cell. */
function generateUniqueOutputName(): string {
	const allNames = new Set(
		state.notebooks.flatMap((nb) => nb.cells.map((c) => c.outputName)).filter(Boolean)
	);
	let name = 'new_model';
	let counter = 1;
	while (allNames.has(name)) {
		name = `new_model_${counter++}`;
	}
	return name;
}

/**
 * Add a new query cell with the given language.
 *
 * In filesystem mode each cell maps to its own .prql/.sql file. New cells are
 * immediately queued for a file save (with a @notebook annotation so the
 * file-watcher reload re-groups them under the correct notebook). During the
 * debounce window, loadProjectNotebooks preserves cells whose save is pending.
 */
export function addCellWithLanguage(lang: CellLanguage): void {
	const nb = getActiveNotebook();
	const queryCells = nb.cells.filter((c) => c.cellType === 'query');
	const previousQueryCell = queryCells[queryCells.length - 1] ?? null;
	const inheritedSource = lang === 'prql' ? getPreviousCellOutputReference(queryCells) : null;
	const guiStages = makeInheritedGuiStages(inheritedSource ?? '');
	const code = inheritedSource ? makeInheritedGuiCode(inheritedSource) : '';
	pushHistoryCheckpoint(nb.id);

	if (state.storageMode === 'filesystem' && state.projectFolder) {
		const outputName = generateUniqueOutputName();
		const newCell: Cell = {
			...makeCell(code, outputName, lang),
			id: outputName, // filesystem cells use outputName as stable id
			connectionId: previousQueryCell?.connectionId ?? null,
			guiStages,
			editMode: lang === 'sql' ? 'prql' : 'gui'
		};
		nb.cells = [...nb.cells, newCell];
		scheduleSave();
		scheduleFileSave(nb.id, newCell.id);
		return;
	}

	const outputName = generateUniqueOutputName();
	nb.cells = [
		...nb.cells,
		{
			...makeCell(code, outputName, lang),
			connectionId: previousQueryCell?.connectionId ?? null,
			guiStages,
			editMode: lang === 'sql' ? 'prql' : 'gui'
		}
	];
	scheduleSave();
}

export function addCell(): void {
	const nb = getActiveNotebook();
	addCellWithLanguage(nb.defaultCellLanguage ?? 'sql');
}

export function addMarkdownCell(): void {
	const nb = getActiveNotebook();
	pushHistoryCheckpoint(nb.id);

	if (state.storageMode === 'filesystem' && state.projectFolder) {
		const outputName = generateUniqueOutputName();
		const mdCell = makeMarkdownCell('');
		mdCell.id = outputName;
		mdCell.outputName = outputName;
		nb.cells = [...nb.cells, mdCell];
		scheduleSave();
		scheduleFileSave(nb.id, mdCell.id);
		return;
	}

	nb.cells = [...nb.cells, makeMarkdownCell('')];
	scheduleSave();
}

/** UDF cells (Python, compiled to Trino's inline `WITH FUNCTION` syntax) have no
 *  natural .prql/.sql file mapping since they aren't dbt models. In filesystem
 *  (dbt project) mode they're only supported in .luna-format notebooks — flat
 *  one-file-per-cell projects have no way to represent one. Outside filesystem
 *  mode (plain in-browser notebooks) there's no file mapping at all, so they're
 *  always allowed. */
export function canAddUdfCell(): boolean {
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		const nb = getActiveNotebook();
		return nb.format === 'luna';
	}
	return true;
}

export function addUdfCell(): void {
	if (!canAddUdfCell()) return;
	const nb = getActiveNotebook();
	pushHistoryCheckpoint(nb.id);
	const cell = makeUdfCell();
	cell.outputName = deconflictOutputName(cell.outputName);
	nb.cells = [...nb.cells, cell];
	scheduleSave();
	scheduleFileSave(nb.id, cell.id);
}

export function insertUdfCellAfter(id: string): void {
	if (!canAddUdfCell()) return;
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	pushHistoryCheckpoint(nb.id);
	const cell = makeUdfCell();
	cell.outputName = deconflictOutputName(cell.outputName);
	const cells = [...nb.cells];
	cells.splice(idx + 1, 0, cell);
	nb.cells = cells;
	scheduleSave();
	scheduleFileSave(nb.id, cell.id);
}

export function insertUdfCellBefore(id: string): void {
	if (!canAddUdfCell()) return;
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	pushHistoryCheckpoint(nb.id);
	const cell = makeUdfCell();
	cell.outputName = deconflictOutputName(cell.outputName);
	const cells = [...nb.cells];
	cells.splice(idx, 0, cell);
	nb.cells = cells;
	scheduleSave();
	scheduleFileSave(nb.id, cell.id);
}

/** Append a query or markdown cell at the end of the active notebook; returns the new cell id. */
export function appendCellAtEnd(data: {
	outputName: string;
	code: string;
	language: CellLanguage;
	editMode: CellEditMode;
	guiStages: GUIPipelineStage[];
	markdown?: string;
	connectionId?: string | null;
}): string {
	const nb = getActiveNotebook();
	const lastQueryCell = nb.cells.filter((c) => c.cellType === 'query').at(-1) ?? null;
	const inheritedConnection =
		data.connectionId === undefined ? (lastQueryCell?.connectionId ?? null) : data.connectionId;
	const inFsMode = state.storageMode === 'filesystem' && !!state.projectFolder;
	const outputName = data.outputName || (inFsMode ? generateUniqueOutputName() : data.outputName);
	let newCell: Cell;
	if (data.markdown !== undefined) {
		newCell = { ...makeMarkdownCell(data.markdown), outputName };
	} else {
		newCell = {
			...makeCell(data.code, outputName, data.language),
			guiStages: data.guiStages,
			editMode: data.editMode,
			connectionId: inheritedConnection
		};
	}
	// Filesystem cells use outputName as the stable id (see addCellWithLanguage/addMarkdownCell).
	if (inFsMode) newCell.id = outputName;
	nb.cells = [...nb.cells, newCell];
	scheduleSave();
	if (inFsMode) scheduleFileSave(nb.id, newCell.id);
	return newCell.id;
}

export function insertMarkdownCellAfter(id: string): void {
	const nb = getActiveNotebook();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		// Filesystem mode has no mid-list insert (cells map to files); append.
		addMarkdownCell();
		return;
	}
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	const cells = [...nb.cells];
	cells.splice(idx + 1, 0, makeMarkdownCell(''));
	nb.cells = cells;
	scheduleSave();
}

export function insertMarkdownCellBefore(id: string): void {
	const nb = getActiveNotebook();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		addMarkdownCell();
		return;
	}
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	const cells = [...nb.cells];
	cells.splice(idx, 0, makeMarkdownCell(''));
	nb.cells = cells;
	scheduleSave();
}

export function addCellBefore(id: string): void {
	const nb = getActiveNotebook();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		addCellWithLanguage(nb.defaultCellLanguage ?? 'sql');
		return;
	}
	const lang = nb.defaultCellLanguage ?? 'sql';
	insertCellBefore(id, {
		outputName: '',
		code: '',
		guiStages: [{ type: 'from', table: '' }],
		editMode: lang === 'sql' ? 'prql' : 'gui',
		language: lang
	});
}

export function addCellAfter(id: string): void {
	const nb = getActiveNotebook();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		addCellWithLanguage(nb.defaultCellLanguage ?? 'sql');
		return;
	}
	const lang = nb.defaultCellLanguage ?? 'sql';
	insertCellAfter(id, {
		outputName: '',
		code: '',
		guiStages: [{ type: 'from', table: '' }],
		editMode: lang === 'sql' ? 'prql' : 'gui',
		connectionId: undefined,
		language: lang
	});
}

export function insertCellBefore(
	id: string,
	data: {
		outputName: string;
		code: string;
		guiStages: GUIPipelineStage[];
		editMode: CellEditMode;
		language?: CellLanguage;
	}
): void {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	pushHistoryCheckpoint(nb.id);
	// Inherit from the nearest preceding query cell (skipping markdown, which always
	// has connectionId: null), same rationale as insertCellAfter.
	const lastQueryCell =
		nb.cells
			.slice(0, idx)
			.filter((c) => c.cellType === 'query')
			.at(-1) ?? null;
	const inFsMode = state.storageMode === 'filesystem' && !!state.projectFolder;
	const outputName = data.outputName || (inFsMode ? generateUniqueOutputName() : data.outputName);
	const newCell: Cell = {
		...makeCell(data.code, outputName, data.language ?? nb.defaultCellLanguage ?? 'sql'),
		guiStages: data.guiStages,
		editMode: data.editMode,
		connectionId: lastQueryCell?.connectionId ?? null
	};
	// Filesystem cells use outputName as the stable id (see addCellWithLanguage/addMarkdownCell).
	if (inFsMode) newCell.id = outputName;
	const cells = [...nb.cells];
	cells.splice(idx, 0, newCell);
	nb.cells = cells;
	scheduleSave();
	if (inFsMode) scheduleFileSave(nb.id, newCell.id);
}

export function insertCellAfter(
	id: string,
	data: {
		outputName: string;
		code: string;
		guiStages: GUIPipelineStage[];
		editMode: CellEditMode;
		connectionId?: string | null;
		language?: CellLanguage;
	}
): string {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return '';
	pushHistoryCheckpoint(nb.id);
	// Inherit from the nearest preceding query cell — the anchor itself may be a
	// markdown cell, which always has connectionId: null and would otherwise force
	// new cells back to the builtin DuckDB connection.
	const lastQueryCell =
		nb.cells
			.slice(0, idx + 1)
			.filter((c) => c.cellType === 'query')
			.at(-1) ?? null;
	const inheritedConnection =
		data.connectionId === undefined ? (lastQueryCell?.connectionId ?? null) : data.connectionId;
	const inFsMode = state.storageMode === 'filesystem' && !!state.projectFolder;
	const outputName = data.outputName || (inFsMode ? generateUniqueOutputName() : data.outputName);
	const newCell: Cell = {
		...makeCell(data.code, outputName, data.language ?? nb.defaultCellLanguage ?? 'sql'),
		guiStages: data.guiStages,
		editMode: data.editMode,
		connectionId: inheritedConnection
	};
	// Filesystem cells use outputName as the stable id (see addCellWithLanguage/addMarkdownCell).
	if (inFsMode) newCell.id = outputName;
	const cells = [...nb.cells];
	cells.splice(idx + 1, 0, newCell);
	nb.cells = cells;
	scheduleSave();
	if (inFsMode) scheduleFileSave(nb.id, newCell.id);
	return newCell.id;
}

export function removeCell(id: string): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (cell) {
		pushHistoryCheckpoint(nb.id);
		clearGuiCompileTimer(id);
		const viewName = cell.outputName || `_cell_${cell.id}`;
		dropView(viewName).catch(() => {});

		if (state.storageMode === 'filesystem' && state.projectFolder) {
			if (nb.format !== 'luna') {
				// Flat format: the cell has its own file(s) on disk. Cancel any
				// in-flight debounced save first so it can't resurrect the file
				// after we delete it.
				const key = `${nb.id}:${id}`;
				const pending = fileSaveTimers.get(key);
				if (pending) {
					clearTimeout(pending);
					fileSaveTimers.delete(key);
				}
				const rel = getRelativeCellPath(nb, cell);
				if (rel) {
					deleteProjectFile(state.projectFolder, rel).catch(() => {});
					if (cell.language !== 'sql') {
						deleteProjectFile(state.projectFolder, rel.replace(/\.prql$/, '.sql')).catch(() => {});
					}
				}
			}
		}
	}
	nb.cells = nb.cells.filter((c) => c.id !== id);
	scheduleSave();
	if (state.storageMode === 'filesystem' && nb.format === 'luna') {
		scheduleLunaNotebookSave(nb.id);
	}
}

export interface CellSnapshot {
	id: string;
	outputName: string;
	code: string;
	markdown: string;
	udfBody: string;
	language: CellLanguage;
	cellType: CellType;
	display: CellDisplay;
	guiStages: GUIPipelineStage[];
	editMode: CellEditMode;
	connectionId: string | null;
	materializeMode: CellMaterializationMode;
	materializeTarget: string;
	description: string | null;
	dbtTags: string[];
	scheduleEnabled: boolean;
	scheduleIntervalMinutes: number;
	scheduleScope: CellScheduleScope;
	// Runtime/result fields — captured so a restore can recreate a cell that was deleted
	// (during AI generation, or by removeCell+undo) without blanking its output. Optional
	// for back-compat with older in-memory snapshots.
	result?: Cell['result'];
	status?: Cell['status'];
	resultViewMode?: Cell['resultViewMode'];
	resultChartConfig?: Cell['resultChartConfig'];
	executionMs?: Cell['executionMs'];
	errors?: Cell['errors'];
}

function cellToSnapshot(cell: Cell): CellSnapshot {
	return {
		id: cell.id,
		outputName: cell.outputName,
		code: cell.code,
		markdown: cell.markdown,
		udfBody: cell.udfBody,
		language: cell.language,
		cellType: cell.cellType,
		display: cell.display,
		guiStages: cell.guiStages,
		editMode: cell.editMode,
		connectionId: cell.connectionId,
		materializeMode: cell.materializeMode,
		materializeTarget: cell.materializeTarget,
		description: cell.description,
		dbtTags: cell.dbtTags,
		scheduleEnabled: cell.scheduleEnabled,
		scheduleIntervalMinutes: cell.scheduleIntervalMinutes,
		scheduleScope: cell.scheduleScope,
		result: cell.result,
		status: cell.status,
		resultViewMode: cell.resultViewMode,
		resultChartConfig: cell.resultChartConfig,
		executionMs: cell.executionMs,
		errors: cell.errors
	};
}

/** Restore cells to a snapshot (AI-generation undo, or notebook-level undo/redo),
 *  preserving execution results for cells that are still live. */
export function restoreCellSnapshots(notebookId: string, snapCells: CellSnapshot[]): void {
	const nb = state.notebooks.find((n) => n.id === notebookId);
	if (!nb) return;

	const liveCells = nb.cells;
	const codeChangedIds = new Set<string>();
	const restoredCells = snapCells.map((snap) => {
		const live = liveCells.find((c) => c.id === snap.id);
		if (live) {
			if (live.cellType === 'query' && live.code !== snap.code) codeChangedIds.add(snap.id);
			return {
				...live,
				outputName: snap.outputName,
				code: snap.code,
				markdown: snap.markdown,
				udfBody: snap.udfBody,
				language: snap.language,
				cellType: snap.cellType,
				display: snap.display,
				guiStages: snap.guiStages,
				editMode: snap.editMode,
				connectionId: snap.connectionId,
				materializeMode: snap.materializeMode,
				materializeTarget: snap.materializeTarget,
				description: snap.description,
				dbtTags: snap.dbtTags,
				scheduleEnabled: snap.scheduleEnabled,
				scheduleIntervalMinutes: snap.scheduleIntervalMinutes,
				scheduleScope: snap.scheduleScope
			} satisfies Cell;
		}
		return {
			...makeCell(snap.code, snap.outputName, snap.language),
			// Preserve the original id so anything still referencing it (open result
			// tabs, schedule timers, etc.) reattaches instead of dangling.
			id: snap.id,
			cellType: snap.cellType,
			markdown: snap.markdown,
			udfBody: snap.udfBody,
			display: snap.display,
			guiStages: snap.guiStages,
			editMode: snap.editMode,
			connectionId: snap.connectionId,
			materializeMode: snap.materializeMode,
			materializeTarget: snap.materializeTarget,
			description: snap.description,
			dbtTags: snap.dbtTags,
			scheduleEnabled: snap.scheduleEnabled,
			scheduleIntervalMinutes: snap.scheduleIntervalMinutes,
			scheduleScope: snap.scheduleScope,
			// Restore captured runtime/result state so a recreated cell keeps its output.
			...(snap.result !== undefined && { result: snap.result }),
			...(snap.status !== undefined && { status: snap.status }),
			...(snap.resultViewMode !== undefined && { resultViewMode: snap.resultViewMode }),
			...(snap.resultChartConfig !== undefined && { resultChartConfig: snap.resultChartConfig }),
			...(snap.executionMs !== undefined && { executionMs: snap.executionMs }),
			...(snap.errors !== undefined && { errors: snap.errors })
		} satisfies Cell;
	});

	nb.cells = restoredCells;

	// Live cells whose code changed need their compiled SQL/diagnostics refreshed against
	// the fully-restored cell list (dependency resolution looks at sibling cells), so this
	// runs as a second pass once nb.cells holds the final array.
	for (const cell of nb.cells) {
		if (!codeChangedIds.has(cell.id)) continue;
		const idx = nb.cells.indexOf(cell);
		cell.needsRun = true;
		cell.staleReason = 'code-changed';
		cell.staleSources = [];
		const { errors, sql } = getCompiledCellSQL(nb.cells, idx);
		cell.errors = errors;
		cell.compiledSQL = sql;
	}

	scheduleSave();
}

// ── Undo/redo history ────────────────────────────────────────────────────────
// Session-only (never persisted): a per-notebook stack of CellSnapshot arrays.
// Structural mutations push a checkpoint of the pre-mutation cell list; continuous
// text mutations (updateCellCode/updateCellMarkdown/updateGuiStages) coalesce a
// burst of edits into a single checkpoint via checkpointCoalesced below.
const MAX_HISTORY_DEPTH = 50;
const historyStacks = new Map<string, { undo: CellSnapshot[][]; redo: CellSnapshot[][] }>();

function snapshotNotebookCells(nb: Notebook): CellSnapshot[] {
	return nb.cells.map(cellToSnapshot);
}

function pushHistoryCheckpoint(notebookId: string): void {
	const nb = state.notebooks.find((n) => n.id === notebookId);
	if (!nb) return;
	let entry = historyStacks.get(notebookId);
	if (!entry) {
		entry = { undo: [], redo: [] };
		historyStacks.set(notebookId, entry);
	}
	entry.undo.push(snapshotNotebookCells(nb));
	// Depth cap: oldest steps are silently dropped once the stack overflows — intentional,
	// not a bug, since history is session-only and unbounded growth would leak memory.
	if (entry.undo.length > MAX_HISTORY_DEPTH) entry.undo.shift();
	entry.redo = [];
}

/** Apply a history snapshot and, in filesystem mode, re-save any cell that was
 *  deleted (and is therefore not in the live notebook) so its file reappears. */
function applyHistorySnapshot(notebookId: string, snap: CellSnapshot[]): void {
	const nb = state.notebooks.find((n) => n.id === notebookId);
	if (!nb) return;
	const liveIds = new Set(nb.cells.map((c) => c.id));
	restoreCellSnapshots(notebookId, snap);
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		for (const s of snap) {
			if (!liveIds.has(s.id)) scheduleFileSave(notebookId, s.id);
		}
	}
}

export function undo(): void {
	const nb = getActiveNotebook();
	const entry = historyStacks.get(nb.id);
	if (!entry || entry.undo.length === 0) return;
	const prev = entry.undo.pop()!;
	entry.redo.push(snapshotNotebookCells(nb));
	if (entry.redo.length > MAX_HISTORY_DEPTH) entry.redo.shift();
	applyHistorySnapshot(nb.id, prev);
}

export function redo(): void {
	const nb = getActiveNotebook();
	const entry = historyStacks.get(nb.id);
	if (!entry || entry.redo.length === 0) return;
	const next = entry.redo.pop()!;
	entry.undo.push(snapshotNotebookCells(nb));
	if (entry.undo.length > MAX_HISTORY_DEPTH) entry.undo.shift();
	applyHistorySnapshot(nb.id, next);
}

export function canUndo(): boolean {
	return (historyStacks.get(getActiveNotebook().id)?.undo.length ?? 0) > 0;
}

export function canRedo(): boolean {
	return (historyStacks.get(getActiveNotebook().id)?.redo.length ?? 0) > 0;
}

// Coalesces a burst of continuous edits (e.g. every keystroke in updateCellCode) into a
// single undo checkpoint: the first call in a burst checkpoints the pre-burst state, and
// subsequent calls within the idle window just reset the timer rather than checkpointing again.
const COALESCE_IDLE_MS = 800;
const coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function checkpointCoalesced(notebookId: string, cellId: string, field: string): void {
	const key = `${notebookId}:${cellId}:${field}`;
	const existing = coalesceTimers.get(key);
	if (existing) {
		clearTimeout(existing);
	} else {
		pushHistoryCheckpoint(notebookId);
	}
	coalesceTimers.set(
		key,
		setTimeout(() => coalesceTimers.delete(key), COALESCE_IDLE_MS)
	);
}

// ── Clipboard (copy/paste/duplicate) ────────────────────────────────────────
const CLIPBOARD_MIME_MARKER = '__lunaCell';
let cellClipboard = $state<CellSnapshot | null>(null);

/** Deconflicts against outputNames across the whole project, not just one
 *  notebook — dbt requires model names to be globally unique, and
 *  getGlobalOutputRegistry()/cell-deps.ts resolve outputNames project-wide. */
function deconflictOutputName(baseName: string): string {
	const existing = new Set(
		state.notebooks.flatMap((nb) => nb.cells.map((c) => c.outputName)).filter(Boolean)
	);
	return deconflictName(existing, baseName);
}

/** Clone a cell and insert the clone immediately after it. */
export function duplicateCell(id: string): string {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return '';
	pushHistoryCheckpoint(nb.id);
	const source = nb.cells[idx];
	const outputName = deconflictOutputName(source.outputName);
	const clone: Cell = {
		...source,
		id: makeId(),
		outputName,
		materializeTarget: outputName || source.materializeTarget,
		// A duplicate isn't the model that was promoted — it's a fresh, unpromoted copy.
		promotedModelPath: null,
		// Avoid silently doubling a running schedule — the duplicate starts disabled.
		scheduleEnabled: false,
		scheduleNextRunAt: null
	};
	const cells = [...nb.cells];
	cells.splice(idx + 1, 0, clone);
	nb.cells = cells;
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) scheduleFileSave(nb.id, clone.id);
	return clone.id;
}

/** Copy a cell's authoring fields to the in-memory clipboard, mirrored to the
 *  system clipboard (best-effort) so paste also works across browser tabs. */
export function copyCellToClipboard(id: string): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	cellClipboard = cellToSnapshot(cell);
	if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
		const payload = JSON.stringify({
			[CLIPBOARD_MIME_MARKER]: true,
			version: 1,
			cell: cellClipboard
		});
		navigator.clipboard.writeText(payload).catch(() => {});
	}
}

export function hasClipboardCell(): boolean {
	return cellClipboard !== null;
}

async function readClipboardSnapshot(): Promise<CellSnapshot | null> {
	if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
		try {
			const text = await navigator.clipboard.readText();
			const parsed = JSON.parse(text);
			if (
				isPlainObject(parsed) &&
				parsed[CLIPBOARD_MIME_MARKER] === true &&
				isPlainObject(parsed.cell)
			) {
				return parsed.cell as unknown as CellSnapshot;
			}
		} catch {
			// Not JSON, no clipboard permission, or not a Luna cell — fall back below.
		}
	}
	return cellClipboard;
}

/** Paste the clipboard cell immediately after `afterId` (or at the end of the
 *  active notebook if `afterId` is null). Returns the new cell id, or '' if the
 *  clipboard is empty. */
export async function pasteCellAfter(afterId: string | null): Promise<string> {
	const nb = getActiveNotebook();
	const snap = await readClipboardSnapshot();
	if (!snap) return '';
	pushHistoryCheckpoint(nb.id);
	const outputName = deconflictOutputName(snap.outputName);
	const newCell: Cell = {
		...makeCell(snap.code, outputName, snap.language),
		cellType: snap.cellType,
		markdown: snap.markdown,
		display: snap.display,
		guiStages: snap.guiStages,
		editMode: snap.editMode,
		connectionId: snap.connectionId,
		materializeMode: snap.materializeMode,
		materializeTarget: outputName || snap.materializeTarget,
		description: snap.description,
		dbtTags: snap.dbtTags,
		scheduleScope: snap.scheduleScope
		// scheduleEnabled intentionally left at the makeCell default (false).
	};
	const insertAt = afterId ? nb.cells.findIndex((c) => c.id === afterId) : nb.cells.length - 1;
	const cells = [...nb.cells];
	cells.splice((insertAt === -1 ? nb.cells.length - 1 : insertAt) + 1, 0, newCell);
	nb.cells = cells;
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder)
		scheduleFileSave(nb.id, newCell.id);
	return newCell.id;
}

// Drag-reorder: move a cell to an explicit index (used by SortableJS onEnd).
export function reorderCell(id: string, toIndex: number): void {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	const target = Math.max(0, Math.min(toIndex, nb.cells.length - 1));
	if (target === idx) return;
	pushHistoryCheckpoint(nb.id);
	const cells = [...nb.cells];
	const [cell] = cells.splice(idx, 1);
	cells.splice(target, 0, cell);
	nb.cells = cells;
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) scheduleFileSave(nb.id, id);
}

export function moveCell(id: string, direction: 'up' | 'down'): void {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	const newIdx = direction === 'up' ? idx - 1 : idx + 1;
	if (newIdx < 0 || newIdx >= nb.cells.length) return;
	pushHistoryCheckpoint(nb.id);
	const cells = [...nb.cells];
	[cells[idx], cells[newIdx]] = [cells[newIdx], cells[idx]];
	nb.cells = cells;
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) scheduleFileSave(nb.id, id);
}

export function updateCellCode(id: string, code: string): void {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	const cell = nb.cells[idx];
	if (cell.cellType !== 'query') return;
	checkpointCoalesced(nb.id, id, 'code');
	cell.code = code;
	cell.needsRun = true;
	cell.staleReason = 'code-changed';
	cell.staleSources = [];
	const { errors, sql } = getCompiledCellSQL(nb.cells, idx);
	cell.errors = errors;
	cell.compiledSQL = sql;
	scheduleSave();
	scheduleFileSave(nb.id, id);
}

export function updateCellMarkdown(id: string, markdown: string): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell || cell.cellType !== 'markdown') return;
	checkpointCoalesced(nb.id, id, 'markdown');
	cell.markdown = markdown;
	scheduleSave();
	scheduleFileSave(nb.id, id);
}

export function updateCellUdfBody(id: string, udfBody: string): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell || cell.cellType !== 'udf') return;
	checkpointCoalesced(nb.id, id, 'udfBody');
	const oldName = cell.outputName;
	cell.udfBody = udfBody;
	const sig = parseUdfSignature(udfBody);
	if ('error' in sig) {
		cell.errors = [
			{
				kind: 'udf',
				code: null,
				reason: sig.error,
				hint: null,
				span: null,
				display: sig.error,
				location: null
			}
		];
	} else {
		cell.errors = [];
		const newName = sig.name === oldName ? oldName : deconflictOutputName(sig.name);
		cell.outputName = newName;
		cell.materializeTarget = newName;
		if (oldName && oldName !== newName)
			markDownstreamStale(oldName, 'upstream-changed', new Set(), cell.id);
	}
	scheduleSave();
	scheduleFileSave(nb.id, id);
}

export function setCellMarkdownPreview(id: string, preview: boolean): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell || cell.cellType !== 'markdown') return;
	cell.markdownPreview = preview;
	scheduleSave();
}

export function updateCellName(id: string, name: string): { ok: true } | { ok: false; error: string } {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return { ok: false, error: 'Cell not found' };
	if (
		name &&
		name !== cell.outputName &&
		state.notebooks.some((n) => n.cells.some((c) => c.id !== cell.id && c.outputName === name))
	) {
		return { ok: false, error: `"${name}" is already used by another model in this project` };
	}
	const oldName = cell.outputName;
	// In filesystem mode, rename the .prql file and keep notebook/tab IDs in sync.
	if (state.storageMode === 'filesystem' && state.projectFolder && cell.outputName) {
		const oldPath = getRelativeCellPath(nb, cell);
		cell.outputName = name;
		cell.materializeTarget = name;
		const newPath = getRelativeCellPath(nb, cell);

		// When the notebook ID is path-based (contains '/'), the ID encodes the
		// model name as its last segment. Update it so that the file-watcher reload
		// doesn't see the old ID as "missing" and close the open tab.
		const oldNbId = nb.id;
		if (nb.id.includes('/') && oldName) {
			const dir = nb.id.substring(0, nb.id.lastIndexOf('/'));
			const newNbId = `${dir}/${name}`;
			nb.id = newNbId;
			nb.name = name;
			cell.id = name;
			state.openNotebookTabIds = state.openNotebookTabIds.map((t) => (t === oldNbId ? newNbId : t));
			if (state.activeTabId === oldNbId) state.activeTabId = newNbId;
		}

		if (oldPath && newPath && oldPath !== newPath) {
			renameProjectFile(state.projectFolder, oldPath, newPath).catch(() => {
				// Revert on failure
				cell.outputName = oldName;
				cell.materializeTarget = oldName;
				if (nb.id !== oldNbId) {
					state.openNotebookTabIds = state.openNotebookTabIds.map((t) =>
						t === nb.id ? oldNbId : t
					);
					if (state.activeTabId === nb.id) state.activeTabId = oldNbId;
					nb.id = oldNbId;
					nb.name = oldName;
					cell.id = oldName;
				}
			});
		}
	} else {
		// Pure in-memory rename — no on-disk side effects, so this is safely checkpointed.
		// The filesystem branch above is intentionally NOT checkpointed: its async
		// rename-with-rollback isn't something notebook-level undo can safely reverse.
		pushHistoryCheckpoint(nb.id);
		cell.outputName = name;
		cell.materializeTarget = name;
	}
	// Old dependents referenced the old name — they're now broken
	if (oldName && oldName !== name)
		markDownstreamStale(oldName, 'upstream-changed', new Set(), cell.id);
	scheduleSave();
	return { ok: true };
}

export function setTheme(theme: 'light' | 'dark' | 'system'): void {
	state.theme = theme;
	scheduleSave();
}

// ── GUI stage actions ────────────────────────────────────────────────────────
export function updateGuiStages(id: string, stages: GUIPipelineStage[]): void {
	const context = findCellContext(id);
	if (!context) return;
	const { notebook: nb, cell } = context;
	checkpointCoalesced(nb.id, id, 'guiStages');
	cell.guiStages = stages;
	cell.code = guiToPreql(stages);
	cell.needsRun = true;
	cell.staleReason = 'code-changed';
	cell.staleSources = [];
	// Clear stale diagnostics and compile shortly after to keep stage-add interactions smooth.
	cell.errors = [];
	cell.compiledSQL = null;
	scheduleGuiCompile(id);
	scheduleSave();
	scheduleFileSave(nb.id, id);
}

export function setEditMode(id: string, mode: CellEditMode): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	pushHistoryCheckpoint(nb.id);
	cell.editMode = mode;
	scheduleSave();
	scheduleFileSave(nb.id, id);
}

export function setCellLanguage(id: string, language: CellLanguage): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	pushHistoryCheckpoint(nb.id);
	cell.language = language;
	if (language === 'sql') cell.editMode = 'prql';
	cell.errors = [];
	scheduleSave();
	scheduleFileSave(nb.id, id);
}

export function setCellDbtConfig(
	id: string,
	config: {
		materializeMode?: CellMaterializationMode;
		dbtSchema?: string | null;
		dbtTags?: string[];
	}
): void {
	const context = findCellContext(id);
	if (!context) return;
	const { notebook: nb, cell } = context;
	if (config.materializeMode !== undefined) {
		cell.materializeMode = config.materializeMode;
		cell.materializeTarget = cell.outputName;
	}
	if (config.dbtSchema !== undefined) cell.dbtSchema = config.dbtSchema;
	if (config.dbtTags !== undefined) cell.dbtTags = config.dbtTags;
	scheduleSave();
	scheduleFileSave(nb.id, id);
	// Sync dbt-native config fields to _models.yml in filesystem mode
	if (state.storageMode === 'filesystem' && state.projectFolder && state.isDbtProject) {
		const ext = cell.language === 'sql' ? '.sql' : '.prql';
		const relPath = `${nb.id}${ext}`;
		updateProjectSchema(state.projectFolder, relPath, {
			config: {
				materialized: config.materializeMode ?? cell.materializeMode,
				schema: config.dbtSchema ?? cell.dbtSchema ?? undefined,
				tags: config.dbtTags ?? cell.dbtTags
			}
		}).catch(() => {});
	}
}

export function setCellDescription(id: string, description: string | null): void {
	const context = findCellContext(id);
	if (!context) return;
	const { notebook: nb, cell } = context;
	cell.description = description;
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder && state.isDbtProject) {
		const ext = cell.language === 'sql' ? '.sql' : '.prql';
		const relPath = `${nb.id}${ext}`;
		updateProjectSchema(state.projectFolder, relPath, { description }).catch(() => {});
	}
}

export function setCellDisplay(id: string, display: CellDisplay): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	cell.display = display;
	scheduleSave();
}

// Collapse all / Expand all. Markdown cells keep their own display state.
export function setAllCellsDisplay(display: CellDisplay): void {
	const nb = getActiveNotebook();
	for (const cell of nb.cells) {
		if (cell.cellType === 'query') cell.display = display;
	}
	scheduleSave();
}

export function setNotebookReportView(enabled: boolean): void {
	const nb = getActiveNotebook();
	nb.reportView = enabled;
	scheduleSave();
}

export function setCellMaterializeMode(id: string, mode: CellMaterializationMode): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	pushHistoryCheckpoint(nb.id);
	cell.materializeMode = mode;
	scheduleSave();
}

export function setCellMaterializeTarget(id: string, target: string): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	cell.materializeTarget = target;
	scheduleSave();
}

export function setCellScheduleEnabled(id: string, enabled: boolean): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell || cell.cellType !== 'query') return;
	pushHistoryCheckpoint(nb.id);
	cell.scheduleEnabled = enabled;
	cell.scheduleStatus = 'idle';
	cell.scheduleLastError = null;
	cell.scheduleNextRunAt = enabled
		? computeNextRunAt(Date.now(), cell.scheduleIntervalMinutes)
		: null;
	ensureSchedulePoller();
	scheduleSave();
}

export function setCellScheduleIntervalMinutes(id: string, intervalMinutes: number): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell || cell.cellType !== 'query') return;
	cell.scheduleIntervalMinutes = clampScheduleIntervalMinutes(intervalMinutes);
	if (cell.scheduleEnabled) {
		cell.scheduleNextRunAt = computeNextRunAt(Date.now(), cell.scheduleIntervalMinutes);
	}
	scheduleSave();
}

export function setCellScheduleScope(id: string, scope: CellScheduleScope): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell || cell.cellType !== 'query') return;
	cell.scheduleScope = scope;
	scheduleSave();
}

export function setCellConnection(id: string, connectionId: string | null): void {
	const context = findCellContext(id);
	if (!context) return;
	const { notebook, cell, idx } = context;
	if (!cell || cell.cellType !== 'query') return;
	pushHistoryCheckpoint(notebook.id);
	cell.connectionId = normalizeConnectionId(connectionId, state.connections);
	const { errors, sql } = getCompiledCellSQL(notebook.cells, idx);
	cell.errors = errors;
	cell.compiledSQL = sql;
	cell.intelligence = null;
	scheduleSave();
}

export function setNotebookConnection(notebookId: string, connectionId: string | null): void {
	const notebook = state.notebooks.find((entry) => entry.id === notebookId);
	if (!notebook) return;
	const normalized = normalizeConnectionId(connectionId, state.connections);
	for (const cell of notebook.cells) {
		if (cell.cellType !== 'query') continue;
		cell.connectionId = normalized;
	}
	scheduleSave();
	if (state.autoRun) {
		markNotebookCellsStale(notebookId);
		void runAllStale();
	}
}

export function upsertConnection(connection: Connection): void {
	if (connection.type === 'duckdb-wasm') return;
	state.connections = [
		BUILTIN_DUCKDB_CONNECTION,
		...state.connections.filter(
			(entry) => entry.id !== connection.id && entry.type !== 'duckdb-wasm'
		),
		connection
	];
	state.externalSchemaTables = state.externalSchemaTables.map((table) =>
		table.connectionId === connection.id ? { ...table, connectionName: connection.name } : table
	);
	void syncConnectionMetadata(connection);
	scheduleSave();
}

export function removeConnection(id: string): void {
	if (id === BUILTIN_DUCKDB_CONNECTION_ID) return;
	state.connections = state.connections.filter((connection) => connection.id !== id);
	state.externalSchemaTables = state.externalSchemaTables.filter(
		(table) => table.connectionId !== id
	);
	for (const notebook of state.notebooks) {
		for (const cell of notebook.cells) {
			if (cell.connectionId === id) cell.connectionId = null;
		}
	}
	fetch('/api/connections/secret', {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ connectionId: id })
	}).catch(() => {});
	scheduleSave();
}

// Persists a connection's password server-side (encrypted), shared by everyone on this
// instance. Pass null to clear it. There is no corresponding "get" — secrets are
// write-only from the client once saved.
export async function setConnectionSecret(
	connectionId: string,
	secret: ConnectionSecret | null
): Promise<void> {
	if (!connectionId || connectionId === BUILTIN_DUCKDB_CONNECTION_ID) return;
	if (!secret || Object.keys(secret).length === 0) {
		await fetch('/api/connections/secret', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ connectionId })
		});
		return;
	}
	await fetch('/api/connections/secret', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ connectionId, secret })
	});
}

export function setExternalConnectionSchema(
	connectionId: string,
	connectionName: string,
	tables: Array<{ name: string; schema?: string; columns: string[]; columnTypes: string[] }>
): void {
	if (!connectionId || connectionId === BUILTIN_DUCKDB_CONNECTION_ID) return;
	const normalizedTables: ExternalSchemaTable[] = tables.map((table) => ({
		connectionId,
		connectionName,
		name: table.name,
		schema: table.schema,
		columns: table.columns,
		columnTypes: table.columnTypes
	}));
	state.externalSchemaTables = [
		...state.externalSchemaTables.filter((table) => table.connectionId !== connectionId),
		...normalizedTables
	];
	scheduleSave();
	if (state.autoRun) {
		markCellsForConnectionStale(connectionId);
		void runAllStale();
	}
}

export function clearExternalConnectionSchema(connectionId: string): void {
	if (!connectionId || connectionId === BUILTIN_DUCKDB_CONNECTION_ID) return;
	state.externalSchemaTables = state.externalSchemaTables.filter(
		(table) => table.connectionId !== connectionId
	);
	scheduleSave();
}

export function clearAllResults(): void {
	for (const nb of state.notebooks) {
		for (const cell of nb.cells) {
			cell.result = null;
			cell.executionMs = null;
		}
	}
	scheduleSave();
}

export function setNotebookDefaultCellLanguage(id: string, lang: CellLanguage): void {
	const nb = state.notebooks.find((n) => n.id === id);
	if (!nb) return;
	nb.defaultCellLanguage = lang;
	scheduleSave();
}

export function setStageResultCollapsed(id: string, stageIdx: number, collapsed: boolean): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	const arr = [...cell.stageResultsCollapsed];
	// Grow the array if needed
	while (arr.length <= stageIdx) arr.push(false);
	arr[stageIdx] = collapsed;
	cell.stageResultsCollapsed = arr;
	scheduleSave();
}

// ── Execution ────────────────────────────────────────────────────────────────

/**
 * Returns the full PRQL code to compile for a cell.
 * For DuckDB: CTE-expands same-notebook deps; cross-notebook deps use DuckDB views.
 * For external connections (Postgres, ClickHouse): CTE-expands ALL deps including
 * cross-notebook cells — PRQL `let` bindings compile to standard SQL CTEs which
 * work in every supported database engine.
 */
/**
 * Returns the final SQL (and any compile errors) for a cell.
 * SQL cells: SQL is returned directly from the pre-built execution code.
 * PRQL cells: the execution code is compiled via prqlc.
 */
function makeUdfError(reason: string): PRQLError {
	return {
		kind: 'udf',
		code: null,
		reason,
		hint: null,
		span: null,
		display: reason,
		location: null
	};
}

/**
 * Trino's Python UDFs only exist as an inline `WITH FUNCTION` fragment spliced
 * into a SQL WITH clause — they aren't relations, so a PRQL cell can't bind one
 * as a CTE, and DuckDB WASM has no Python UDF support at all. Both cases must be
 * caught before compilation, not surfaced as a confusing downstream SQL/compile error.
 */
function checkUdfCompatibility(
	cells: Cell[],
	idx: number,
	connection: Connection
): PRQLError | null {
	const cell = cells[idx];
	if (!cell) return null;
	const isBuiltin = isBuiltinDuckDBConnection(connection);
	const deps = isBuiltin
		? resolveDependencies(cells, idx)
		: resolveGlobalDependencies(
				cells,
				idx,
				new Map([...getGlobalOutputRegistry()].map(([n, { cell: c }]) => [n, c] as [string, Cell]))
			);
	const udfDep = deps.find((d) => d.cellType === 'udf');
	if (!udfDep) return null;
	if (cell.language === 'prql') {
		return makeUdfError(
			`UDF "${udfDep.outputName}" can only be called from a SQL-language cell — Python UDFs aren't relations, so PRQL can't bind them as CTEs.`
		);
	}
	if (isBuiltin) {
		return makeUdfError(
			`UDF "${udfDep.outputName}" requires a Trino-backed connection — Python UDFs are not supported on DuckDB.`
		);
	}
	return null;
}

function getCompiledCellSQL(
	cells: Cell[],
	idx: number
): { sql: string | null; errors: PRQLError[] } {
	const cell = cells[idx];
	if (!cell || cell.cellType !== 'query') return { sql: null, errors: [] };
	const connection = getCellConnection(cell);
	const udfError = checkUdfCompatibility(cells, idx, connection);
	if (udfError) return { sql: null, errors: [udfError] };
	const fullCode = getExecutionCode(cells, idx);
	if (cell.language === 'sql') return { sql: fullCode, errors: [] };
	return compilePRQLCached(fullCode, getPRQLTargetForConnection(connection));
}

function getExecutionCode(cells: Cell[], idx: number): string {
	const cell = cells[idx];
	if (!cell || cell.cellType !== 'query') return '';
	const connection = getCellConnection(cell);
	if (checkUdfCompatibility(cells, idx, connection)) return '';
	const target = getPRQLTargetForConnection(connection);

	// Substitute ${paramName} filter tokens before resolving dependencies, so
	// downstream deps that also reference the same filter get the same value.
	const owningNotebook = state.notebooks.find((nb) => nb.cells === cells);
	const effectiveCells = owningNotebook ? applyFilterSubstitution(cells, owningNotebook.id) : cells;

	const extractCells = (): Map<string, Cell> =>
		new Map([...getGlobalOutputRegistry()].map(([n, { cell: c }]) => [n, c] as [string, Cell]));

	if (cell.language === 'sql') {
		// For SQL cells, build a SQL WITH clause from deps and return raw SQL.
		const compile = (prql: string): string | null => compilePRQLCached(prql, target).sql;
		if (isBuiltinDuckDBConnection(connection)) {
			return buildSQLExecutionCode(effectiveCells, idx, compile);
		}
		return buildSQLGlobalExecutionCode(effectiveCells, idx, extractCells(), compile);
	}

	if (isBuiltinDuckDBConnection(connection)) {
		return buildExecutionCode(effectiveCells, idx);
	}
	// External connection: include cross-notebook deps as CTEs via global registry
	return buildGlobalExecutionCode(effectiveCells, idx, extractCells());
}

/**
 * Like getExecutionCode, but skips ${paramName} filter substitution so the result
 * still contains literal ${paramName} tokens. Used when publishing a share: the final
 * SQL (CTEs inlined) is captured once at publish time, and a public viewer's own filter
 * choices are substituted into it later, server-side, on each live run.
 */
export function getExecutionCodeForTemplate(cells: Cell[], idx: number): string {
	const cell = cells[idx];
	if (!cell || cell.cellType !== 'query') return '';
	const connection = getCellConnection(cell);
	if (checkUdfCompatibility(cells, idx, connection)) return '';
	const target = getPRQLTargetForConnection(connection);

	const extractCells = (): Map<string, Cell> =>
		new Map([...getGlobalOutputRegistry()].map(([n, { cell: c }]) => [n, c] as [string, Cell]));

	if (cell.language === 'sql') {
		const compile = (prql: string): string | null => compilePRQLCached(prql, target).sql;
		if (isBuiltinDuckDBConnection(connection)) {
			return buildSQLExecutionCode(cells, idx, compile);
		}
		return buildSQLGlobalExecutionCode(cells, idx, extractCells(), compile);
	}

	if (isBuiltinDuckDBConnection(connection)) {
		return buildExecutionCode(cells, idx);
	}
	return buildGlobalExecutionCode(cells, idx, extractCells());
}

async function _runCell(
	cell: Cell,
	fullCode: string,
	prevViewName: string | null,
	signal?: AbortSignal,
	runId?: string
): Promise<void> {
	const context = findCellContext(cell.id);
	if (!context) return;
	if (signal?.aborted) {
		cell.status = 'idle';
		return;
	}
	const notebookId = context.notebook.id;
	cell.status = 'running';
	cell.errors = [];
	cell.executionMs = null;
	const connection = getCellConnection(cell);
	const isBuiltin = isBuiltinDuckDBConnection(connection);

	if (isBuiltin && prevViewName) {
		try {
			await setPrevView(prevViewName);
		} catch {
			// continue anyway
		}
	}
	let sql: string | null;
	let errors: PRQLError[] = [];
	if (cell.language === 'sql') {
		// fullCode is already valid SQL built by getExecutionCode (possibly a WITH clause)
		sql = fullCode;
	} else {
		const compiled = compilePRQLCached(fullCode, getPRQLTargetForConnection(connection));
		sql = compiled.sql;
		errors = compiled.errors;
	}
	if (errors.length > 0 || !sql) {
		cell.errors = errors;
		cell.status = 'error';
		cell.needsRun = false;
		cell.staleReason = null;
		cell.staleSources = [];
		cell.lastRunAt = Date.now();
		cell.intelligence = buildNotebookIntelligence({
			connectionId: connectionIdForCell(cell),
			code: fullCode,
			rows: cell.result?.rows ?? [],
			columns: cell.result?.columns ?? [],
			executionMs: cell.executionMs,
			errors: errors.map((error) => error.display ?? error.reason),
			schemaTables: getSchemaTablesForConnection(cell)
		});
		recordNotebookEvent(notebookId, cell, 'run-error', fullCode);
		void Promise.resolve(
			recordCellExecutionMetadata({
				runId: makeId(),
				notebookId,
				cellId: cell.id,
				connectionId: connectionIdForCell(cell),
				status: 'error',
				runtimeMs: cell.executionMs,
				rowCount: cell.result?.rows.length ?? 0,
				columnCount: cell.result?.columns.length ?? 0,
				tablesTouched: extractTablesTouched(fullCode),
				resultColumns: cell.result?.columns ?? [],
				resultRows: cell.result?.rows ?? [],
				outputName: outputRelationNameForCell(cell),
				stages: cell.guiStages
			})
		).catch(() => {});
		return;
	}

	cell.compiledSQL = sql;
	const start = performance.now();
	try {
		const limited = wrapWithAutoLimit(sql);
		const rawResult = isBuiltin
			? await executeSQL(limited.sql)
			: await queryConnectionSQL(connection, limited.sql, signal, runId);
		if (signal?.aborted) {
			cell.status = 'idle';
			return;
		}
		const result = applyAutoLimit(normalizeQueryResult(rawResult), limited.wrapped);
		cell.executionMs = performance.now() - start;
		cell.result = result;
		cell.status = 'success';
		cell.needsRun = false;
		cell.staleReason = null;
		cell.staleSources = [];
		cell.lastRunAt = Date.now();
		if (isBuiltin) {
			const viewName = getCellOutputReference(cell);
			await createView(viewName, sql);
		}
		// View was refreshed — mark downstream cells stale so they rerun with new data
		if (cell.outputName)
			markDownstreamStale(cell.outputName, 'upstream-changed', new Set(), cell.id);
		cell.intelligence = buildNotebookIntelligence({
			connectionId: connectionIdForCell(cell),
			code: fullCode,
			rows: result.rows,
			columns: result.columns,
			executionMs: cell.executionMs,
			errors: [],
			schemaTables: getSchemaTablesForConnection(cell)
		});
		recordNotebookEvent(notebookId, cell, 'run-success', fullCode);
		void Promise.resolve(
			recordCellExecutionMetadata({
				runId: makeId(),
				notebookId,
				cellId: cell.id,
				connectionId: connectionIdForCell(cell),
				status: 'success',
				runtimeMs: cell.executionMs,
				rowCount: result.rows.length,
				columnCount: result.columns.length,
				tablesTouched: extractTablesTouched(fullCode),
				resultColumns: result.columns,
				resultRows: result.rows,
				outputName: outputRelationNameForCell(cell),
				stages: cell.guiStages
			})
		).catch(() => {});
	} catch (err: unknown) {
		if ((err as Error)?.name === 'AbortError') {
			cell.status = 'idle';
			return;
		}
		cell.executionMs = performance.now() - start;
		cell.status = 'error';
		cell.needsRun = false;
		cell.staleReason = null;
		cell.staleSources = [];
		cell.lastRunAt = Date.now();
		const errMessage = (err as Error).message ?? String(err);
		const errSpan =
			cell.language === 'sql' && sql ? parseSQLErrorSpan(errMessage, cell.code, sql) : null;
		cell.errors = [
			{
				kind: 'Error',
				code: null,
				reason: errMessage,
				hint: null,
				span: errSpan,
				display: errMessage,
				location: null
			}
		];
		cell.intelligence = buildNotebookIntelligence({
			connectionId: connectionIdForCell(cell),
			code: fullCode,
			rows: cell.result?.rows ?? [],
			columns: cell.result?.columns ?? [],
			executionMs: cell.executionMs,
			errors: cell.errors.map((error) => error.display ?? error.reason),
			schemaTables: getSchemaTablesForConnection(cell)
		});
		recordNotebookEvent(notebookId, cell, 'run-error', fullCode);
		void Promise.resolve(
			recordCellExecutionMetadata({
				runId: makeId(),
				notebookId,
				cellId: cell.id,
				connectionId: connectionIdForCell(cell),
				status: 'error',
				runtimeMs: cell.executionMs,
				rowCount: cell.result?.rows.length ?? 0,
				columnCount: cell.result?.columns.length ?? 0,
				tablesTouched: extractTablesTouched(fullCode),
				resultColumns: cell.result?.columns ?? [],
				resultRows: cell.result?.rows ?? [],
				outputName: outputRelationNameForCell(cell),
				stages: cell.guiStages
			})
		).catch(() => {});
	}
}

export function getCellConnection(cell: Cell): Connection {
	return resolveConnection(state.connections, cell.connectionId);
}

function getSegmentStartIndex(cells: Cell[], idx: number): number {
	const current = cells[idx];
	if (!current || current.cellType !== 'query') return idx;
	const currentConnectionId = getCellConnection(current).id;

	let segmentStart = 0;
	for (let i = idx - 1; i >= 0; i--) {
		const candidate = cells[i];
		if (candidate.cellType !== 'query') continue;
		if (getCellConnection(candidate).id !== currentConnectionId) {
			segmentStart = i + 1;
			break;
		}
		if (startsWithFrom(candidate.code)) {
			segmentStart = i;
			break;
		}
	}

	return segmentStart;
}

function findPreviousSuccessfulCell(cells: Cell[], idx: number): Cell | null {
	if (cells[idx]?.cellType !== 'query' || startsWithFrom(cells[idx]?.code ?? '')) return null;
	const segmentStart = getSegmentStartIndex(cells, idx);
	for (let i = idx - 1; i >= segmentStart; i--) {
		const prev = cells[i];
		if (prev.cellType !== 'query') continue;
		if (prev.status === 'success') {
			return prev;
		}
	}
	return null;
}

function prevViewNameForIndex(cells: Cell[], idx: number): string | null {
	const prev = findPreviousSuccessfulCell(cells, idx);
	return prev ? getCellOutputReference(prev) : null;
}

function startsWithFrom(code: string): boolean {
	return /^from\b/i.test(code.trim());
}

function getPrecedingCode(cells: Cell[], idx: number): string {
	if (cells[idx].cellType !== 'query') return '';
	if (startsWithFrom(cells[idx].code)) return '';
	const segmentStart = getSegmentStartIndex(cells, idx);

	return cells
		.slice(segmentStart, idx)
		.filter((c) => c.cellType === 'query')
		.map((c) => c.code.trim())
		.filter(Boolean)
		.join('\n');
}

/** Returns the CTE preamble that precedes a cell's own code during execution.
 *  Used by the editor to compute line-number offsets. */
export function getPrecedingCodeForCell(id: string): string {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return '';
	const cell = nb.cells[idx];
	const connection = getCellConnection(cell);
	const globalReg = new Map(
		[...getGlobalOutputRegistry()].map(([n, { cell: c }]) => [n, c] as [string, Cell])
	);
	const deps = isBuiltinDuckDBConnection(connection)
		? resolveDependencies(nb.cells, idx)
		: resolveGlobalDependencies(nb.cells, idx, globalReg);
	if (deps.length === 0) return '';
	return deps.map((dep) => `let ${dep.outputName} = (\n  ${dep.code.trim()}\n)`).join('\n\n');
}

async function _runCrossNotebookUpstreams(
	cell: Cell,
	ownNotebookId: string,
	visited: Set<string>
): Promise<void> {
	if (visited.has(cell.id)) return;
	visited.add(cell.id);

	const connection = getCellConnection(cell);
	// External connections use global CTE expansion — all deps are inlined in the
	// compiled query, so no pre-running of upstreams is needed.
	if (!isBuiltinDuckDBConnection(connection)) return;

	// DuckDB only: cross-notebook deps are satisfied by DuckDB views created when
	// the upstream cell runs. Pre-run stale upstreams so their views are current.
	const registry = getGlobalOutputRegistry();
	for (const [outputName, { cell: upstream, notebookId: upNbId }] of registry) {
		if (upNbId === ownNotebookId) continue; // same-notebook deps handled by CTE
		const re = new RegExp(`\\b${outputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
		if (!re.test(cell.code)) continue;
		// Only auto-run upstream if it has code; skip empty/newly-created cells
		if ((upstream.needsRun || upstream.lastRunAt === null) && upstream.code.trim() !== '') {
			await _runCrossNotebookUpstreams(upstream, upNbId, visited);
			await runCell(upstream.id);
		}
	}
}

/**
 * Runs stale cells that reference any of refreshedOutputNames, then recurses.
 * Handles BOTH cross-notebook cells AND same-notebook cells in different segments
 * (cells that start with `from` are always the start of a new pipeline segment and
 * cannot get fresh data via CTE chaining from the source cell — they need explicit runs).
 *
 * sourceNotebookId is the notebook containing the cell that just ran; for same-notebook
 * cells we only cascade to those that start new segments (i.e. start with `from`).
 * The visited set prevents any cell from running more than once per cascade.
 */
async function _runDownstreamCells(
	refreshedOutputNames: Set<string>,
	sourceNotebookId: string,
	visited: Set<string>
): Promise<void> {
	// Pre-compile regexps for all refreshed output names once before scanning cells.
	const reMap = new Map(
		[...refreshedOutputNames].map((name) => [
			name,
			new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
		])
	);

	const nextRound: { outputName: string; notebookId: string }[] = [];
	for (const nb of state.notebooks) {
		for (const cell of nb.cells) {
			// Only cascade to cells that have been run before; skip brand-new unrun cells
			if (cell.cellType !== 'query' || !cell.needsRun || !cell.lastRunAt || visited.has(cell.id))
				continue;
			// Same-notebook cells that continue a pipeline (don't start with `from`) already
			// get fresh data when run via CTE chaining — skip them here
			if (nb.id === sourceNotebookId && !startsWithFrom(cell.code)) continue;
			const refs = [...refreshedOutputNames].some((name) => reMap.get(name)!.test(cell.code));
			if (!refs) continue;
			visited.add(cell.id);
			await runCell(cell.id);
			const finalStatus = cell.status;
			if (finalStatus === 'success' && cell.outputName) {
				nextRound.push({ outputName: cell.outputName, notebookId: nb.id });
			}
		}
	}
	for (const { outputName, notebookId } of nextRound) {
		await _runDownstreamCells(new Set([outputName]), notebookId, visited);
	}
}

export async function runCell(id: string): Promise<void> {
	// Search all notebooks so auto-refresh timers can run cells in a background (non-active) notebook.
	let nb = getActiveNotebook();
	let idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) {
		for (const n of state.notebooks) {
			const i = n.cells.findIndex((c) => c.id === id);
			if (i !== -1) {
				nb = n;
				idx = i;
				break;
			}
		}
	}
	if (idx === -1) return;
	const cell = nb.cells[idx];
	if (cell.cellType !== 'query') return;
	const udfError = checkUdfCompatibility(nb.cells, idx, getCellConnection(cell));
	if (udfError) {
		cell.errors = [udfError];
		cell.status = 'error';
		return;
	}
	// One controller per cell — any previous run for this cell is superseded.
	cellRunControllers.get(id)?.abort();
	const controller = new AbortController();
	const runId = makeId();
	cellRunControllers.set(id, controller);
	cellRunIds.set(id, runId);
	try {
		// Mark running immediately so the UI responds before cross-notebook upstream pre-runs complete
		cell.status = 'running';
		// Auto-run stale upstream cells in other notebooks before executing this cell
		await _runCrossNotebookUpstreams(cell, nb.id, new Set<string>());
		const fullCode = getExecutionCode(nb.cells, idx);
		const prevName = prevViewNameForIndex(nb.cells, idx);
		await _runCell(cell, fullCode, prevName, controller.signal, runId);
		// After success, cascade to stale downstream cells in other notebooks.
		// Read status via index to prevent TypeScript narrowing from the earlier 'running' assignment.
		if ((nb.cells[idx] as Cell).status === 'success' && cell.outputName) {
			await _runDownstreamCells(new Set([cell.outputName]), nb.id, new Set([cell.id]));
		}
	} finally {
		if (cellRunControllers.get(id) === controller) cellRunControllers.delete(id);
		if (cellRunIds.get(id) === runId) cellRunIds.delete(id);
	}
}

export function cancelCell(id: string): void {
	const controller = cellRunControllers.get(id);
	const runId = cellRunIds.get(id);
	if (!controller && !runId) return;

	// Abort the browser-side fetch (makes _runCell catch AbortError immediately).
	controller?.abort();

	// Fire the server-side cancel so the DB-side query is killed regardless of
	// whether request.signal propagated through the dev proxy.
	if (runId) void cancelConnectionQuery(runId);

	// Immediate UI update — _runCell will also set idle when it catches AbortError.
	for (const nb of state.notebooks) {
		const cell = nb.cells.find((c) => c.id === id);
		if (cell) {
			cell.status = 'idle';
			break;
		}
	}
}

function collectRunnableSegmentCells(cells: Cell[], startIdx: number): Cell[] {
	const start = cells[startIdx];
	if (!start || start.cellType !== 'query') return [];
	const startConnectionId = getCellConnection(start).id;
	const toRun: Cell[] = [];
	for (let i = startIdx; i < cells.length; i++) {
		const candidate = cells[i];
		if (candidate.cellType !== 'query') continue;
		if (getCellConnection(candidate).id !== startConnectionId) break;
		if (i > startIdx && startsWithFrom(candidate.code)) break;
		toRun.push(candidate);
	}
	return toRun;
}

export function getRunImpact(id: string): { segmentCount: number; downstreamCount: number } {
	const nb = getActiveNotebook();
	const startIdx = nb.cells.findIndex((c) => c.id === id);
	if (startIdx === -1) return { segmentCount: 0, downstreamCount: 0 };
	const segment = collectRunnableSegmentCells(nb.cells, startIdx);
	if (segment.length === 0) return { segmentCount: 0, downstreamCount: 0 };
	return {
		segmentCount: segment.length,
		downstreamCount: Math.max(0, segment.length - 1)
	};
}

export async function runCellAndDownstream(id: string): Promise<void> {
	const nb = getActiveNotebook();
	const startIdx = nb.cells.findIndex((c) => c.id === id);
	if (startIdx === -1) return;
	const toRun = collectRunnableSegmentCells(nb.cells, startIdx);

	for (const cell of toRun) {
		await runCell(cell.id);
	}
	// runCell already cascades cross-notebook downstream for each cell it runs
}

export async function runGuiStagePreview(
	cellId: string,
	upToStageIdx: number
): Promise<{ rows: Record<string, unknown>[]; columns: string[] } | { error: string }> {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === cellId);
	if (idx === -1) return { error: 'Cell not found' };
	const cell = nb.cells[idx];
	if (cell.cellType !== 'query') return { error: 'Only query cells are executable' };
	const connection = getCellConnection(cell);
	const isBuiltin = isBuiltinDuckDBConnection(connection);
	const partialStages = cell.guiStages.slice(0, upToStageIdx + 1);
	const partialPreql = guiToPreql(partialStages);
	const prevName = prevViewNameForIndex(nb.cells, idx);

	if (isBuiltin && prevName) {
		try {
			await setPrevView(prevName);
		} catch {
			// continue anyway
		}
	}

	// Build CTE chain for stage preview using the partial code as the final query
	const deps = resolveDependencies(nb.cells, idx);
	const cteParts = deps.map((dep) => `let ${dep.outputName} = (\n  ${dep.code.trim()}\n)`);
	const fullCode = [...cteParts, partialPreql.trim()].join('\n\n');
	const { sql, errors } = compilePRQLCached(fullCode, getPRQLTargetForConnection(connection));
	if (errors.length > 0 || !sql) {
		return { error: errors[0]?.display ?? errors[0]?.reason ?? 'Compile error' };
	}

	try {
		const limited = wrapWithAutoLimit(sql);
		const result = isBuiltin
			? await executeSQL(limited.sql)
			: await queryConnectionSQL(connection, limited.sql);
		return applyAutoLimit(normalizeQueryResult(result), limited.wrapped);
	} catch (err: unknown) {
		return { error: (err as Error).message ?? String(err) };
	}
}

export async function runAll(): Promise<void> {
	const nb = getActiveNotebook();
	for (let i = 0; i < nb.cells.length; i++) {
		const cell = nb.cells[i];
		if (cell.cellType !== 'query') continue;
		const udfError = checkUdfCompatibility(nb.cells, i, getCellConnection(cell));
		if (udfError) {
			cell.errors = [udfError];
			cell.status = 'error';
			continue;
		}
		const fullCode = getExecutionCode(nb.cells, i);
		const prevName = prevViewNameForIndex(nb.cells, i);
		await _runCell(cell, fullCode, prevName);
	}
}

export function getNotebookStaleCellCount(): number {
	let count = 0;
	for (const nb of state.notebooks) {
		for (const cell of nb.cells) {
			if (cell.cellType === 'query' && cell.needsRun) count++;
		}
	}
	return count;
}

export async function runAllStale(): Promise<void> {
	const staleCells: Cell[] = [];
	for (const nb of state.notebooks) {
		for (const cell of nb.cells) {
			if (cell.cellType === 'query' && cell.needsRun) staleCells.push(cell);
		}
	}
	for (const cell of staleCells) {
		if (cell.needsRun) await runCell(cell.id);
	}
}

export async function refreshTablesFromCatalog(cascadeAutoRun = false): Promise<void> {
	const relations = await listMainSchemaRelations();
	state.tables = relations.map((r) => ({
		name: r.name,
		fileName: `${r.name}.${r.relationType}`,
		rowCount: r.rowCount,
		columns: r.columns,
		columnTypes: r.columnTypes,
		relationType: r.relationType
	}));
	scheduleSave();
	if (cascadeAutoRun && state.autoRun) {
		markCellsForConnectionStale(BUILTIN_DUCKDB_CONNECTION_ID);
		void runAllStale();
	}
}

export async function materializeCell(id: string): Promise<void> {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;

	const cell = nb.cells[idx];
	const connection = getCellConnection(cell);
	const isBuiltin = isBuiltinDuckDBConnection(connection);
	cell.materializeStatus = 'running';
	cell.materializeError = null;
	cell.materializedRelationType = null;

	const targetName = normalizeRelationName(
		cell.outputName || `_cell_${cell.id}`,
		`model_${idx + 1}`
	);
	cell.materializeTarget = targetName;

	const { sql, errors } = getCompiledCellSQL(nb.cells, idx);
	if (errors.length > 0 || !sql) {
		cell.errors = errors;
		cell.materializeStatus = 'error';
		cell.materializeError = errors[0]?.display ?? errors[0]?.reason ?? 'Compile error';
		return;
	}

	cell.compiledSQL = sql;

	if (cell.materializeMode === 'ephemeral') {
		// ephemeral models are only inlined as CTEs in dbt; nothing to materialize locally
		cell.materializeStatus = 'idle';
		return;
	}

	try {
		const targetSchema = inferMaterializeTargetSchema(cell, connection);
		const dbMode = cell.materializeMode as DBMaterializationMode;
		const relation = isBuiltin
			? await materializeRelation(targetName, sql, dbMode)
			: await materializeConnectionRelation(connection, targetName, sql, dbMode, targetSchema);
		cell.materializeStatus = 'success';
		cell.materializeError = null;
		cell.materializedRelationType = relation.type;
		if (isBuiltin) {
			await refreshTablesFromCatalog(true);
		}
	} catch (err: unknown) {
		cell.materializeStatus = 'error';
		cell.materializeError = (err as Error).message ?? String(err);
	}
}

export async function materializeCellAndDownstream(id: string): Promise<void> {
	const nb = getActiveNotebook();
	const startIdx = nb.cells.findIndex((c) => c.id === id);
	if (startIdx === -1) return;
	const toMaterialize = collectRunnableSegmentCells(nb.cells, startIdx);
	for (const cell of toMaterialize) {
		await materializeCell(cell.id);
	}
}

export async function processScheduledMaterializations(now = Date.now()): Promise<void> {
	if (scheduleRunInFlight) return;
	scheduleRunInFlight = true;
	try {
		for (const notebook of state.notebooks) {
			for (const cell of notebook.cells) {
				if (cell.cellType !== 'query') continue;
				if (!cell.scheduleEnabled) continue;
				if (cell.scheduleNextRunAt == null || cell.scheduleNextRunAt > now) continue;
				if (cell.materializeStatus === 'running' || cell.scheduleStatus === 'running') continue;

				cell.scheduleStatus = 'running';
				cell.scheduleLastError = null;

				try {
					if (cell.scheduleScope === 'segment') {
						await materializeCellAndDownstream(cell.id);
					} else {
						await materializeCell(cell.id);
					}
					if (cell.materializeStatus === 'error') {
						cell.scheduleStatus = 'error';
						cell.scheduleLastError = cell.materializeError ?? 'Materialize failed';
					} else {
						cell.scheduleStatus = 'success';
						cell.scheduleLastError = null;
					}
				} catch (err: unknown) {
					cell.scheduleStatus = 'error';
					cell.scheduleLastError = (err as Error).message ?? String(err);
				} finally {
					cell.scheduleLastRunAt = now;
					cell.scheduleNextRunAt = computeNextRunAt(now, cell.scheduleIntervalMinutes);
				}
			}
		}
		scheduleSave();
	} finally {
		scheduleRunInFlight = false;
	}
}

export function __resetStateForTests(): void {
	for (const timer of guiCompileTimers.values()) clearTimeout(timer);
	guiCompileTimers.clear();
	if (schedulePollTimer) {
		clearInterval(schedulePollTimer);
		schedulePollTimer = null;
	}
	scheduleRunInFlight = false;
	compileCache.clear();
	historyStacks.clear();
	for (const timer of coalesceTimers.values()) clearTimeout(timer);
	coalesceTimers.clear();
	cellClipboard = null;
	const initial = makeNotebook('Notebook 1');
	state = {
		notebooks: [initial],
		folders: [],
		connections: [BUILTIN_DUCKDB_CONNECTION],
		externalSchemaTables: [],
		openNotebookTabIds: [initial.id],
		expandedNotebookFolderIds: [],
		expandedNotebookIds: [],
		sidebarSectionsExpanded: {
			notebooks: true,
			tables: true
		},
		activeTabId: initial.id,
		focusedCellId: null,
		openResultTabs: [],
		openExtraTabs: [],
		tables: [],
		theme: 'system',
		autoRun: false,
		llmConfig: {
			provider: 'ollama',
			baseUrl: 'http://127.0.0.1:11434',
			model: 'qwen3:4b'
		},
		notebookEvents: [],
		workspaceSyncStatus: 'idle',
		storageMode: 'local',
		projectFolder: null,
		isDbtProject: false,
		dbtModels: [],
		dbtLastCompileAt: null,
		dbtRunningJobId: null,
		dbtSchedules: [],
		isEvidenceProject: false,
		evidenceRunningJobId: null,
		evidenceDevPort: null,
		evidencePages: []
	};
}

// ── Table actions ─────────────────────────────────────────────────────────────
export function addTable(table: UploadedTable): void {
	state.tables = [
		...state.tables.filter((t) => t.name !== table.name),
		{ ...table, relationType: table.relationType ?? 'table' }
	];
	void Promise.resolve(
		recordUploadedTableMetadata({
			connectionId: BUILTIN_DUCKDB_CONNECTION_ID,
			table
		})
	).catch(() => {});
	scheduleSave();
	if (state.autoRun) {
		markCellsReferencingTableStale(table.name);
		void runAllStale();
	}
}

export function removeTable(name: string): void {
	dropRelation(name).catch(() => {});
	state.tables = state.tables.filter((t) => t.name !== name);
	scheduleSave();
}

// ── Export / Import ──────────────────────────────────────────────────────────
export function exportJSON(): string {
	return serialize();
}

export function importJSON(json: string): void {
	deserialize(json);
}
