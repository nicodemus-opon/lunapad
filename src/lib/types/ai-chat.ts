import type { ChartConfig } from './gui-pipeline.js';

export type SprintTaskType = 'investigate' | 'build' | 'visualize' | 'document' | 'dashboard';
export type SprintTaskStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

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
	topReusableModels: Array<{ name: string; downstreamCount: number; dashboards: string[] }>;
	customInstructions?: string;
}

export interface AIChatCell {
	id: string;
	outputName: string;
	language: 'prql' | 'sql';
	code: string;
	resultColumns: string[];
	status: string;
	upstream?: string[];
	downstream?: string[];
	usedInDashboards?: string[];
	/** Existing chart config — included for context-selected cells so AI can modify it */
	resultChartConfig?: ChartConfig | null;
	/** True when this cell belongs to the notebook currently open/active in the editor */
	isActiveNotebook?: boolean;
	/** downstream cell count + 3×dashboard count — signals high-impact cells */
	criticalityScore?: number;
	/** First error message when status === 'error' — lets the LLM know what to fix */
	errorMessage?: string;
}

export interface AIChatSchemaTable {
	name: string;
	columns: string[];
	columnTypes?: string[];
	rowCount?: number;
	columnProfiles?: Record<string, string>;
}

export interface AIChatRequest {
	messages: Array<{ role: 'user' | 'assistant'; content: string }>;
	notebookContext: {
		cells: AIChatCell[];
		connectionSchema: AIChatSchemaTable[];
		activeConnectionId: string | null;
		connectionDialect: 'duckdb' | 'trino';
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
	subagentType?: 'discovery' | 'modeling' | 'sql-gen' | 'sql-review' | 'debug' | 'dashboard' | 'investigation' | 'sprint_planning';
	/** When set, the server silently drops tool_call events for tools not in this list */
	allowedTools?: AIChatToolName[];
}

export type AIChatToolName =
	| 'create_cell'
	| 'update_cell'
	| 'set_chart'
	| 'pick_chart'
	| 'set_view_mode'
	| 'delete_cell'
	| 'run_cells'
	| 'move_cell'
	| 'get_lineage'
	| 'find_dashboard_usage'
	| 'list_cells'
	| 'search_workspace'
	| 'get_cell_result'
	| 'list_dashboards'
	| 'create_dashboard'
	| 'add_dashboard_block'
	| 'update_dashboard_block'
	| 'open_dashboard'
	| 'query_data'
	| 'sample_data'
	| 'profile_column'
	| 'record_decision'
	| 'validate_result'
	| 'compare_cells';

export interface CreateCellArgs {
	afterCellId?: string;
	outputName: string;
	cellType?: 'query' | 'markdown';
	language?: 'sql' | 'prql';
	editMode?: 'prql' | 'gui';
	code?: string;
	markdown?: string;
	materializeMode?: string;
}

export interface UpdateCellArgs {
	cellId: string;
	code?: string;
	outputName?: string;
	language?: 'sql' | 'prql';
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

export interface FindDashboardUsageArgs {
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

export interface ListDashboardsArgs {
	// no args
}

export interface CreateDashboardArgs {
	name: string;
}

export interface AddDashboardBlockArgs {
	dashboardId: string;
	blockType: 'chart' | 'text' | 'callout' | 'kpi' | 'filter' | 'section';
	config: Record<string, unknown>;
}

export interface UpdateDashboardBlockArgs {
	dashboardId: string;
	blockId: string;
	patch: Record<string, unknown>;
}

export interface OpenDashboardArgs {
	dashboardId: string;
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

export interface AIChatToolCall {
	callId: string;
	tool: AIChatToolName;
	args: CreateCellArgs | UpdateCellArgs | SetChartArgs | PickChartArgs | SetViewModeArgs | DeleteCellArgs | RunCellsArgs | MoveCellArgs | GetCellResultArgs | GetLineageArgs | FindDashboardUsageArgs | SearchWorkspaceArgs | ListDashboardsArgs | CreateDashboardArgs | AddDashboardBlockArgs | UpdateDashboardBlockArgs | OpenDashboardArgs | QueryDataArgs | SampleDataArgs | ProfileColumnArgs | RecordDecisionArgs | ValidateResultArgs | CompareCellsArgs;
}
