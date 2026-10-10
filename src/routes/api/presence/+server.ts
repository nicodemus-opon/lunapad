import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listActivePresence, upsertPresence } from '$lib/server/presence';

const devAuthDisabled = process.env.DISABLE_AUTH === '1';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (devAuthDisabled) return json({ presence: [] });
	const notebookId = url.searchParams.get('notebookId');
	try {
		const presence = await listActivePresence({
			orgId: locals.organization?.id,
			projectId: locals.project?.id,
			notebookId
		});
		return json({ presence });
	} catch (err) {
		console.error('[presence GET] failed:', err);
		return json({ error: 'Failed to load presence.' }, { status: 503 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (devAuthDisabled) return json({ ok: true });
	try {
		const body = await request.json();
		await upsertPresence({
			orgId: locals.organization?.id,
			projectId: locals.project?.id,
			userId: locals.user.id,
			notebookId: body.notebookId ?? null,
			cellId: body.cellId ?? null
		});
		return json({ ok: true });
	} catch (err) {
		console.error('[presence POST] failed:', err);
		return json({ error: 'Failed to update presence.' }, { status: 503 });
	}
};
