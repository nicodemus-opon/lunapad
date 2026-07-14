import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNotebooksAction, createNotebookAction } from '$lib/server/lunapad-actions';
import { isRateLimited } from '$lib/server/api-rate-limit';

export const GET: RequestHandler = async ({ url, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const folder = url.searchParams.get('folder') ?? undefined;
		return json(await listNotebooksAction({ folder }));
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

// Create a whole .luna notebook atomically from a typed blueprint — same
// compile/validate path (and same underlying action) as the create_notebook MCP tool.
export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 60)) {
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
		const result = await createNotebookAction({
			folder: body.folder,
			notebookId: body.notebookId,
			title: body.title,
			executableCells: body.executableCells as never,
			blocks: body.blocks as never
		});
		if (result.diagnostics.length) return json(result, { status: 422 });
		return json(result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
