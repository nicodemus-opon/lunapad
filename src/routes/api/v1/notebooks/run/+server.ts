import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runNotebookCellsAction } from '$lib/server/lunapad-actions';
import { isRateLimited } from '$lib/server/api-rate-limit';
import { can, hasApiScope, userFromLocals } from '$lib/server/permissions';

// notebookId is passed in the body (not the URL) — see the note in
// notebooks/[...notebookId]/+server.ts on why an action suffix can't live there.
export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 60)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json()) as { folder?: string; notebookId?: string; cellIds?: string[] };
		if (!body.notebookId) return json({ error: 'notebookId is required' }, { status: 400 });
		const user = userFromLocals(locals.user);
		// Scope restriction only applies to actual API-key callers — a session-cookie
		// admin has apiKeyScopes === null too and must be gated by role alone (see the
		// matching note in hooks.server.ts and mcp-tools.ts's guard()).
		const allowPython =
			can(user, 'admin:manage') &&
			(!locals.apiKeyId || hasApiScope(locals.apiKeyScopes, 'admin:manage'));
		const result = await runNotebookCellsAction({
			folder: body.folder,
			notebookId: body.notebookId,
			cellIds: body.cellIds,
			allowPython
		});
		return json(result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
