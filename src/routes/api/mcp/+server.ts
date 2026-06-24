import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createLunapadMcpServer } from '$lib/server/mcp-tools';
import { isRateLimited } from '$lib/server/api-rate-limit';

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
	if (isRateLimited(rateLimitKey, 300)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	const server = createLunapadMcpServer();
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);
	return transport.handleRequest(request);
}

export const GET: RequestHandler = handle;
export const POST: RequestHandler = handle;
export const DELETE: RequestHandler = handle;
