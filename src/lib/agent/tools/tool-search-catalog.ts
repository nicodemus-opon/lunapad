import type { AIChatToolName } from '$lib/types/ai-chat.js';

// Progressive tool disclosure for the main/standard chat loop: rather than sending every
// tool's full schema on every turn, only this small core set ships by default. Everything
// else is discoverable via the always-present `find_tools` tool, mirroring the deferred
// tool-loading pattern (search by query, load full schema on demand) used for Claude Code's
// own tools. Plain data only — no server-only imports — so both the client (which executes
// find_tools and tracks per-session unlocked tools) and the server (which filters the
// outgoing `tools` array) can import this without crossing the $lib/server boundary.

/** Tools sent with full schema on every standard-loop turn — the ones used on nearly every
 *  request per the Modeling Workflow (investigate → discover → build → validate). */
export const CORE_TOOLS: AIChatToolName[] = [
	'find_tools',
	'inspect_notebook',
	'apply_notebook_patch',
	'create_notebook',
	'run_query_nodes',
	'validate_notebook',
	'sample_data',
	'query_data',
	'profile_column',
	'search_workspace',
	'list_cells',
	'record_decision',
	'ask_user'
];

/** Short search hints for tools NOT in CORE_TOOLS — rarer paths (chart-type override, cell
 *  reordering, screenshot verification, lineage/compare diagnostics). Kept intentionally
 *  terse; the model reads full schemas only after find_tools surfaces a match. */
export const DEFERRED_TOOL_HINTS: Array<{ name: AIChatToolName; hint: string }> = [
	{ name: 'pick_chart', hint: 'auto-select and apply the best chart type for a query result' },
	{
		name: 'set_chart',
		hint: 'set a specific non-default chart type and config (area, pie, scatter, sankey, map, heatmap, etc.)'
	},
	{ name: 'set_view_mode', hint: 'switch a cell between table/chart/stats view' },
	{ name: 'move_cell', hint: 'reorder a cell within the notebook' },
	{
		name: 'render_notebook_screenshot',
		hint: 'render a screenshot of the notebook for visual verification'
	},
	{ name: 'get_lineage', hint: "find a cell's upstream/downstream dependencies" },
	{ name: 'get_cell_result', hint: "read an already-run cell's result without re-querying it" },
	{
		name: 'validate_result',
		hint: "assert a cell's result meets expectations (row count, required columns)"
	},
	{ name: 'compare_cells', hint: 'compare row counts and column schemas of two cells' },
	{ name: 'run_cells', hint: 'execute cells (legacy — prefer run_query_nodes)' }
];

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 2);
}

export interface DeferredToolMatch {
	name: AIChatToolName;
	hint: string;
}

/** Lexical keyword-overlap search over the deferred tool pool — this catalog is ~10 entries,
 *  far too small to warrant an embeddings path (same reasoning as searchMemoryLexical's
 *  fallback in ai-memory.ts, just applied to a static list instead of a growing one). */
export function findDeferredTools(query: string, limit = 5): DeferredToolMatch[] {
	const queryTokens = new Set(tokenize(query));
	if (queryTokens.size === 0) return [];

	const scored = DEFERRED_TOOL_HINTS.map((entry) => {
		const haystack = tokenize(`${entry.name} ${entry.hint}`);
		const overlap = haystack.filter((tok) => queryTokens.has(tok)).length;
		return { entry, overlap };
	});

	return scored
		.filter((s) => s.overlap > 0)
		.sort((a, b) => b.overlap - a.overlap)
		.slice(0, limit)
		.map((s) => s.entry);
}
