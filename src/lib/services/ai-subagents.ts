import type { AIChatToolName } from '$lib/types/ai-chat.js';
import type { DiscoveryResult, ReviewResult } from '$lib/types/ai-subagents.js';

export const DISCOVERY_TOOLS: AIChatToolName[] = [
	'search_workspace',
	'list_cells',
	'get_lineage',
	'sample_data',
	'profile_column',
	'query_data',
	'ask_user'
];

export const MODELING_TOOLS: AIChatToolName[] = [
	'record_decision',
	'search_workspace',
	'ask_user'
];

export const SQL_GEN_TOOLS: AIChatToolName[] = [
	'inspect_notebook',
	'create_notebook',
	'apply_notebook_patch',
	'run_query_nodes',
	'validate_notebook',
	'pick_chart',
	'set_chart',
	'set_view_mode',
	'query_data',
	'sample_data',
	'get_cell_result',
	'record_decision',
	'ask_user'
];

export const SQL_REVIEW_TOOLS: AIChatToolName[] = [
	'get_cell_result',
	'get_lineage',
	'query_data',
	'validate_result',
	'ask_user'
];

export const DEBUG_TOOLS: AIChatToolName[] = [
	'get_cell_result',
	'get_lineage',
	'query_data',
	'sample_data',
	'profile_column',
	'inspect_notebook',
	'apply_notebook_patch',
	'run_query_nodes',
	'validate_notebook',
	'validate_result',
	'ask_user'
];

// Curates the notebook into a report: reorders/hides existing cells and inserts narrative
// markdown around them (drives the same Report view/share renderer humans use). The Markdoc
// grid/columns block grammar inside a markdown cell is a secondary tool for dense KPI tiles
// or interactive filters — not the primary composition mechanism. Also covers the
// 'visualize' sprint task (charting a single existing cell).
export const DASHBOARD_TOOLS: AIChatToolName[] = [
	'list_cells',
	'inspect_notebook',
	'get_cell_result',
	'get_lineage',
	'pick_chart',
	'set_chart',
	'set_view_mode',
	'create_notebook',
	'apply_notebook_patch',
	'run_query_nodes',
	'validate_notebook',
	'ask_user'
];

export const INVESTIGATION_TOOLS: AIChatToolName[] = [
	'sample_data',
	'query_data',
	'profile_column',
	'get_cell_result',
	'search_workspace',
	'list_cells',
	'get_lineage',
	'compare_cells',
	'ask_user'
];

export const SPRINT_PLANNING_TOOLS: AIChatToolName[] = [
	'search_workspace',
	'list_cells',
	'sample_data',
	'ask_user'
];

export const DOCUMENTATION_TOOLS: AIChatToolName[] = [
	'inspect_notebook',
	'apply_notebook_patch',
	'validate_notebook',
	'get_cell_result',
	'list_cells',
	'record_decision',
	'ask_user'
];

// Per-task tool sets — narrowed by task type to reduce hallucinated tool use
export const SPRINT_TASK_TOOLS: Record<
	import('$lib/types/ai-chat.js').SprintTaskType,
	AIChatToolName[]
> = {
	investigate: [
		'sample_data',
		'profile_column',
		'query_data',
		'search_workspace',
		'list_cells',
		'get_lineage',
		'record_decision',
		'ask_user'
	],
	build: [
		'inspect_notebook',
		'create_notebook',
		'apply_notebook_patch',
		'run_query_nodes',
		'validate_notebook',
		'validate_result',
		'get_cell_result',
		'query_data',
		'record_decision',
		'ask_user'
	],
	visualize: [
		'pick_chart',
		'set_chart',
		'set_view_mode',
		'get_cell_result',
		'list_cells',
		'ask_user'
	],
	document: DOCUMENTATION_TOOLS,
	dashboard: DASHBOARD_TOOLS
};

export const SUBAGENT_TOOLS: Record<
	NonNullable<import('$lib/types/ai-chat.js').AIChatRequest['subagentType']>,
	AIChatToolName[]
> = {
	discovery: DISCOVERY_TOOLS,
	modeling: MODELING_TOOLS,
	'sql-gen': SQL_GEN_TOOLS,
	'sql-review': SQL_REVIEW_TOOLS,
	debug: DEBUG_TOOLS,
	dashboard: DASHBOARD_TOOLS,
	investigation: INVESTIGATION_TOOLS,
	sprint_planning: SPRINT_PLANNING_TOOLS,
	documentation: DOCUMENTATION_TOOLS
};

export type ChatIntent = 'creation' | 'debug' | 'dashboard' | 'investigation' | 'standard';
export type TaskComplexity = 'medium' | 'complex';

/**
 * Classify the complexity of a creation-intent task to right-size the pipeline.
 *
 * - 'medium'  → discovery + sql-gen only (skip modeling + review)
 * - 'complex' → full 4-phase pipeline with 3 review cycles
 */
export function classifyComplexity(userText: string): TaskComplexity {
	const text = userText.toLowerCase().trim();
	// Complex: analytics domain patterns always need full 4-phase pipeline
	if (
		/\b(retention|cohort|funnel|churn|clv|ltv|rfm|attribution|mrr|arr|dau|mau|wau|nps|cac|arpu|conversion.?rate|customer.?journey|survival.?analysis|user.?lifetime)\b/.test(
			text
		)
	)
		return 'complex';
	// Complex: multi-layer pipelines, warehouse patterns, explicit multi-cell counts
	if (/\b(pipeline|multi.?layer|mart|data\s+warehouse|end.?to.?end)\b/.test(text)) return 'complex';
	const multiCell = /\b([5-9]|\d{2,})\s+(models?|cells?|tables?|metrics?|dimensions?)\b/i.exec(
		text
	);
	if (multiCell) return 'complex';
	return 'medium';
}

/**
 * Classify the user's intent to route to the best subagent or loop.
 *
 * - 'creation'    → 4-phase pipeline (discovery → modeling → sql-gen → sql-review)
 * - 'debug'       → debug loop (diagnose → patch → verify, no create_cell)
 * - 'dashboard'   → dashboard loop (pick_chart → create_dashboard → add blocks)
 * - 'investigation' → read-only loop (explore data, explain, analyze)
 * - 'standard'    → general 30-turn loop with full tool access
 */
export function classifyIntent(userText: string): ChatIntent {
	const text = userText.toLowerCase().trim();

	// Debug: explicit fix/error requests targeting a cell or query
	if (
		/\b(fix|debug|error|fail|break|wrong|incorrect|broken)\b/.test(text) &&
		/\b(cell|query|model|sql|result|output|it|this)\b/.test(text)
	) {
		return 'debug';
	}

	// Modification intents: update/rename/delete — stay in standard loop
	if (
		/\b(update|change|rename|delete|remove|refactor|improve|optimize|check|review)\b/.test(text)
	) {
		return 'standard';
	}

	// Analytics project patterns → creation even when phrased as a question or "show me"
	// These always need model building, not just investigation or charting.
	const analyticsPattern =
		/\b(retention|cohort|funnel|churn|clv|ltv|rfm|attribution|mrr|arr|dau|mau|nps|cac|arpu|conversion.?rate|customer.?journey)\b/;
	if (analyticsPattern.test(text)) return 'creation';

	// Dashboard/visualization: has chart/dashboard noun but NOT a model-building verb+noun combo
	const hasVisualizationVerb = /\b(visuali[sz]e|plot|chart|graph|dashboard|kpi)\b/.test(text);
	const hasModelNoun =
		/\b(model|metric|dimension|fact|staging|mart|transform|pipeline|report|analysis|analytics|table|view|cell|query|notebook)\b/.test(
			text
		);
	const hasCreationVerb =
		/\b(create|build|make|write|generate|model|implement|develop|add|plot|visuali[sz]e|chart|graph|summari[sz]e|aggregate|compute|calculate)\b/.test(
			text
		);
	// Verbs that explicitly build something new (not just chart/visualize which are also visualization verbs)
	const hasStrongCreationVerb = /\b(create|build|make|write|generate|implement|develop)\b/.test(
		text
	);

	// "give me / build me" + model noun → creation; "show me" is too general, handled by question-word check below
	if (/^(give me|build me)\b/.test(text) && hasModelNoun) return 'creation';

	// "build a dashboard" / "create a chart" → dashboard loop (chart existing data, no model building)
	// Note: if analytics domain terms were present (funnel, cohort, etc.) they already returned 'creation' above
	if (hasVisualizationVerb && hasStrongCreationVerb) {
		return 'dashboard';
	}

	// Pure visualization: chart/visualize/add to existing cells — no model building needed
	if (hasVisualizationVerb && !(hasCreationVerb && hasModelNoun)) {
		return 'dashboard';
	}

	// Investigation: strong analytic verbs (prefix match — no trailing \b to match "analyzing", "distribution", etc.)
	if (/\banalyz|\bdistribut|\boutlier|\btrace\b/.test(text) && !hasVisualizationVerb) {
		return 'investigation';
	}

	// Investigation: question-word + analytical intent — read-only, no building
	if (
		/^(what|why|how|where|when|who|explain|describe|show me|tell me|can you|could you|is there|are there|do we have)\b/.test(
			text
		)
	) {
		if (
			/\banalyz|\bdistribut|\boutlier|\btrace\b|\bbreakdown\b|\bspread\b|\bstat\b|\bprofile\b|\bexplain\b/.test(
				text
			)
		) {
			return 'investigation';
		}
		return 'standard';
	}

	// Creation: verb + model noun combo
	if (hasCreationVerb && hasModelNoun) {
		return 'creation';
	}

	return 'standard';
}

/**
 * Parse the list_cells and search_workspace tool results from a Discovery turn
 * into a structured summary for injection into subsequent agent turns.
 */
export function buildDiscoverySummary(toolResults: string[]): string {
	if (toolResults.length === 0) return 'Discovery: no existing models found in workspace.';
	return `Discovery results:\n${toolResults.join('\n\n')}`;
}

/**
 * Attempt to parse a ReviewResult from the <done> block content.
 * The Discovery and Review agents embed structured JSON in their <done> blocks:
 *   <done>{"approved":true,"warnings":["..."],"issues":[],"suggestions":[]}</done>
 * The server strips the <done> block and emits only `suggestions`, so we parse the
 * raw text output of the turn looking for the JSON directly.
 */
export function parseReviewResult(rawText: string): ReviewResult | null {
	const match = rawText.match(/"approved"\s*:\s*(true|false)/);
	if (!match) return null;

	try {
		const jsonStart = rawText.lastIndexOf('{');
		const jsonEnd = rawText.lastIndexOf('}');
		if (jsonStart === -1 || jsonEnd === -1) return null;
		const json = rawText.slice(jsonStart, jsonEnd + 1);
		const parsed = JSON.parse(json) as Partial<
			ReviewResult & { scores: Record<string, number>; total: number }
		>;
		const scores =
			parsed.scores && typeof parsed.scores === 'object'
				? {
						correctness: Number(parsed.scores.correctness ?? 0),
						completeness: Number(parsed.scores.completeness ?? 0),
						performance: Number(parsed.scores.performance ?? 0),
						convention: Number(parsed.scores.convention ?? 0)
					}
				: undefined;
		const total = scores
			? (parsed.total ??
				scores.correctness + scores.completeness + scores.performance + scores.convention)
			: undefined;
		return {
			approved: parsed.approved ?? true,
			scores,
			total,
			warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
			issues: Array.isArray(parsed.issues) ? parsed.issues : []
		};
	} catch (err) {
		console.error('[ai-subagents] parseReviewResult: failed to parse JSON from LLM output:', err);
		return null;
	}
}

/**
 * Generate specific, actionable feedback from a scored review result.
 * Names the failing dimension, the score gap, and a concrete fix direction.
 * Used as the injection content for the sql-gen fix pass so the model knows
 * exactly what to fix rather than receiving a generic "issues found" message.
 */
export function formatReviewFeedback(review: ReviewResult, cycle: number): string {
	const scoreStr = review.scores
		? `Correctness ${review.scores.correctness}/3, Completeness ${review.scores.completeness}/3, Performance ${review.scores.performance}/2, Convention ${review.scores.convention}/2 (total ${review.total ?? '?'}/10)`
		: 'Score unavailable';

	const issueLines = review.issues.slice(0, 4).join('\n');
	const warnLines =
		review.warnings.length > 0
			? `\nWarnings (non-blocking): ${review.warnings.slice(0, 2).join('; ')}`
			: '';

	return `SQL Review cycle ${cycle} — scores: ${scoreStr}\n\nBlocking issues:\n${issueLines}${warnLines}\n\nFix these issues with apply_notebook_patch, then run_query_nodes to verify. Do NOT create unrelated new cells.`;
}

export type { DiscoveryResult, ReviewResult };
