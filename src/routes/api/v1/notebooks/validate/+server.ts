import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';

// notebookId is passed in the body (not the URL) — see the note in
// notebooks/[...notebookId]/+server.ts on why an action suffix can't live there.
export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 60)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json()) as { folder?: string; notebookId?: string };
		if (!body.notebookId) return json({ error: 'notebookId is required' }, { status: 400 });
		return agentActionResponse({ locals, request }, 'validate_notebook', {
			folder: body.folder,
			notebookId: body.notebookId
		});
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
