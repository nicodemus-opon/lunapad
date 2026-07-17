import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createLunapadMcpServer } from '$lib/server/mcp-tools';
import { isRateLimitedAsync } from '$lib/server/api-rate-limit';
import { userFromLocals } from '$lib/server/permissions';
import { publicApiErrorResponse } from '$lib/server/public-api-errors';

// Stateless MCP endpoint: a fresh server + transport per request, no session tracking.
// All of Lunapad's tools are simple request/response actions (no server-initiated push),
// so JSON responses (no SSE stream) are sufficient — see enableJsonResponse below.
async function handle({
	request,
	locals
}: {
	request: Request;
	locals: App.Locals;
}): Promise<Response> {
	const rateLimitKey = `mcp:${locals.apiKeyId ?? locals.user?.id}`;
	if (await isRateLimitedAsync(rateLimitKey, 300)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	// hooks.server.ts deliberately skips its normal per-path permission gate for /api/mcp
	// (it can't see which JSON-RPC tool is being called before dispatch) — every tool
	// handler inside createLunapadMcpServer checks its own required permission against
	// this context instead. locals.user is still required by that same hook (a request
	// with no resolved session/API-key user never reaches this handler).
	try {
		const server = createLunapadMcpServer({
			user: userFromLocals(locals.user),
			apiKeyId: locals.apiKeyId,
			apiKeyScopes: locals.apiKeyScopes,
			tenant: locals.organization
				? { orgId: locals.organization.id, projectId: locals.project?.id }
				: undefined,
			entitlements: locals.entitlements
		});
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true
		});
		await server.connect(transport);
		return transport.handleRequest(request);
	} catch (err) {
		return publicApiErrorResponse(err, { surface: 'mcp', status: 500 });
	}
}

export const GET: RequestHandler = handle;
export const POST: RequestHandler = handle;
export const DELETE: RequestHandler = handle;
