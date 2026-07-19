import type { ChartConfig } from './gui-pipeline.js';
import type { GeneratedDashboardDefinition } from '$lib/services/generated-dashboard.js';
import type {
	NotebookBlueprint,
	NotebookPatchOperation
} from '$lib/services/notebook-blueprint.js';
import type { PMDocJSON } from '$lib/services/markdoc-pm.js';

/** 'dashboard' composes a Markdoc grid/columns layout of metric/chart widgets in one markdown cell. */
export type SprintTaskType = 'investigate' | 'build' | 'visualize' | 'document' | 'dashboard';
export type SprintTaskStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

/** Fixed stages of the 'creation' intent's subagent pipeline (runSubagentPipeline). */
export type PipelinePhaseId = 'discovery' | 'modeling' | 'sql-gen' | 'sql-review';
export type PipelinePhaseStatus = 'pending' | 'active' | 'done';

export interface PipelinePhase {
	id: PipelinePhaseId;
	label: string;
	status: PipelinePhaseStatus;
}

export interface SprintTask {
	id: string;
	type: SprintTaskType;
	title: string;
	successCriteria?: string;
	status: SprintTaskStatus;
	cellIds?: string[];
	result?: string;
}

export interface WorkspaceNamingRule {
	prefix: string;
	description: string;
	materialization: string;
}

export interface WorkspaceContract {
	namingRules: WorkspaceNamingRule[];
	topReusableModels: Array<{ name: string; downstreamCount: number }>;
	customInstructions?: string;
}

export interface AIChatCell {
	id: string;
	outputName: string;
	language: 'prql' | 'sql';
	/** 'query'|'markdown' cells use `language` for dialect; 'python' cells ignore it. */
	cellType?: 'query' | 'markdown' | 'python' | 'plot';
	code: string;
	/** Markdown source for document/prose/dashboard cells. */
	markdown?: string;
	resultColumns: string[];
	status: string;
	upstream?: string[];
	downstream?: string[];
	/** Existing chart config — included for context-selected cells so AI can modify it */
	resultChartConfig?: ChartConfig | null;
	/** True when this cell belongs to the notebook currently open/active in the editor */
	isActiveNotebook?: boolean;
	/** True when the user attached this cell via "Share with AI" for the current message */
	isContextCell?: boolean;
	/** downstream cell count — signals high-impact cells */
	criticalityScore?: number;
	/** First error message when status === 'error' — lets the LLM know what to fix */
	errorMessage?: string;
	/** Python cells only — last run's captured stdout (truncated) */
	pythonStdout?: string;
	/** Python cells only — last run's error, if any (truncated) */
	pythonError?: string;
}

export interface AIChatSchemaTable {
	name: string;
	columns: string[];
	columnTypes?: string[];
	rowCount?: number;
	columnProfiles?: Record<string, string>;
	/** Table-level description/comment, when the connector or dbt project exposes one. */
	description?: string;
}

export interface AIChatRequest {
	messages: Array<{ role: 'user' | 'assistant'; content: string }>;
	notebookContext: {
		cells: AIChatCell[];
		/** Local (DuckDB) tables only — unchanged truncation, small and dynamic, no retrieval needed. */
		connectionSchema: AIChatSchemaTable[];
		/** Distinct external connectionIds referenced by the notebook's cells — used by the server to
		 *  run retrieval against `schema_embeddings`, scoped to these connections. */
		externalConnectionIds: string[];
		/** Today's client-truncated external table list — used only as a fallback when server-side
		 *  retrieval is unavailable (no Postgres/Ollama, or no embeddings yet for these connections). */
		externalSchemaFallback: AIChatSchemaTable[];
		activeConnectionId: string | null;
		connectionDialect: 'duckdb' | 'trino';
		/** Whether the server-side Python worker is ready — gates Python tool guidance/use. */
		pythonAvailable: boolean;
	};
	llmConfig: { provider: string; baseUrl: string; model: string; apiKey?: string };
	workspaceMemory?: string;
	sessionDataContext?: Record<string, string>;
	/** Modeling decisions recorded via record_decision — persists across turns */
	sessionPlanContext?: string[];
	workspaceContract?: WorkspaceContract;
	/** Non-empty when the schema changed since the previous turn */
	schemaChangeNote?: string;
	/** Subagent mode: narrows the system prompt to a specialized role */
	subagentType?:
		| 'discovery'
		| 'modeling'
		| 'sql-gen'
		| 'sql-review'
		| 'debug'
		| 'dashboard'
		| 'investigation'
		| 'sprint_planning'
		| 'documentation';
	/** When set, the server silently drops tool_call events for tools not in this list */
	allowedTools?: AIChatToolName[];
}

export type AIChatToolName =
	| 'create_notebook'
	| 'inspect_notebook'
	| 'apply_notebook_patch'
	| 'run_query_nodes'
	| 'validate_notebook'
	| 'create_cell'
	| 'update_cell'
	| 'set_chart'
	| 'pick_chart'
	| 'set_view_mode'
	| 'delete_cell'
	| 'run_cells'
	| 'render_notebook_screenshot'
	| 'move_cell'
	| 'get_lineage'
	| 'list_cells'
	| 'search_workspace'
	| 'get_cell_result'
	| 'query_data'
	| 'sample_data'
	| 'profile_column'
	| 'record_decision'
	| 'validate_result'
	| 'compare_cells'
	| 'ask_user';

export interface CreateCellArgs {
	afterCellId?: string;
	outputName: string;
	cellType?: 'query' | 'markdown' | 'python' | 'plot';
	language?: 'sql' | 'prql';
	editMode?: 'prql' | 'gui';
	code?: string;
	markdown?: string;
	/** Structured notebook/report/dashboard content compiled into canonical Markdoc server-side. */
	dashboard?: GeneratedDashboardDefinition;
	materializeMode?: string;
}

export interface CreateNotebookArgs {
	/** Complete typed notebook draft. Compiled into a PM document and committed atomically. */
	blueprint: NotebookBlueprint;
}

export interface InspectNotebookArgs {
	notebookId?: string;
}

export interface ApplyNotebookPatchArgs {
	notebookId?: string;
	/** Optional display title/name for the notebook being patched. */
	title?: string;
	operations?: NotebookPatchOperation[];
	document?: PMDocJSON;
	blueprint?: NotebookBlueprint;
	executableCells?: NotebookBlueprint['executableCells'];
}

export interface RunQueryNodesArgs {
	nodeIds?: string[];
	cellIds?: string[];
}

export interface ValidateNotebookArgs {
	notebookId?: string;
	document?: PMDocJSON;
}

export interface UpdateCellArgs {
	cellId: string;
	code?: string;
	outputName?: string;
	language?: 'sql' | 'prql';
	markdown?: string;
	/** Structured notebook/report/dashboard content compiled into canonical Markdoc server-side. */
	dashboard?: GeneratedDashboardDefinition;
	/** Set true to hide this cell from Report view/published shares; false to surface it. */
	hideInReport?: boolean;
}

export interface SetChartArgs {
	cellId: string;
	chartConfig: ChartConfig;
}

export interface SetViewModeArgs {
	cellId: string;
	mode: 'table' | 'chart' | 'stats';
}

export interface DeleteCellArgs {
	cellId: string;
}

export interface RunCellsArgs {
	cellIds: string[];
}

export interface GetLineageArgs {
	outputName: string;
}

export interface SearchWorkspaceArgs {
	query: string;
}

export interface QueryDataArgs {
	sql: string;
	limit?: number;
}

export interface SampleDataArgs {
	table: string;
	n?: number;
}

export interface ProfileColumnArgs {
	table: string;
	column: string;
}

export interface RecordDecisionArgs {
	decision: string;
	/** Defaults to 'decision' when omitted. */
	type?: 'decision' | 'discovery';
}

export interface PickChartArgs {
	cellId: string;
}

export interface MoveCellArgs {
	cellId: string;
	direction?: 'up' | 'down';
	toIndex?: number;
}

export interface GetCellResultArgs {
	cellId: string;
	limit?: number;
}

export interface ValidateResultArgs {
	cellId: string;
	expectedRowCount?: number;
	minRowCount?: number;
	expectedColumns?: string[];
	assertNotEmpty?: boolean;
}

export interface CompareCellsArgs {
	cellId1: string;
	cellId2: string;
}

export interface AskUserArgs {
	question: string;
	options?: string[];
}

export interface AIChatToolCall {
	callId: string;
	tool: AIChatToolName;
	args:
		| CreateNotebookArgs
		| InspectNotebookArgs
		| ApplyNotebookPatchArgs
		| RunQueryNodesArgs
		| ValidateNotebookArgs
		| CreateCellArgs
		| UpdateCellArgs
		| SetChartArgs
		| PickChartArgs
		| SetViewModeArgs
		| DeleteCellArgs
		| RunCellsArgs
		| MoveCellArgs
		| GetCellResultArgs
		| GetLineageArgs
		| SearchWorkspaceArgs
		| QueryDataArgs
		| SampleDataArgs
		| ProfileColumnArgs
		| RecordDecisionArgs
		| ValidateResultArgs
		| CompareCellsArgs
		| AskUserArgs;
}
