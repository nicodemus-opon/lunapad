import type { AIChatToolName } from '$lib/types/ai-chat.js';
import { SUBAGENT_TOOLS } from '$lib/services/ai-subagents.js';
import type { SubagentType } from '$lib/types/ai-subagents.js';
import { NATIVE_TOOLS } from '$lib/agent/server/tools/native-schemas.js';
import { READONLY_INVESTIGATION_TOOLS } from '$lib/server/ai-tools.js';
import { STOP_AFTER_TOOLS } from '$lib/agent/server/stream/stop-after.js';
import { AI_MUTATING_TOOLS } from '$lib/server/permissions.js';

export type ToolExecutor = 'client' | 'server' | 'either';

export interface AgentToolDef {
	name: string;
	schema: {
		type: string;
		function: {
			name: string;
			description: string;
			parameters?: Record<string, unknown>;
		};
	};
	executor: ToolExecutor;
	mutates: boolean;
	stopAfter: boolean;
	/** MCP / headless server tools use these names */
	mcpAlias?: string;
}

const MUTATING = new Set<string>(AI_MUTATING_TOOLS);

function schemaByName(name: string): (typeof NATIVE_TOOLS)[number] | undefined {
	return NATIVE_TOOLS.find((t) => t.function.name === name);
}

function invSchema(name: string): (typeof READONLY_INVESTIGATION_TOOLS)[number] {
	const s = READONLY_INVESTIGATION_TOOLS.find((t) => t.function.name === name);
	if (!s) throw new Error(`Missing investigation schema: ${name}`);
	return s;
}

function mcpOnlyTool(
	name: string,
	description: string,
	parameters: Record<string, unknown> = { type: 'object', properties: {} },
	opts: { mutates?: boolean; stopAfter?: boolean } = {}
): AgentToolDef {
	return {
		name,
		schema: {
			type: 'function',
			function: { name, description, parameters }
		},
		executor: 'server',
		mutates: opts.mutates ?? false,
		stopAfter: opts.stopAfter ?? false,
		mcpAlias: name
	};
}

/** Tools with a real server-side implementation too (notebook-mutation.ts, threaded
 *  through lunapad-actions.ts/mcp-tools.ts) — client behavior is unchanged, this just
 *  makes them reachable headlessly via MCP/REST as well. See schemasForMcp() below. */
const SERVER_CAPABLE_NATIVE_TOOLS = new Set([
	'query_data',
	'sample_data',
	'profile_column',
	'create_notebook',
	'apply_notebook_patch',
	'inspect_notebook',
	'validate_notebook',
	'run_query_nodes',
	'run_cells',
	'pick_chart',
	'set_chart'
]);

/** In-app chat tools (sidebar assistant) */
const IN_APP_TOOLS: AgentToolDef[] = NATIVE_TOOLS.map((schema) => ({
	name: schema.function.name,
	schema,
	executor: SERVER_CAPABLE_NATIVE_TOOLS.has(schema.function.name) ? 'either' : 'client',
	mutates: MUTATING.has(schema.function.name),
	stopAfter: STOP_AFTER_TOOLS.has(schema.function.name)
}));

/** MCP-only server tools (external agents) */
const MCP_ONLY_TOOLS: AgentToolDef[] = [
	mcpOnlyTool(
		'list_capabilities',
		'List agent API capabilities, resource ref formats, workflow recipes, and visual report grammar metadata.'
	),
	mcpOnlyTool(
		'get_visual_report_grammar',
		'Return block types, chart types, data roles, style axes, reference-deconstruction guidance, icon names, and generic blueprint seeds for visual reports.'
	),
	mcpOnlyTool(
		'get_component_capabilities',
		'Return the self-describing AI-authorable component registry shared by prompts, planner, editor, validation, and MCP clients.'
	),
	mcpOnlyTool(
		'get_notebook_app_grammar',
		'Return the generic data-app-to-notebook grammar, primitive view skeletons, fail-soft diagnostics, and component capabilities.'
	),
	mcpOnlyTool(
		'plan_notebook_app',
		'Plan a general data app as notebook IR primitives using the component capability registry.',
		{
			type: 'object',
			properties: {
				prompt: { type: 'string' },
				availableOutputNames: { type: 'array', items: { type: 'string' } }
			},
			required: ['prompt']
		}
	),
	mcpOnlyTool(
		'repair_notebook_blueprint',
		'Run deterministic fail-soft repair on a notebook blueprint without mutating files.',
		{
			type: 'object',
			properties: {
				blueprint: { type: 'object' },
				autoRepair: { type: 'string', enum: ['off', 'safe', 'aggressive'] },
				knownRefs: { type: 'array', items: { type: 'string' } }
			},
			required: ['blueprint']
		}
	),
	mcpOnlyTool(
		'score_notebook_blueprint',
		'Score a notebook blueprint for validity, layout, interaction, data-view coverage, recovery, and narrative usefulness.',
		{
			type: 'object',
			properties: {
				blueprint: { type: 'object' },
				target: { type: 'string', enum: ['valid', 'polished', 'publication'] },
				autoRepair: { type: 'string', enum: ['off', 'safe', 'aggressive'] },
				knownRefs: { type: 'array', items: { type: 'string' } }
			},
			required: ['blueprint']
		}
	),
	mcpOnlyTool(
		'inspect_resource',
		'Inspect a resource ref such as notebook:<id>, cell:<notebook>#<cellId>, output:<notebook>#<outputName>, connection:<id>, or dbt-job:<id>.',
		{
			type: 'object',
			properties: { folder: { type: 'string' }, resourceRef: { type: 'string' } },
			required: ['resourceRef']
		}
	),
	mcpOnlyTool(
		'discover_schema',
		'Discover tables, columns, types, descriptions, and foreign-key hints for a connection.',
		{
			type: 'object',
			properties: {
				connectionId: { type: 'string' },
				schema: { type: 'string' },
				table: { type: 'string' },
				limit: { type: 'number' },
				offset: { type: 'number' }
			},
			required: ['connectionId']
		}
	),
	mcpOnlyTool(
		'validate_workflow',
		'Dry-run an ordered workflow of agent actions with step refs and per-step envelopes.',
		{
			type: 'object',
			properties: {
				steps: { type: 'array', items: { type: 'object' } },
				stopOnError: { type: 'boolean' }
			},
			required: ['steps']
		}
	),
	mcpOnlyTool(
		'run_workflow',
		'Run ordered agent actions with step refs and per-step envelopes.',
		{
			type: 'object',
			properties: {
				steps: { type: 'array', items: { type: 'object' } },
				stopOnError: { type: 'boolean' }
			},
			required: ['steps']
		},
		{ mutates: true }
	),
	mcpOnlyTool(
		'delete_resource',
		'Delete supported resources. Currently supports notebook:<notebookId> for .luna notebooks.',
		{
			type: 'object',
			properties: { folder: { type: 'string' }, resourceRef: { type: 'string' } },
			required: ['resourceRef']
		},
		{ mutates: true }
	),
	{
		name: 'list_connections',
		schema: {
			type: 'function',
			function: {
				name: 'list_connections',
				description: 'List configured external connections.',
				parameters: { type: 'object', properties: {} }
			}
		},
		executor: 'server',
		mutates: false,
		stopAfter: false,
		mcpAlias: 'list_connections'
	},
	{
		name: 'run_query',
		schema: {
			type: 'function',
			function: {
				name: 'run_query',
				description: 'Run read-only SQL on external connection.',
				parameters: {
					type: 'object',
					properties: { connectionId: { type: 'string' }, sql: { type: 'string' } },
					required: ['connectionId', 'sql']
				}
			}
		},
		executor: 'server',
		mutates: false,
		stopAfter: true,
		mcpAlias: 'run_query'
	},
	{
		name: 'run_prql',
		schema: {
			type: 'function',
			function: {
				name: 'run_prql',
				description: 'Compile PRQL and run on external connection.',
				parameters: {
					type: 'object',
					properties: { connectionId: { type: 'string' }, prql: { type: 'string' } },
					required: ['connectionId', 'prql']
				}
			}
		},
		executor: 'server',
		mutates: false,
		stopAfter: true,
		mcpAlias: 'run_prql'
	},
	{
		name: 'list_notebooks',
		schema: {
			type: 'function',
			function: {
				name: 'list_notebooks',
				description: 'List project notebooks.',
				parameters: {
					type: 'object',
					properties: { folder: { type: 'string' } }
				}
			}
		},
		executor: 'server',
		mutates: false,
		stopAfter: false,
		mcpAlias: 'list_notebooks'
	},
	{
		name: 'get_notebook',
		schema: {
			type: 'function',
			function: {
				name: 'get_notebook',
				description: 'Get notebook with cells.',
				parameters: {
					type: 'object',
					properties: { folder: { type: 'string' }, notebookId: { type: 'string' } },
					required: ['notebookId']
				}
			}
		},
		executor: 'server',
		mutates: false,
		stopAfter: false,
		mcpAlias: 'get_notebook'
	},
	{
		name: 'dbt_run',
		schema: {
			type: 'function',
			function: {
				name: 'dbt_run',
				description: 'Run dbt run in project folder.',
				parameters: {
					type: 'object',
					properties: { folder: { type: 'string' }, select: { type: 'string' } }
				}
			}
		},
		executor: 'server',
		mutates: true,
		stopAfter: false,
		mcpAlias: 'dbt_run'
	},
	{
		name: 'dbt_compile',
		schema: {
			type: 'function',
			function: {
				name: 'dbt_compile',
				description: 'Run dbt compile.',
				parameters: { type: 'object', properties: { folder: { type: 'string' } } }
			}
		},
		executor: 'server',
		mutates: true,
		stopAfter: false,
		mcpAlias: 'dbt_compile'
	},
	{
		name: 'get_dbt_job_status',
		schema: {
			type: 'function',
			function: {
				name: 'get_dbt_job_status',
				description: 'Poll dbt job status.',
				parameters: {
					type: 'object',
					properties: { jobId: { type: 'string' } },
					required: ['jobId']
				}
			}
		},
		executor: 'server',
		mutates: false,
		stopAfter: false,
		mcpAlias: 'get_dbt_job_status'
	},
	{
		name: 'get_dbt_manifest',
		schema: {
			type: 'function',
			function: {
				name: 'get_dbt_manifest',
				description: 'Get dbt manifest.',
				parameters: { type: 'object', properties: { folder: { type: 'string' } } }
			}
		},
		executor: 'server',
		mutates: false,
		stopAfter: false,
		mcpAlias: 'get_dbt_manifest'
	},
	mcpOnlyTool('list_shares', 'List active published shares.', undefined, { mutates: false }),
	mcpOnlyTool(
		'publish_notebook',
		'Publish a notebook as a read-only share.',
		{
			type: 'object',
			properties: { notebookId: { type: 'string' } },
			required: ['notebookId']
		},
		{ mutates: true }
	),
	mcpOnlyTool(
		'create_site_page',
		'Add a published share as a page on a site.',
		{
			type: 'object',
			properties: {
				siteId: { type: 'string' },
				pageSlug: { type: 'string' },
				navLabel: { type: 'string' },
				shareToken: { type: 'string' }
			},
			required: ['siteId', 'pageSlug', 'navLabel', 'shareToken']
		},
		{ mutates: true }
	),
	// Cross-surface: investigation tools available on server via workspace snapshot
	{
		name: 'search_workspace',
		schema: invSchema('search_workspace'),
		executor: 'either',
		mutates: false,
		stopAfter: false
	},
	{
		name: 'get_lineage',
		schema: invSchema('get_lineage'),
		executor: 'either',
		mutates: false,
		stopAfter: false
	}
];

const REGISTRY = new Map<string, AgentToolDef>();

for (const t of [...IN_APP_TOOLS, ...MCP_ONLY_TOOLS]) {
	if (!REGISTRY.has(t.name)) REGISTRY.set(t.name, t);
}

export function getAgentTool(name: string): AgentToolDef | undefined {
	return REGISTRY.get(name);
}

export function listAgentTools(opts?: {
	executor?: ToolExecutor;
	mutates?: boolean;
	names?: AIChatToolName[];
}): AgentToolDef[] {
	let tools = [...REGISTRY.values()];
	if (opts?.executor) tools = tools.filter((t) => t.executor === opts.executor);
	if (opts?.mutates !== undefined) tools = tools.filter((t) => t.mutates === opts.mutates);
	if (opts?.names) tools = tools.filter((t) => opts.names!.includes(t.name as AIChatToolName));
	return tools;
}

export function schemasForChat(allowedTools?: AIChatToolName[]): typeof NATIVE_TOOLS {
	if (!allowedTools) return NATIVE_TOOLS;
	return NATIVE_TOOLS.filter((t) => allowedTools.includes(t.function.name as AIChatToolName));
}

export function schemasForMcp(): AgentToolDef[] {
	// 'either' tools (query_data/sample_data/profile_column plus the notebook-mutation
	// tools above) have a real server implementation and belong here too — previously
	// this only returned 'server', silently excluding every 'either' tool from MCP.
	return [...listAgentTools({ executor: 'server' }), ...listAgentTools({ executor: 'either' })];
}

export function isStopAfterTool(name: string): boolean {
	return STOP_AFTER_TOOLS.has(name);
}

export function toolsForPhase(phase: SubagentType): AIChatToolName[] {
	return SUBAGENT_TOOLS[phase] ?? [];
}
