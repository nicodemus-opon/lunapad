import type { ChartConfig } from './gui-pipeline.js';

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
}

export interface AIChatSchemaTable {
	name: string;
	columns: string[];
}

export interface AIChatRequest {
	messages: Array<{ role: 'user' | 'assistant'; content: string }>;
	notebookContext: {
		cells: AIChatCell[];
		connectionSchema: AIChatSchemaTable[];
		activeConnectionId: string | null;
	};
	llmConfig: { provider: string; baseUrl: string; model: string };
	workspaceMemory?: string;
}

export type AIChatToolName =
	| 'create_cell'
	| 'update_cell'
	| 'set_chart'
	| 'set_view_mode'
	| 'delete_cell'
	| 'run_cells'
	| 'get_lineage'
	| 'find_dashboard_usage'
	| 'list_cells'
	| 'search_workspace';

export interface CreateCellArgs {
	afterCellId?: string;
	outputName: string;
	cellType?: 'query' | 'markdown';
	language?: 'sql' | 'prql';
	editMode?: 'prql' | 'gui';
	code?: string;
	markdown?: string;
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

export interface AIChatToolCall {
	callId: string;
	tool: AIChatToolName;
	args: CreateCellArgs | UpdateCellArgs | SetChartArgs | SetViewModeArgs | DeleteCellArgs | RunCellsArgs | GetLineageArgs | FindDashboardUsageArgs | SearchWorkspaceArgs;
}
