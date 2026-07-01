/** Tools that stop the LLM stream after first call so the client can execute and return results. */
export const STOP_AFTER_TOOLS = new Set([
	'run_cells',
	'sample_data',
	'query_data',
	'profile_column',
	'get_cell_result'
]);

export function shouldStopAfterTool(tool: string): boolean {
	return STOP_AFTER_TOOLS.has(tool);
}
