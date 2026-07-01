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

/** In-app chat tools (sidebar assistant) */
const IN_APP_TOOLS: AgentToolDef[] = NATIVE_TOOLS.map((schema) => ({
	name: schema.function.name,
	schema,
	executor: ['query_data', 'sample_data', 'profile_column'].includes(schema.function.name)
		? 'either'
		: 'client',
	mutates: MUTATING.has(schema.function.name),
	stopAfter: STOP_AFTER_TOOLS.has(schema.function.name)
}));

/** MCP-only server tools (external agents) */
const MCP_ONLY_TOOLS: AgentToolDef[] = [
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
		mutates: false,
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
		mutates: false,
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
	return listAgentTools({ executor: 'server' });
}

export function isStopAfterTool(name: string): boolean {
	return STOP_AFTER_TOOLS.has(name);
}

export function toolsForPhase(phase: SubagentType): AIChatToolName[] {
	return SUBAGENT_TOOLS[phase] ?? [];
}
