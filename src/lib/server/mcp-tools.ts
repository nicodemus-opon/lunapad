import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PermissionUser } from './permissions.js';
import {
	executeAgentAction,
	listAgentActions,
	type AgentAuthContext,
	type ActionEnvelope
} from './agent-actions.js';
import { logPublicApiError, sanitizePublicApiError } from './public-api-errors.js';

export interface McpAuthContext extends AgentAuthContext {
	user: PermissionUser | null;
	apiKeyId: string | null;
	apiKeyScopes: string[] | null;
}

/** Exported for direct unit testing (mcp-tools.test.ts) — the image-block lifting logic
 *  is otherwise only reachable by driving a real screenshot render through the full MCP
 *  protocol, which needs a working headless Chromium and is too heavy for a unit test. */
export function ok(result: ActionEnvelope): CallToolResult {
	const data = result.data as
		| { segments?: Array<{ index: number; base64: string; mimeType: string }> }
		| undefined;
	if (data?.segments?.length) {
		// Lift each rendered segment (src/lib/server/notebook-render.ts) into a real MCP
		// image block, in scroll order, so the client can "read down the page". The
		// accompanying text block has the base64 stripped out to avoid ~2x payload size.
		const strippedSegments = data.segments.map(({ base64: _base64, ...rest }) => rest);
		return {
			content: [
				...data.segments.map((s) => ({
					type: 'image' as const,
					data: s.base64,
					mimeType: s.mimeType
				})),
				{
					type: 'text',
					text: JSON.stringify({ ...result, data: { ...data, segments: strippedSegments } })
				}
			]
		};
	}
	return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function fail(err: unknown): CallToolResult {
	logPublicApiError('mcp.tool', err);
	return {
		content: [{ type: 'text', text: sanitizePublicApiError(err) }],
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
