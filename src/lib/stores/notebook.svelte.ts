import { compilePRQL, type PRQLError } from '$lib/services/prql';
import { buildExecutionCode, buildGlobalExecutionCode, buildSQLExecutionCode, buildSQLGlobalExecutionCode, resolveDependencies, resolveGlobalDependencies } from '$lib/services/cell-deps';
import { serializeCell as serializeCellToFile } from '$lib/services/prql-file';
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
	backfillSchemaFromManifest
} from '$lib/services/project-client';
import type { DbtModel } from '$lib/server/dbt';
import type { DbtSchedule } from '$lib/types/schedule';
import { cancelConnectionQuery, materializeConnectionRelation, queryConnectionSQL } from '$lib/services/connections';
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
	type Connection,
	type ConnectionSecret,
	type ConnectionSecrets,
	type MySQLDataSource,
	type PRQLTarget
} from '$lib/types/connection';
import type { GUIPipelineStage } from '$lib/types/gui-pipeline';
import type { ChartConfig } from '$lib/types/gui-pipeline';
import type { ResultViewMode } from '$lib/types/gui-pipeline';
import type { Dashboard, DashboardBlock, DashboardPanel, ChartBlock, TextBlock, CalloutBlock, FilterBlock, DashboardPanelWidth, DashboardPanelHeight } from '$lib/types/gui-pipeline';

export type CellStatus = 'idle' | 'running' | 'success' | 'error';
export type CellEditMode = 'gui' | 'prql';
export type CellType = 'query' | 'markdown';
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

export interface Cell {
	id: string;
	cellType: CellType;
	connectionId: string | null;
	outputName: string;
	code: string;
	markdown: string;
	markdownPreview: boolean;
	language: CellLanguage;
	status: CellStatus;
	result: { rows: Record<string, unknown>[]; columns: string[] } | null;
	errors: PRQLError[];
	compiledSQL: string | null;
	executionMs: number | null;
	guiStages: GUIPipelineStage[];
	editMode: CellEditMode;
	resultViewMode: ResultViewMode;
	resultChartConfig: ChartConfig | null;
	collapsed: boolean;
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
}

export interface NotebookFolder {
	id: string;
	name: string;
	parentId: string | null;
}

export type SidebarSection = 'notebooks' | 'tables' | 'dashboards';

export interface SidebarSectionsExpanded {
	notebooks: boolean;
	tables: boolean;
	dashboards: boolean;
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
	type: 'table-view' | 'profile' | 'lineage' | 'dashboard' | 'evidence-preview';
	tableName: string;
	name: string;
	viewMode: ResultViewMode;
	chartConfig: ChartConfig | null;
	// For lineage tabs: which model to center on (optional)
	focusedModelName?: string;
	// For dashboard tabs
	dashboardId?: string;
	// For evidence-preview tabs
	pagePath?: string;
}

export interface LLMConfig {
	provider: 'openapi-compatible' | 'ollama';
	baseUrl: string;
	model: string;
}

interface NotebookState {
	notebooks: Notebook[];
	folders: NotebookFolder[];
	connections: Connection[];
	externalSchemaTables: ExternalSchemaTable[];
	openNotebookTabIds: string[];
	expandedNotebookFolderIds: string[];
	sidebarSectionsExpanded: SidebarSectionsExpanded;
	activeTabId: string;
	openResultTabs: ResultTabInfo[];
	openExtraTabs: ExtraTab[];
	tables: UploadedTable[];
	theme: 'light' | 'dark' | 'system';
	autoRun: boolean;
	llmConfig: LLMConfig;
	notebookEvents: NotebookEvent[];
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
	// ── Dashboards ──
	dashboards: Dashboard[];
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
const SECRET_STORAGE_KEY = 'lunapad_connection_secrets';
const REMEMBERED_SECRETS_KEY = 'lunapad_connection_secrets_persistent';
const PROJECT_FOLDER_KEY = 'lunapad_project_folder';
let schedulePollTimer: ReturnType<typeof setInterval> | null = null;
let scheduleRunInFlight = false;

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
function parseSQLErrorSpan(message: string, cellCode: string, fullSQL: string): [number, number] | null {
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

function compilePRQLCached(fullCode: string, target: PRQLTarget): { sql: string | null; errors: PRQLError[] } {
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
		language,
		status: 'idle',
		result: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: [{ type: 'from', table: '' }],
		editMode: 'gui',
		resultViewMode: 'table',
		resultChartConfig: null,
		collapsed: false,
		stageResultsCollapsed: [],
		materializeMode: 'table',
		materializeTarget: outputName,
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description: null,
		dbtSchema: null,
		dbtTags: [],
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

function makeNotebook(name: string, cells?: Cell[]): Notebook {
	return {
		id: makeId(),
		name,
		folderId: null,
		cells: cells ?? [makeCell('', 'result1')],
		defaultCellLanguage: 'prql'
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

	const categoryPRQL = `from orders
derive revenue = quantity * unit_price
group category (
  aggregate {
    total_revenue = sum revenue,
    order_count = count this
  }
)
sort {-total_revenue}`;

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

	const cells: Cell[] = [
		makeMarkdownCell(
			`# Sales Analytics Demo\nThis notebook shows the core features of Lunapad. Run cells from top to bottom — start with the **orders** cell, then explore the analysis cells below.`
		),
		{
			...makeCell(seedSQL, 'orders', 'sql'),
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
			...makeCell(
				`from orders\nderive {\n  revenue = quantity * unit_price\n}\ngroup region (\n  aggregate {\n    total_revenue = sum revenue\n  }\n)\nsort {-total_revenue}`,
				'regional_breakdown',
				'prql'
			),
			editMode: 'gui',
			guiStages: [
				{ type: 'from', table: 'orders' },
				{
					type: 'derive',
					columns: [{
						name: 'revenue',
						expr: {
							mode: 'binary',
							left: { kind: 'column', value: 'quantity' },
							op: '*',
							right: { kind: 'column', value: 'unit_price' }
						}
					}]
				},
				{
					type: 'group',
					by: ['region'],
					aggregations: [{ name: 'total_revenue', func: 'sum', column: 'revenue' }]
				},
				{ type: 'sort', keys: [{ column: 'total_revenue', dir: 'desc' }] }
			] as GUIPipelineStage[],
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'pie',
				xColumn: 'region',
				yColumns: ['total_revenue'],
				colorColumn: null,
				title: 'Revenue by Region'
			} satisfies ChartConfig
		},
		{
			...makeCell(topProductsPRQL, 'top_products', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar',
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
		makeMarkdownCell(
			`## What you just ran\n- **PRQL cells** that reference each other as CTEs — no boilerplate \`WITH\` needed\n- **GUI pipeline editor** (cell 5) — click the pencil icon to toggle between code and visual builder\n- **Chart & table views** — use the icons in each cell's result toolbar to switch\n- **Cross-language dependencies** — cell 7 (SQL) references \`monthly_revenue\` from a PRQL cell`
		)
	];

	return {
		id: makeId(),
		name: 'Sales Analytics Demo',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql'
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
	sidebarSectionsExpanded: {
		notebooks: true,
		tables: true,
		dashboards: true
	},
	activeTabId: _initialNotebook.id,
	openResultTabs: [],
	openExtraTabs: [],
	tables: [],
	theme: 'system',
	autoRun: false,
	llmConfig: {
		provider: 'openapi-compatible',
		baseUrl: 'http://127.0.0.1:11434/v1',
		model: 'qwen3:4b'
	},
	notebookEvents: [],
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
	evidencePages: [],
	dashboards: []
});
let connectionSecrets = $state<ConnectionSecrets>({});

// ── Persistence ─────────────────────────────────────────────────────────────
type SerializedCell = Omit<Cell, 'status' | 'result' | 'errors' | 'needsRun' | 'staleReason' | 'staleSources'> & {
	status: 'idle';
	result: null;
	errors: [];
	needsRun: false;
	staleReason: null;
	staleSources: [];
};

function serializeCell(c: Cell): SerializedCell {
	return { ...c, status: 'idle', result: null, errors: [], needsRun: false, staleReason: null, staleSources: [] };
}

function serialize(): string {
	return JSON.stringify({
		notebooks: state.notebooks.map((n) => ({
			...n,
			cells: n.cells.map(serializeCell)
		})),
		folders: state.folders,
		connections: state.connections,
		externalSchemaTables: state.externalSchemaTables,
		openNotebookTabIds: state.openNotebookTabIds,
		expandedNotebookFolderIds: state.expandedNotebookFolderIds,
		sidebarSectionsExpanded: state.sidebarSectionsExpanded,
		activeTabId: state.activeTabId,
		openResultTabs: state.openResultTabs,
		tables: state.tables,
		theme: state.theme,
		autoRun: state.autoRun,
		llmConfig: state.llmConfig,
		notebookEvents: state.notebookEvents,
		dashboards: state.dashboards
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
				catalogName: typeof rawCatalogName === 'string' && rawCatalogName ? rawCatalogName : slugifyCatalogName(candidate.name),
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
				catalogName: typeof rawCatalogName === 'string' && rawCatalogName ? rawCatalogName : slugifyCatalogName(candidate.name),
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
				catalogName: typeof rawCatalogName === 'string' && rawCatalogName ? rawCatalogName : slugifyCatalogName(candidate.name),
				host: candidate.host,
				port: candidate.port,
				database: candidate.database,
				username: candidate.username,
				ssl: Boolean((candidate as Partial<MySQLDataSource>).ssl)
			} satisfies MySQLDataSource);
		}
	}

	return connections;
}

function normalizeConnectionId(connectionId: string | null | undefined, connections: Connection[]): string | null {
	if (!connectionId || connectionId === BUILTIN_DUCKDB_CONNECTION_ID) return null;
	return connections.some((connection) => connection.id === connectionId) ? connectionId : null;
}

function loadSecretsFromSessionStorage(): void {
	if (typeof sessionStorage === 'undefined') return;
	const raw = sessionStorage.getItem(SECRET_STORAGE_KEY);
	if (!raw) return;
	try {
		const parsed = JSON.parse(raw) as ConnectionSecrets;
		connectionSecrets = typeof parsed === 'object' && parsed ? parsed : {};
	} catch {
		connectionSecrets = {};
	}
}

function saveSecretsToSessionStorage(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(SECRET_STORAGE_KEY, JSON.stringify(connectionSecrets));
}

function getRememberedSecrets(): ConnectionSecrets {
	if (typeof localStorage === 'undefined') return {};
	const raw = localStorage.getItem(REMEMBERED_SECRETS_KEY);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as ConnectionSecrets;
		return typeof parsed === 'object' && parsed ? parsed : {};
	} catch {
		return {};
	}
}

function setRememberedSecret(connectionId: string, secret: ConnectionSecret | null): void {
	if (typeof localStorage === 'undefined') return;
	const remembered = getRememberedSecrets();
	if (secret) {
		remembered[connectionId] = secret;
	} else {
		delete remembered[connectionId];
	}
	localStorage.setItem(REMEMBERED_SECRETS_KEY, JSON.stringify(remembered));
}

function loadRememberedSecretsFromLocalStorage(): void {
	const remembered = getRememberedSecrets();
	// Merge into connectionSecrets; session values (loaded after) take precedence
	for (const [id, secret] of Object.entries(remembered)) {
		if (!connectionSecrets[id]) {
			connectionSecrets[id] = secret;
		}
	}
}

export function isSecretRemembered(connectionId: string): boolean {
	return connectionId in getRememberedSecrets();
}

function deserializeCell(c: Cell, i: number): Cell {
	const guiStages: GUIPipelineStage[] = Array.isArray(c.guiStages) && c.guiStages.length > 0
		? c.guiStages
		: [{ type: 'from', table: '' } as GUIPipelineStage];
	const language: CellLanguage = (c as Partial<Cell>).language === 'sql' ? 'sql' : 'prql';
	const editMode: CellEditMode = c.editMode === 'prql' ? 'prql' : 'gui';
	const persistedViewMode = (c as Partial<Cell>).resultViewMode;
	const cellType: CellType = (c as Partial<Cell>).cellType === 'markdown' ? 'markdown' : 'query';
	const markdown = typeof (c as Partial<Cell>).markdown === 'string' ? (c as Partial<Cell>).markdown as string : '';
	const markdownPreview = Boolean((c as Partial<Cell>).markdownPreview);
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
		language,
		guiStages,
		editMode,
		resultViewMode,
		resultChartConfig: (c as Partial<Cell>).resultChartConfig ?? null,
		collapsed: (c as Partial<Cell>).collapsed ?? false,
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

	if (connection.type === 'mysql') {
		if (availableSchemas.includes(connection.database)) return connection.database;
		return availableSchemas[0] ?? connection.database;
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
		if (arr.length === 4 && arr.every((entry) => typeof entry === 'number' && Number.isInteger(entry))) {
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
		const normalizedEntries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
			key,
			normalizeResultValue(entry)
		]);
		return Object.fromEntries(normalizedEntries);
	}
	return value;
}

function normalizeQueryResult(result: {
	rows: Record<string, unknown>[];
	columns: string[];
}): {
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
					.filter((entry) =>
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
				defaultCellLanguage: (n as Partial<Notebook>).defaultCellLanguage === 'sql' ? 'sql' : 'prql',
				cells:
					Array.isArray(n.cells) && n.cells.length > 0
						? (n.cells as Cell[]).map((cell, idx) => ({
							...deserializeCell(cell, idx),
							connectionId: normalizeConnectionId((cell as Partial<Cell>).connectionId, connections)
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

		if (data.sidebarSectionsExpanded && typeof data.sidebarSectionsExpanded === 'object') {
			const sections = data.sidebarSectionsExpanded as Partial<SidebarSectionsExpanded>;
			state.sidebarSectionsExpanded = {
				notebooks: sections.notebooks ?? true,
				tables: sections.tables ?? true,
				dashboards: sections.dashboards ?? true
			};
		}

		if (Array.isArray(data.openResultTabs)) {
			state.openResultTabs = (data.openResultTabs as ResultTabInfo[]).filter(
				(t) => notebookIds.has(t.notebookId)
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
				: state.openNotebookTabIds[0] ?? state.notebooks[0].id;

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
						: 'qwen3:4b'
			};
		}
		state.notebookEvents = Array.isArray(data.notebookEvents)
			? (data.notebookEvents as NotebookEvent[])
				.filter((event) =>
					typeof event.id === 'string' &&
					typeof event.cellId === 'string' &&
					typeof event.connectionId === 'string' &&
					typeof event.eventType === 'string'
				)
			: [];
		// Migrate old format: Dashboard.panels[] → Dashboard.blocks[]
		state.dashboards = Array.isArray(data.dashboards)
			? (data.dashboards as (Dashboard & { panels?: ChartBlock[] })[]).map((d) => {
				if (!d.blocks && d.panels) {
					return { ...d, blocks: d.panels.map((p) => ({ ...p, type: 'chart' as const })), panels: undefined };
				}
				return d as Dashboard;
			})
			: [];
	} catch {
		// ignore corrupt state
	}
}

export function loadFromStorage(): void {
	if (typeof localStorage === 'undefined') return;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw) deserialize(raw);
	// Migrate any notebooks that were saved without a folderId (local mode only).
	if (state.storageMode === 'local') {
		const unfoldered = state.notebooks.filter((nb) => !nb.folderId);
		if (unfoldered.length > 0) {
			const folderId = ensureDefaultFolder();
			for (const nb of unfoldered) nb.folderId = folderId;
			scheduleSave();
		}
	}
	loadRememberedSecretsFromLocalStorage();
	loadSecretsFromSessionStorage();
	ensureSchedulePoller();
	// Restore project folder from last session
	const savedFolder = localStorage.getItem(PROJECT_FOLDER_KEY);
	if (savedFolder) {
		void openProject(savedFolder).catch(() => {
			// Folder may have moved — clear it silently
			localStorage.removeItem(PROJECT_FOLDER_KEY);
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
		localStorage.setItem(STORAGE_KEY, serialize());
	}, 500);
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
let dirtyNotebookIds = $state(new Set<string>());

/** Cancel all pending debounced file saves. Call before switching storage modes. */
function cancelPendingFileSaves(): void {
	for (const timer of fileSaveTimers.values()) clearTimeout(timer);
	fileSaveTimers.clear();
	dirtyNotebookIds = new Set();
}

/** Returns true if the notebook has pending unsaved file changes. */
export function isNotebookDirty(id: string): boolean {
	return dirtyNotebookIds.has(id);
}

/** Debounced save of a single cell's .prql file to the project folder. */
export function scheduleFileSave(notebookId: string, cellId: string): void {
	if (state.storageMode !== 'filesystem' || !state.projectFolder) return;
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

			const mergedCells = freshNb.cells.map((freshCell) => {
				const prev = prevNb.cells.find((c) => c.id === freshCell.id);
				if (!prev) return freshCell;
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
					intelligence: prev.intelligence,
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
	} catch {
		// ignore — keep current state
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
export function getProjectFolder(): string | null { return state.projectFolder; }
export function getIsDbtProject(): boolean { return state.isDbtProject; }
export function getDbtModels(): DbtModel[] { return state.dbtModels; }
export function getDbtRunningJobId(): string | null { return state.dbtRunningJobId; }
export function getDbtLastCompileAt(): number | null { return state.dbtLastCompileAt; }
export function getStorageMode(): 'local' | 'filesystem' { return state.storageMode; }
export function setDbtRunningJobId(jobId: string | null): void { state.dbtRunningJobId = jobId; }
export function getDbtSchedules(): DbtSchedule[] { return state.dbtSchedules; }

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
		state.dbtSchedules = state.dbtSchedules.map((s) => (s.id === body.schedule!.id ? body.schedule! : s));
	} else {
		state.dbtSchedules = [...state.dbtSchedules, body.schedule!];
	}
}

export async function deleteDbtSchedule(id: string): Promise<void> {
	if (!state.projectFolder) return;
	await fetch(`/api/schedules?folder=${encodeURIComponent(state.projectFolder)}&id=${encodeURIComponent(id)}`, {
		method: 'DELETE'
	});
	state.dbtSchedules = state.dbtSchedules.filter((s) => s.id !== id);
}

// ── Evidence.dev project functions ────────────────────────────────────────────
export function getIsEvidenceProject(): boolean { return state.isEvidenceProject; }
export function getEvidenceDevPort(): number | null { return state.evidenceDevPort; }
export function getEvidencePages(): string[] { return state.evidencePages; }
export function getEvidenceRunningJobId(): string | null { return state.evidenceRunningJobId; }

export async function refreshEvidencePages(): Promise<void> {
	if (!state.projectFolder) return;
	try {
		const res = await fetch(`/api/evidence/pages?folder=${encodeURIComponent(state.projectFolder)}`);
		const body = await res.json() as { pages?: string[] };
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
		const body = await res.json() as { jobId?: string };
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
			if (cell.cellType === 'query' && cell.outputName) {
				registry.set(cell.outputName, { cell, notebookId: nb.id });
			}
		}
	}
	return registry;
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

export function getConnections(): Connection[] {
	return state.connections;
}

export function getConnectionSecret(connectionId: string): ConnectionSecret | undefined {
	return connectionSecrets[connectionId];
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
		// ID = relative path (without .prql) so getRelativeCellPath can derive the file path
		const dir = folderId ?? 'models';
		// dbt requires model names to be globally unique across the entire project.
		// Check all notebooks (any directory), not just the current folder.
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
	// folders under models/ so we never create dbt model files outside the
	// configured model-paths directory.
	let folderId: string;
	if (state.storageMode === 'filesystem') {
		const modelsFolder = state.folders.find(
			(f) => f.parentId === null && f.id.startsWith('models/')
		);
		folderId = modelsFolder?.id ?? ensureDefaultFolder();
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
	if (state.openResultTabs.length > 0) return state.openResultTabs[state.openResultTabs.length - 1].id;
	if (state.openExtraTabs.length > 0) return state.openExtraTabs[state.openExtraTabs.length - 1].id;
	const fallback = state.notebooks.find((n) => n.id !== closedNotebookId) ?? state.notebooks[0];
	if (!fallback) return '';
	if (!state.openNotebookTabIds.includes(fallback.id)) {
		state.openNotebookTabIds = [...state.openNotebookTabIds, fallback.id];
	}
	return fallback.id;
}

export function openNotebookTab(id: string): void {
	if (!state.notebooks.find((n) => n.id === id)) return;
	if (!state.openNotebookTabIds.includes(id)) {
		state.openNotebookTabIds = [...state.openNotebookTabIds, id];
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
		state.openNotebookTabIds.find((id) => id === state.activeTabId) ??
		state.openNotebookTabIds[0];
	if (!keepId) return;
	state.openNotebookTabIds = [keepId];
	state.activeTabId = keepId;
	scheduleSave();
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
		if (cell.outputName) markDownstreamStale(cell.outputName, 'upstream-changed', new Set(), cell.id);
	}

	// In filesystem mode, delete all cell files from disk.
	// PRQL cells: delete the .prql source + the sibling .sql (dbt-compiled output).
	// SQL cells: delete the .sql source only.
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		for (const cell of nb.cells) {
			const rel = getRelativeCellPath(nb, cell);
			if (rel) {
				deleteProjectFile(state.projectFolder, rel).catch(() => {});
				if (cell.language !== 'sql') {
					deleteProjectFile(state.projectFolder, rel.replace(/\.prql$/, '.sql')).catch(() => {});
				}
			}
		}
	}

	state.openResultTabs = state.openResultTabs.filter((t) => t.notebookId !== id);
	state.openNotebookTabIds = state.openNotebookTabIds.filter((tabId) => tabId !== id);
	state.notebooks = state.notebooks.filter((n) => n.id !== id);
	if (state.openNotebookTabIds.length === 0 && state.notebooks.length > 0) {
		state.openNotebookTabIds = [state.notebooks[Math.max(0, Math.min(idx, state.notebooks.length - 1))].id];
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
		const safe = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'folder';
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
		const safe = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'folder';
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
	state.expandedNotebookFolderIds = state.expandedNotebookFolderIds.filter((folderId) => folderId !== id);
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

		// Update dashboard chart blocks that reference the old cell ID
		if (oldCellId && oldCellId !== name) {
			state.dashboards = state.dashboards.map((d) => {
				const updatedBlocks = d.blocks.map((b) =>
					b.type === 'chart' && b.cellId === oldCellId ? { ...b, cellId: name } : b
				);
				const changed = updatedBlocks.some((b, i) => b !== d.blocks[i]);
				return changed ? { ...d, blocks: updatedBlocks } : d;
			});
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
	if (!state.openNotebookTabIds.includes(state.activeTabId) &&
		!state.openExtraTabs.find((t) => t.id === state.activeTabId)) {
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
	const tab: ExtraTab = { id: makeId(), type: 'table-view', tableName, name: tableName, viewMode: 'table', chartConfig: null };
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
	const tab: ExtraTab = { id: makeId(), type: 'profile', tableName, name: `Profile: ${tableName}`, viewMode: 'table', chartConfig: null };
	state.openExtraTabs = [...state.openExtraTabs, tab];
	state.activeTabId = tab.id;
}

export function openLineageTab(focusedModelName?: string): void {
	const existing = state.openExtraTabs.find((t) => t.type === 'lineage');
	if (existing) {
		if (focusedModelName) (existing as ExtraTab & { focusedModelName?: string }).focusedModelName = focusedModelName;
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
	if (!state.openNotebookTabIds.includes(state.activeTabId) &&
		!state.openResultTabs.find((t) => t.id === state.activeTabId)) {
		state.activeTabId = state.openNotebookTabIds[0] ?? state.notebooks[0].id;
	}
}

// ── Dashboard store functions ─────────────────────────────────────────────────

export function getDashboards(): Dashboard[] {
	return state.dashboards;
}

function toSlug(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'dashboard';
}

export function createDashboard(name: string): Dashboard {
	const baseSlug = toSlug(name);
	let slug = baseSlug;
	let n = 1;
	while (state.dashboards.find((d) => d.slug === slug)) slug = `${baseSlug}_${n++}`;
	const dashboard: Dashboard = { id: makeId(), name, slug, blocks: [] };
	state.dashboards = [...state.dashboards, dashboard];
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		void writeDashboardFile(state.projectFolder, dashboard);
	}
	return dashboard;
}

export function renameDashboard(id: string, name: string): void {
	const idx = state.dashboards.findIndex((d) => d.id === id);
	if (idx === -1) return;
	const old = state.dashboards[idx];
	const newSlug = toSlug(name);
	const updated = { ...old, name, slug: newSlug };
	state.dashboards = state.dashboards.map((d) => (d.id === id ? updated : d));
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		// Delete old file, write new
		void deleteProjectFile(state.projectFolder, `pages/${old.slug}.md`).catch(() => {});
		void writeDashboardFile(state.projectFolder, updated);
	}
}

export function deleteDashboard(id: string): void {
	const dash = state.dashboards.find((d) => d.id === id);
	state.dashboards = state.dashboards.filter((d) => d.id !== id);
	// Close any open dashboard tabs for this dashboard
	state.openExtraTabs = state.openExtraTabs.filter((t) => !(t.type === 'dashboard' && t.dashboardId === id));
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder && dash) {
		void deleteProjectFile(state.projectFolder, `pages/${dash.slug}.md`).catch(() => {});
	}
}

export function addPanelToDashboard(
	dashboardId: string,
	panel: Omit<ChartBlock, 'id' | 'order' | 'type'>
): void {
	const dash = state.dashboards.find((d) => d.id === dashboardId);
	if (!dash) return;
	const maxOrder = dash.blocks.reduce((m, b) => Math.max(m, b.order), -1);
	const newBlock: ChartBlock = { ...panel, type: 'chart', id: makeId(), order: maxOrder + 1 };
	const updated = { ...dash, blocks: [...dash.blocks, newBlock] };
	state.dashboards = state.dashboards.map((d) => (d.id === dashboardId ? updated : d));
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		void writeDashboardFile(state.projectFolder, updated);
	}
}

export function addBlockToDashboard(
	dashboardId: string,
	block: Omit<ChartBlock, 'id' | 'order'> | Omit<TextBlock, 'id' | 'order'> | Omit<CalloutBlock, 'id' | 'order'> | Omit<FilterBlock, 'id' | 'order'>
): void {
	const dash = state.dashboards.find((d) => d.id === dashboardId);
	if (!dash) return;
	const maxOrder = dash.blocks.reduce((m, b) => Math.max(m, b.order), -1);
	const newBlock = { ...block, id: makeId(), order: maxOrder + 1 } as DashboardBlock;
	const updated = { ...dash, blocks: [...dash.blocks, newBlock] };
	state.dashboards = state.dashboards.map((d) => (d.id === dashboardId ? updated : d));
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		void writeDashboardFile(state.projectFolder, updated);
	}
}

export function removeBlockFromDashboard(dashboardId: string, blockId: string): void {
	const dash = state.dashboards.find((d) => d.id === dashboardId);
	if (!dash) return;
	const updated = { ...dash, blocks: dash.blocks.filter((b) => b.id !== blockId) };
	state.dashboards = state.dashboards.map((d) => (d.id === dashboardId ? updated : d));
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		void writeDashboardFile(state.projectFolder, updated);
	}
}

/** @deprecated use removeBlockFromDashboard */
export const removePanelFromDashboard = removeBlockFromDashboard;

export function updateDashboardBlock(
	dashboardId: string,
	blockId: string,
	patch: Record<string, unknown>
): void {
	const dash = state.dashboards.find((d) => d.id === dashboardId);
	if (!dash) return;
	const updated = {
		...dash,
		blocks: dash.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b))
	};
	state.dashboards = state.dashboards.map((d) => (d.id === dashboardId ? updated : d));
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		void writeDashboardFile(state.projectFolder, updated);
	}
}

/** @deprecated use updateDashboardBlock */
export function updateDashboardPanel(
	dashboardId: string,
	panelId: string,
	patch: Partial<Pick<ChartBlock, 'title' | 'width' | 'height'>>
): void {
	updateDashboardBlock(dashboardId, panelId, patch as Record<string, unknown>);
}

export function reorderDashboardPanels(dashboardId: string, orderedBlockIds: string[]): void {
	const dash = state.dashboards.find((d) => d.id === dashboardId);
	if (!dash) return;
	const byId = new Map(dash.blocks.map((b) => [b.id, b]));
	const reordered = orderedBlockIds
		.map((bid, i) => {
			const b = byId.get(bid);
			return b ? { ...b, order: i } : null;
		})
		.filter((b): b is DashboardBlock => b !== null);
	const updated = { ...dash, blocks: reordered };
	state.dashboards = state.dashboards.map((d) => (d.id === dashboardId ? updated : d));
	scheduleSave();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		void writeDashboardFile(state.projectFolder, updated);
	}
}

export function openDashboardTab(dashboardId: string): void {
	const dash = state.dashboards.find((d) => d.id === dashboardId);
	if (!dash) return;
	const existing = state.openExtraTabs.find(
		(t) => t.type === 'dashboard' && t.dashboardId === dashboardId
	);
	if (existing) {
		state.activeTabId = existing.id;
		return;
	}
	const tab: ExtraTab = {
		id: makeId(),
		type: 'dashboard',
		tableName: '',
		name: dash.name,
		viewMode: 'table',
		chartConfig: null,
		dashboardId
	};
	state.openExtraTabs = [...state.openExtraTabs, tab];
	state.activeTabId = tab.id;
}

// ── Evidence.dev flat file serialization ─────────────────────────────────────

function evidenceChartComponent(
	chart: ChartConfig,
	queryName: string,
	heightPx: number
): string {
	const h = `chartAreaHeight=${heightPx}`;
	const title = chart.title ? ` title="${chart.title}"` : '';
	const x = chart.xColumn;
	const y = chart.yColumns[0] ?? '';

	switch (chart.chartType) {
		// ── Evidence.dev data components ──────────────────────────────────────
		case 'table':
			return `<DataTable data={${queryName}} rows=${chart.tableRows ?? 10}${chart.tableSearch ? ' search=true' : ''} downloadable=true />`;
		case 'big-value': {
			const comparisonProp = chart.yColumns[0] ? ` comparison=${chart.yColumns[0]}` : '';
			const sparklineProp = chart.colorColumn ? ` sparkline=${chart.colorColumn}` : '';
			const fmtProp = ''; // users can add fmt manually
			return `<BigValue data={${queryName}} value=${x}${comparisonProp}${sparklineProp}${title ? ` title="${chart.title}"` : ''} />`;
		}
		case 'delta':
			return `<Delta data={${queryName}} column=${x}${chart.deltaDownIsGood ? ' downIsGood=true' : ''} />`;
		case 'value':
			return `<Value data={${queryName}} column=${x}${chart.valueRow ? ` row=${chart.valueRow}` : ''} />`;
		// ── Chart components ──────────────────────────────────────────────────
		case 'line':
			return `<LineChart data={${queryName}} x=${x} y=${y}${chart.yColumnsSecondary?.length ? ` y2=${chart.yColumnsSecondary[0]}` : ''}${chart.colorColumn ? ` series=${chart.colorColumn}` : ''}${title} ${h} />`;
		case 'area':
			return `<AreaChart data={${queryName}} x=${x} y=${y}${chart.colorColumn ? ` series=${chart.colorColumn}` : ''}${title} ${h} />`;
		case 'bar':
			return `<BarChart data={${queryName}} x=${x} y=${y}${chart.colorColumn ? ` series=${chart.colorColumn}` : ''}${chart.seriesMode === 'grouped' ? ' type=grouped' : ''}${title} ${h} />`;
		case 'bar-horizontal':
			return `<BarChart data={${queryName}} x=${x} y=${y}${chart.colorColumn ? ` series=${chart.colorColumn}` : ''} swapXY=true${title} ${h} />`;
		case 'scatter':
			return `<ScatterPlot data={${queryName}} x=${x} y=${y}${chart.colorColumn ? ` series=${chart.colorColumn}` : ''}${title} ${h} />`;
		case 'bubble':
			return `<BubbleChart data={${queryName}} x=${x} y=${y}${chart.sizeColumn ? ` size=${chart.sizeColumn}` : ''}${chart.colorColumn ? ` series=${chart.colorColumn}` : ''}${title} ${h} />`;
		case 'pie':
			return `<PieChart data={${queryName}} name=${x} value=${y}${title} />`;
		case 'histogram':
			return `<Histogram data={${queryName}} x=${y}${title} ${h} />`;
		case 'heatmap':
			return `<Heatmap data={${queryName}} x=${x} y=${chart.colorColumn ?? ''} value=${y}${title} />`;
		case 'calendar-heatmap':
			return `<CalendarHeatmap data={${queryName}} date=${x} value=${y}${title} />`;
		case 'funnel':
			return `<FunnelChart data={${queryName}} nameCol=${x} valueCol=${y}${title} />`;
		case 'box-plot': {
			const [minC, q1C, medC, q3C, maxC] = chart.yColumns;
			return `<BoxPlot data={${queryName}} name=${x} min=${minC} intervalBottom=${q1C} midpoint=${medC} intervalTop=${q3C} max=${maxC}${title} />`;
		}
		case 'sankey':
			return `<SankeyDiagram data={${queryName}} sourceCol=${x} targetCol=${chart.colorColumn ?? ''} valueCol=${y}${title} />`;
		default:
			return `<BarChart data={${queryName}} x=${x} y=${y}${title} ${h} />`;
	}
}

const HEIGHT_MAP: Record<string, number> = { sm: 180, md: 280, lg: 420 };

/** Sanitize a query name to be a valid Evidence SQL block identifier. */
function toQueryName(raw: string, used: Set<string>): string {
	let base = raw.split('/').pop()!.replace(/[^a-z0-9_]/gi, '_').replace(/^[^a-z_]/i, 'q$&').toLowerCase();
	if (!base) base = 'query';
	let name = base;
	let n = 2;
	while (used.has(name)) name = `${base}_${n++}`;
	used.add(name);
	return name;
}

function buildEvidencePage(_folder: string, dashboard: Dashboard): string {
	const blocksSorted = [...dashboard.blocks].sort((a, b) => a.order - b.order);
	const lines: string[] = [];
	const allCells = state.notebooks.flatMap((nb) => nb.cells);
	const usedQueryNames = new Set<string>();

	// ── Frontmatter ───────────────────────────────────────────────────────────
	lines.push('---');
	lines.push(`title: ${dashboard.name}`);
	lines.push('lunapad:');
	lines.push('  version: 2');
	lines.push('  blocks:');
	for (const block of blocksSorted) {
		lines.push(`    - type: ${block.type}`);
		lines.push(`      id: ${block.id}`);
		lines.push(`      width: ${block.width}`);
		lines.push(`      order: ${block.order}`);
		if (block.type === 'chart') {
			lines.push(`      cellId: ${block.cellId}`);
			lines.push(`      height: ${block.height}`);
			if (block.title) lines.push(`      title: "${block.title.replace(/"/g, '\\"')}"`);
		} else if (block.type === 'text') {
			const escaped = block.markdown.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
			lines.push(`      markdown: "${escaped}"`);
		} else if (block.type === 'callout') {
			lines.push(`      variant: ${block.variant}`);
			if (block.title) lines.push(`      title: "${block.title.replace(/"/g, '\\"')}"`);
			const escaped = block.markdown.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
			lines.push(`      markdown: "${escaped}"`);
		} else if (block.type === 'filter') {
			lines.push(`      filterKind: ${block.filterKind}`);
			lines.push(`      label: "${block.label.replace(/"/g, '\\"')}"`);
			lines.push(`      paramName: ${block.paramName}`);
			if (block.defaultValue) lines.push(`      defaultValue: "${block.defaultValue}"`);
			if (block.options?.length) lines.push(`      options: [${block.options.map((o) => `"${o}"`).join(', ')}]`);
		}
	}
	lines.push('---');
	lines.push('');

	// ── Build query name map for chart blocks ──────────────────────────────────
	const queryNames = new Map<string, string>();
	for (const block of blocksSorted) {
		if (block.type !== 'chart') continue;
		const raw = block.cellId.split('/').pop() ?? 'query';
		queryNames.set(block.id, toQueryName(raw, usedQueryNames));
	}

	// ── SQL blocks (one per chart block) ──────────────────────────────────────
	for (const block of blocksSorted) {
		if (block.type !== 'chart') continue;
		const qName = queryNames.get(block.id)!;
		const cellName = block.cellId.split('/').pop();
		const cell = allCells.find((c) => c.outputName === cellName || c.id === block.cellId);
		const sql = cell?.compiledSQL ?? cell?.code ?? `-- cell: ${block.cellId}\nSELECT 1`;
		lines.push('```sql ' + qName);
		lines.push(sql.trim());
		lines.push('```');
		lines.push('');
	}

	// ── Filter blocks (render before main content) ───────────────────────────
	const filterBlocks = blocksSorted.filter((b) => b.type === 'filter') as FilterBlock[];
	if (filterBlocks.length > 0) {
		lines.push('<div class="evidence-filters">');
		lines.push('');
		for (const f of filterBlocks) {
			switch (f.filterKind) {
				case 'dropdown':
					lines.push(`<Dropdown name="${f.paramName}" title="${f.label}"${f.defaultValue ? ` defaultValue="${f.defaultValue}"` : ''} />`);
					break;
				case 'text-input':
					lines.push(`<TextInput name="${f.paramName}" title="${f.label}"${f.defaultValue ? ` defaultValue="${f.defaultValue}"` : ''} />`);
					break;
				case 'date-range':
					lines.push(`<DateRangePicker name="${f.paramName}" title="${f.label}" />`);
					break;
				case 'button-group':
					lines.push(`<ButtonGroup name="${f.paramName}" title="${f.label}" options={[${(f.options ?? []).map((o) => `"${o}"`).join(', ')}]} />`);
					break;
			}
		}
		lines.push('');
		lines.push('</div>');
		lines.push('');
	}

	// ── Main content: interleave text/callout/chart blocks in order ───────────
	// Consecutive chart blocks are grouped into Grid sections.
	type Segment = { kind: 'charts'; blocks: ChartBlock[] } | { kind: 'prose'; block: TextBlock | CalloutBlock };
	const segments: Segment[] = [];
	for (const block of blocksSorted) {
		if (block.type === 'filter') continue; // rendered above
		if (block.type === 'chart') {
			const last = segments[segments.length - 1];
			if (last?.kind === 'charts') {
				last.blocks.push(block as ChartBlock);
			} else {
				segments.push({ kind: 'charts', blocks: [block as ChartBlock] });
			}
		} else if (block.type === 'text' || block.type === 'callout') {
			segments.push({ kind: 'prose', block: block as TextBlock | CalloutBlock });
		}
	}

	for (const seg of segments) {
		if (seg.kind === 'prose') {
			const b = seg.block;
			if (b.type === 'text') {
				lines.push(b.markdown);
				lines.push('');
			} else {
				// Callout → blockquote with variant marker
				const variantLabel = b.variant.charAt(0).toUpperCase() + b.variant.slice(1);
				if (b.title) {
					lines.push(`> **${b.title}**`);
					lines.push(`>`);
					lines.push(`> ${b.markdown.replace(/\n/g, '\n> ')}`);
				} else {
					lines.push(`> **${variantLabel}**: ${b.markdown.replace(/\n/g, '\n> ')}`);
				}
				lines.push('');
			}
			continue;
		}

		// Chart segment: group by width into Grid rows
		const chartBlocks = seg.blocks;
		const groups: Array<{ fullWidth: boolean; blocks: ChartBlock[] }> = [];
		for (const block of chartBlocks) {
			if (block.width === 3) {
				groups.push({ fullWidth: true, blocks: [block] });
			} else {
				const last = groups[groups.length - 1];
				if (last && !last.fullWidth) {
					last.blocks.push(block);
				} else {
					groups.push({ fullWidth: false, blocks: [block] });
				}
			}
		}

		for (const group of groups) {
			if (group.fullWidth) {
				const block = group.blocks[0];
				const qName = queryNames.get(block.id)!;
				const cellName = block.cellId.split('/').pop();
				const cell = allCells.find((c) => c.outputName === cellName || c.id === block.cellId);
				const chart = cell?.resultChartConfig;
				const heightPx = HEIGHT_MAP[block.height] ?? 280;
				if (block.title) lines.push(`## ${block.title}`);
				lines.push(chart ? evidenceChartComponent(chart, qName, heightPx) : `<!-- no chart config for ${block.cellId} -->`);
				lines.push('');
			} else {
				lines.push('<Grid cols=3>');
				lines.push('');
				for (const block of group.blocks) {
					const qName = queryNames.get(block.id)!;
					const cellName = block.cellId.split('/').pop();
					const cell = allCells.find((c) => c.outputName === cellName || c.id === block.cellId);
					const chart = cell?.resultChartConfig;
					const heightPx = HEIGHT_MAP[block.height] ?? 280;
					const component = chart ? evidenceChartComponent(chart, qName, heightPx) : `<!-- no chart config for ${block.cellId} -->`;
					if (block.width === 2) {
						lines.push('<Group>');
						if (block.title) lines.push(`## ${block.title}`);
						lines.push(component);
						lines.push('</Group>');
					} else {
						if (block.title) lines.push(`## ${block.title}`);
						lines.push(component);
					}
					lines.push('');
				}
				lines.push('</Grid>');
				lines.push('');
			}
		}
	}

	return lines.join('\n');
}

async function writeDashboardFile(folder: string, dashboard: Dashboard): Promise<void> {
	const content = buildEvidencePage(folder, dashboard);
	await writeProjectFile(folder, `pages/${dashboard.slug}.md`, content).catch(() => {});
}

export async function loadDashboardsFromProject(folder: string): Promise<void> {
	try {
		const res = await fetch(`/api/project/list-files?folder=${encodeURIComponent(folder)}&pattern=pages/*.md`);
		if (!res.ok) return;
		const body = await res.json() as { files?: string[] };
		const files = body.files ?? [];
		const loaded: Dashboard[] = [];
		for (const file of files) {
			try {
				const contentRes = await fetch(`/api/project/read-file?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`);
				if (!contentRes.ok) continue;
				const { content } = await contentRes.json() as { content: string };
				const dash = parseDashboardFromMd(content, file);
				if (dash) loaded.push(dash);
			} catch {
				// skip unreadable files
			}
		}
		if (loaded.length > 0) {
			state.dashboards = loaded;
		}
	} catch {
		// Endpoint may not exist — ignore
	}
}

function parseDashboardFromMd(content: string, filePath: string): Dashboard | null {
	try {
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (!fmMatch) return null;
		const fm = fmMatch[1];
		const titleMatch = fm.match(/^title:\s*(.+)$/m);
		const name = titleMatch?.[1]?.trim() ?? filePath.split('/').pop()?.replace('.md', '') ?? 'Dashboard';
		const slug = filePath.split('/').pop()?.replace('.md', '') ?? toSlug(name);

		// Parse lunapad: block
		const psMatch = fm.match(/lunapad:\n([\s\S]*?)(?=\n\w|\n*$)/);
		if (!psMatch) return null;
		const ps = psMatch[1];

		// Detect version
		const versionMatch = ps.match(/version:\s*(\d+)/);
		const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;

		if (version >= 2) {
			// v2: read blocks array — each block is a YAML object
			// Simple approach: split on "    - type:" entries
			const blockRaw = ps.replace(/^[\s\S]*?blocks:\n/, '');
			const blockEntries = blockRaw.split(/\n\s{4}- type: /).filter(Boolean);
			const blocks: DashboardBlock[] = [];
			for (const entry of blockEntries) {
				const lines = entry.split('\n');
				const type = lines[0]?.trim() as DashboardBlock['type'];
				const get = (key: string) => {
					const m = entry.match(new RegExp(`${key}: ([^\n]+)`));
					return m?.[1]?.trim() ?? '';
				};
				const getStr = (key: string) => {
					const raw = get(key);
					if (raw.startsWith('"') && raw.endsWith('"')) {
						return raw.slice(1, -1)
							.replace(/\\n/g, '\n')
							.replace(/\\"/g, '"')
							.replace(/\\\\/g, '\\');
					}
					return raw;
				};
				const id = get('id') || makeId();
				const width = (parseInt(get('width'), 10) || 1) as DashboardPanelWidth;
				const order = parseInt(get('order'), 10) || 0;

				if (type === 'chart') {
					blocks.push({
						type: 'chart',
						id, width, order,
						cellId: get('cellId'),
						notebookId: '',
						height: (get('height') || 'md') as DashboardPanelHeight,
						title: getStr('title') || undefined
					});
				} else if (type === 'text') {
					blocks.push({ type: 'text', id, width, order, markdown: getStr('markdown') });
				} else if (type === 'callout') {
					blocks.push({
						type: 'callout', id, width, order,
						variant: (get('variant') || 'info') as CalloutBlock['variant'],
						title: getStr('title') || undefined,
						markdown: getStr('markdown')
					});
				} else if (type === 'filter') {
					const optRaw = get('options');
					const options = optRaw
						? [...optRaw.matchAll(/"([^"]*)"/g)].map((m) => m[1])
						: undefined;
					blocks.push({
						type: 'filter', id, width, order,
						filterKind: (get('filterKind') || 'dropdown') as FilterBlock['filterKind'],
						label: getStr('label'),
						paramName: get('paramName'),
						defaultValue: getStr('defaultValue') || undefined,
						options
					});
				}
			}
			return { id: makeId(), name, slug, blocks };
		} else {
			// v1 legacy: panels array → ChartBlock[]
			const panelBlocks = [...ps.matchAll(/- id: (\S+)\n\s+cellId: (\S+)\n\s+width: (\d)\n\s+height: (\w+)\n\s+order: (\d+)(?:\n\s+queryName: \S+)?(?:\n\s+title: "([^"]*)")?/g)];
			const blocks: ChartBlock[] = panelBlocks.map((m) => ({
				type: 'chart' as const,
				id: m[1],
				cellId: m[2],
				notebookId: '',
				width: Number(m[3]) as DashboardPanelWidth,
				height: m[4] as DashboardPanelHeight,
				order: Number(m[5]),
				title: m[6] || undefined
			}));
			return { id: makeId(), name, slug, blocks };
		}
	} catch {
		return null;
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

	if (state.storageMode === 'filesystem' && state.projectFolder) {
		const outputName = generateUniqueOutputName();
		const newCell: Cell = {
			...makeCell(code, outputName, lang),
			id: outputName,            // filesystem cells use outputName as stable id
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
	addCellWithLanguage(nb.defaultCellLanguage ?? 'prql');
}

export function addMarkdownCell(): void {
	const nb = getActiveNotebook();

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

export function addCellBefore(id: string): void {
	const nb = getActiveNotebook();
	if (state.storageMode === 'filesystem' && state.projectFolder) {
		addCellWithLanguage(nb.defaultCellLanguage ?? 'prql');
		return;
	}
	const lang = nb.defaultCellLanguage ?? 'prql';
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
		addCellWithLanguage(nb.defaultCellLanguage ?? 'prql');
		return;
	}
	const lang = nb.defaultCellLanguage ?? 'prql';
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
	data: { outputName: string; code: string; guiStages: GUIPipelineStage[]; editMode: CellEditMode; language?: CellLanguage }
): void {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	const newCell: Cell = {
		...makeCell(data.code, data.outputName, data.language ?? nb.defaultCellLanguage ?? 'prql'),
		guiStages: data.guiStages,
		editMode: data.editMode
	};
	const cells = [...nb.cells];
	cells.splice(idx, 0, newCell);
	nb.cells = cells;
	scheduleSave();
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
): void {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	const base = nb.cells[idx];
	const inheritedConnection = data.connectionId === undefined ? base?.connectionId ?? null : data.connectionId;
	const newCell: Cell = {
		...makeCell(data.code, data.outputName, data.language ?? nb.defaultCellLanguage ?? 'prql'),
		guiStages: data.guiStages,
		editMode: data.editMode,
		connectionId: inheritedConnection
	};
	const cells = [...nb.cells];
	cells.splice(idx + 1, 0, newCell);
	nb.cells = cells;
	scheduleSave();
}

export function removeCell(id: string): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (cell) {
		clearGuiCompileTimer(id);
		const viewName = cell.outputName || `_cell_${cell.id}`;
		dropView(viewName).catch(() => {});
	}
	nb.cells = nb.cells.filter((c) => c.id !== id);
	scheduleSave();
}

export function moveCell(id: string, direction: 'up' | 'down'): void {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	const newIdx = direction === 'up' ? idx - 1 : idx + 1;
	if (newIdx < 0 || newIdx >= nb.cells.length) return;
	const cells = [...nb.cells];
	[cells[idx], cells[newIdx]] = [cells[newIdx], cells[idx]];
	nb.cells = cells;
	scheduleSave();
}

export function updateCellCode(id: string, code: string): void {
	const nb = getActiveNotebook();
	const idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) return;
	const cell = nb.cells[idx];
	if (cell.cellType === 'markdown') return;
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
	cell.markdown = markdown;
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

export function updateCellName(id: string, name: string): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	const oldName = cell.outputName;
	const oldCellId = cell.id;
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
					state.openNotebookTabIds = state.openNotebookTabIds.map((t) => (t === nb.id ? oldNbId : t));
					if (state.activeTabId === nb.id) state.activeTabId = oldNbId;
					nb.id = oldNbId;
					nb.name = oldName;
					cell.id = oldName;
				}
			});
		}
	} else {
		cell.outputName = name;
		cell.materializeTarget = name;
	}
	// Update dashboard chart blocks that referenced the old cell ID
	const newCellId = cell.id;
	if (oldCellId !== newCellId) {
		state.dashboards = state.dashboards.map((d) => {
			const updatedBlocks = d.blocks.map((b) =>
				b.type === 'chart' && b.cellId === oldCellId ? { ...b, cellId: newCellId } : b
			);
			const changed = updatedBlocks.some((b, i) => b !== d.blocks[i]);
			return changed ? { ...d, blocks: updatedBlocks } : d;
		});
	}
	// Old dependents referenced the old name — they're now broken
	if (oldName && oldName !== name) markDownstreamStale(oldName, 'upstream-changed', new Set(), cell.id);
	scheduleSave();
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
	cell.editMode = mode;
	scheduleSave();
	scheduleFileSave(nb.id, id);
}

export function setCellLanguage(id: string, language: CellLanguage): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	cell.language = language;
	if (language === 'sql') cell.editMode = 'prql';
	cell.errors = [];
	scheduleSave();
	scheduleFileSave(nb.id, id);
}


export function setCellDbtConfig(
	id: string,
	config: { materializeMode?: CellMaterializationMode; dbtSchema?: string | null; dbtTags?: string[] }
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

export function setCellCollapsed(id: string, collapsed: boolean): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
	cell.collapsed = collapsed;
	scheduleSave();
}

export function setCellMaterializeMode(id: string, mode: CellMaterializationMode): void {
	const nb = getActiveNotebook();
	const cell = nb.cells.find((c) => c.id === id);
	if (!cell) return;
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
		...state.connections.filter((entry) => entry.id !== connection.id && entry.type !== 'duckdb-wasm'),
		connection
	];
	state.externalSchemaTables = state.externalSchemaTables.map((table) =>
		table.connectionId === connection.id
			? { ...table, connectionName: connection.name }
			: table
	);
	scheduleSave();
}

export function removeConnection(id: string): void {
	if (id === BUILTIN_DUCKDB_CONNECTION_ID) return;
	state.connections = state.connections.filter((connection) => connection.id !== id);
	state.externalSchemaTables = state.externalSchemaTables.filter((table) => table.connectionId !== id);
	for (const notebook of state.notebooks) {
		for (const cell of notebook.cells) {
			if (cell.connectionId === id) cell.connectionId = null;
		}
	}
	if (connectionSecrets[id]) {
		delete connectionSecrets[id];
		saveSecretsToSessionStorage();
	}
	setRememberedSecret(id, null);
	scheduleSave();
}

export function setConnectionSecret(
	connectionId: string,
	secret: ConnectionSecret | null,
	remember = false
): void {
	if (!connectionId || connectionId === BUILTIN_DUCKDB_CONNECTION_ID) return;
	if (!secret || Object.keys(secret).length === 0) {
		delete connectionSecrets[connectionId];
		setRememberedSecret(connectionId, null);
	} else {
		connectionSecrets[connectionId] = secret;
		setRememberedSecret(connectionId, remember ? secret : null);
	}
	saveSecretsToSessionStorage();
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
	state.externalSchemaTables = state.externalSchemaTables.filter((table) => table.connectionId !== connectionId);
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
function getCompiledCellSQL(
	cells: Cell[],
	idx: number
): { sql: string | null; errors: PRQLError[] } {
	const cell = cells[idx];
	if (!cell || cell.cellType !== 'query') return { sql: null, errors: [] };
	const fullCode = getExecutionCode(cells, idx);
	if (cell.language === 'sql') return { sql: fullCode, errors: [] };
	const connection = getCellConnection(cell);
	return compilePRQLCached(fullCode, getPRQLTargetForConnection(connection));
}

function getExecutionCode(cells: Cell[], idx: number): string {
	const cell = cells[idx];
	if (!cell || cell.cellType !== 'query') return '';
	const connection = getCellConnection(cell);
	const target = getPRQLTargetForConnection(connection);

	const extractCells = (): Map<string, Cell> =>
		new Map([...getGlobalOutputRegistry()].map(([n, { cell: c }]) => [n, c] as [string, Cell]));

	if (cell.language === 'sql') {
		// For SQL cells, build a SQL WITH clause from deps and return raw SQL.
		const compile = (prql: string): string | null => compilePRQLCached(prql, target).sql;
		if (isBuiltinDuckDBConnection(connection)) {
			return buildSQLExecutionCode(cells, idx, compile);
		}
		return buildSQLGlobalExecutionCode(cells, idx, extractCells(), compile);
	}

	if (isBuiltinDuckDBConnection(connection)) {
		return buildExecutionCode(cells, idx);
	}
	// External connection: include cross-notebook deps as CTEs via global registry
	return buildGlobalExecutionCode(cells, idx, extractCells());
}

async function _runCell(cell: Cell, fullCode: string, prevViewName: string | null, signal?: AbortSignal, runId?: string): Promise<void> {
	const context = findCellContext(cell.id);
	if (!context) return;
	if (signal?.aborted) { cell.status = 'idle'; return; }
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
		void Promise.resolve(recordCellExecutionMetadata({
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
		})).catch(() => {});
		return;
	}

	cell.compiledSQL = sql;
	const start = performance.now();
	try {
		const rawResult = isBuiltin
			? await executeSQL(sql)
			: await queryConnectionSQL(connection, getConnectionSecret(connection.id), sql, signal, runId);
		if (signal?.aborted) {
			cell.status = 'idle';
			return;
		}
		const result = normalizeQueryResult(rawResult);
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
		if (cell.outputName) markDownstreamStale(cell.outputName, 'upstream-changed', new Set(), cell.id);
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
		void Promise.resolve(recordCellExecutionMetadata({
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
		})).catch(() => {});
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
		const errSpan = (cell.language === 'sql' && sql)
			? parseSQLErrorSpan(errMessage, cell.code, sql)
			: null;
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
		void Promise.resolve(recordCellExecutionMetadata({
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
		})).catch(() => {});
	}
}

function getCellConnection(cell: Cell): Connection {
	return resolveConnection(state.connections, cell.connectionId);
}

function getSegmentStartIndex(cells: Cell[], idx: number): number {
	const current = cells[idx];
	if (!current || current.cellType === 'markdown') return idx;
	const currentConnectionId = getCellConnection(current).id;

	let segmentStart = 0;
	for (let i = idx - 1; i >= 0; i--) {
		const candidate = cells[i];
		if (candidate.cellType === 'markdown') continue;
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
	if (cells[idx]?.cellType === 'markdown' || startsWithFrom(cells[idx]?.code ?? '')) return null;
	const segmentStart = getSegmentStartIndex(cells, idx);
	for (let i = idx - 1; i >= segmentStart; i--) {
		const prev = cells[i];
		if (prev.cellType === 'markdown') continue;
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
	if (cells[idx].cellType === 'markdown') return '';
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
	const globalReg = new Map([...getGlobalOutputRegistry()].map(([n, { cell: c }]) => [n, c] as [string, Cell]));
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
	const reMap = new Map([...refreshedOutputNames].map((name) => [
		name,
		new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
	]));

	const nextRound: { outputName: string; notebookId: string }[] = [];
	for (const nb of state.notebooks) {
		for (const cell of nb.cells) {
			// Only cascade to cells that have been run before; skip brand-new unrun cells
			if (cell.cellType !== 'query' || !cell.needsRun || !cell.lastRunAt || visited.has(cell.id)) continue;
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
	// Search all notebooks so dashboard "Refresh All" works regardless of which tab is active.
	let nb = getActiveNotebook();
	let idx = nb.cells.findIndex((c) => c.id === id);
	if (idx === -1) {
		for (const n of state.notebooks) {
			const i = n.cells.findIndex((c) => c.id === id);
			if (i !== -1) { nb = n; idx = i; break; }
		}
	}
	if (idx === -1) return;
	const cell = nb.cells[idx];
	if (cell.cellType === 'markdown') return;
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
		if (cell) { cell.status = 'idle'; break; }
	}
}

function collectRunnableSegmentCells(cells: Cell[], startIdx: number): Cell[] {
	const start = cells[startIdx];
	if (!start || start.cellType === 'markdown') return [];
	const startConnectionId = getCellConnection(start).id;
	const toRun: Cell[] = [];
	for (let i = startIdx; i < cells.length; i++) {
		const candidate = cells[i];
		if (candidate.cellType === 'markdown') continue;
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
	if (cell.cellType === 'markdown') return { error: 'Markdown cells are not executable' };
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
		const result = isBuiltin
			? await executeSQL(sql)
			: await queryConnectionSQL(connection, getConnectionSecret(connection.id), sql);
		return normalizeQueryResult(result);
	} catch (err: unknown) {
		return { error: (err as Error).message ?? String(err) };
	}
}

export async function runAll(): Promise<void> {
	const nb = getActiveNotebook();
	for (let i = 0; i < nb.cells.length; i++) {
		const cell = nb.cells[i];
		if (cell.cellType === 'markdown') continue;
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
			: await materializeConnectionRelation(
					connection,
					getConnectionSecret(connection.id),
					targetName,
					sql,
					dbMode,
					targetSchema
			  );
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
	const initial = makeNotebook('Notebook 1');
	state = {
		notebooks: [initial],
		folders: [],
		connections: [BUILTIN_DUCKDB_CONNECTION],
		externalSchemaTables: [],
		openNotebookTabIds: [initial.id],
		expandedNotebookFolderIds: [],
		sidebarSectionsExpanded: {
			notebooks: true,
			tables: true,
			dashboards: true
		},
		activeTabId: initial.id,
		openResultTabs: [],
		openExtraTabs: [],
		tables: [],
		theme: 'system',
		autoRun: false,
		llmConfig: {
			provider: 'openapi-compatible',
			baseUrl: 'http://127.0.0.1:11434/v1',
			model: 'qwen3:4b'
		},
		notebookEvents: [],
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
		evidencePages: [],
		dashboards: []
	};
	connectionSecrets = {};
}

// ── Table actions ─────────────────────────────────────────────────────────────
export function addTable(table: UploadedTable): void {
	state.tables = [
		...state.tables.filter((t) => t.name !== table.name),
		{ ...table, relationType: table.relationType ?? 'table' }
	];
	void Promise.resolve(recordUploadedTableMetadata({
		connectionId: BUILTIN_DUCKDB_CONNECTION_ID,
		table
	})).catch(() => {});
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
