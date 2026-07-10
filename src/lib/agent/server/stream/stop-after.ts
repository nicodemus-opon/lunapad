/** Tools that stop the LLM stream after first call so the client can execute and return results. */
export const STOP_AFTER_TOOLS = new Set([
	'create_notebook',
	'apply_notebook_patch',
	'run_query_nodes',
	'validate_notebook',
	'run_cells',
	'sample_data',
	'query_data',
	'profile_column',
	'get_cell_result',
	'ask_user'
]);

export function shouldStopAfterTool(tool: string): boolean {
	return STOP_AFTER_TOOLS.has(tool);
}
