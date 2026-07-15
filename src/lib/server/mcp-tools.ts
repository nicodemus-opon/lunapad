import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PermissionUser } from './permissions.js';
import {
	executeAgentAction,
	listAgentActions,
	type AgentAuthContext,
	type ActionEnvelope
} from './agent-actions.js';

export interface McpAuthContext extends AgentAuthContext {
	user: PermissionUser | null;
	apiKeyId: string | null;
	apiKeyScopes: string[] | null;
}

function ok(result: ActionEnvelope): CallToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function fail(err: unknown): CallToolResult {
	return {
		content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
		isError: true
	};
}

export function createLunapadMcpServer(auth: McpAuthContext): McpServer {
	const server = new McpServer({ name: 'lunapad', version: '1.0.0' });

	for (const action of listAgentActions()) {
		server.registerTool(
			action.name,
			{
				description: action.description,
				inputSchema: action.inputSchema
			},
			async (args) => {
				try {
					const result = await executeAgentAction(
						action.name,
						(args ?? {}) as Record<string, unknown>,
						auth
					);
					if (result.diagnostics.some((d) => d.code === 'FORBIDDEN')) {
						return {
							content: [{ type: 'text', text: JSON.stringify(result) }],
							isError: true
						};
					}
					return ok(result);
				} catch (err) {
					return fail(err);
				}
			}
		);
	}

	return server;
}
