import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimitedAsync } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';
import { publicApiErrorResponse } from '$lib/server/public-api-errors';

export const GET: RequestHandler = async ({ url, locals, request }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (await isRateLimitedAsync(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const folder = url.searchParams.get('folder') ?? undefined;
		return agentActionResponse({ locals, request }, 'list_notebooks', { folder });
	} catch (err) {
		return publicApiErrorResponse(err, { surface: 'v1.notebooks.list' });
	}
};

// Create a whole .luna notebook atomically from a typed blueprint — same
// compile/validate path (and same underlying action) as the create_notebook MCP tool.
export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (await isRateLimitedAsync(rateLimitKey, 60)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json()) as {
			folder?: string;
			notebookId?: string;
			title?: string;
			executableCells?: unknown;
			blocks?: unknown;
		};
		if (!body.notebookId || !Array.isArray(body.blocks)) {
			return json({ error: 'notebookId and blocks are required' }, { status: 400 });
		}
		return agentActionResponse({ locals, request }, 'create_notebook', {
			folder: body.folder,
			notebookId: body.notebookId,
			title: body.title,
			executableCells: body.executableCells as never,
			blocks: body.blocks as never
		});
	} catch (err) {
		return publicApiErrorResponse(err, { surface: 'v1.notebooks.create' });
	}
};
