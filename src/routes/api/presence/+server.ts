import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listActivePresence, upsertPresence } from '$lib/server/presence';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const notebookId = url.searchParams.get('notebookId');
	const presence = await listActivePresence(notebookId);
	return json({ presence });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json();
	await upsertPresence({
		userId: locals.user.id,
		notebookId: body.notebookId ?? null,
		cellId: body.cellId ?? null
	});
	return json({ ok: true });
};
