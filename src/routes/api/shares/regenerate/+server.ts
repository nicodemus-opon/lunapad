import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { regenerateShareToken } from '$lib/server/shared-reports';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Partial<{ notebookId: string }>;
	if (!body?.notebookId) return json({ error: 'notebookId is required.' }, { status: 400 });
	try {
		const share = await regenerateShareToken(body.notebookId);
		return json({ token: share.token });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to regenerate share link.';
		return json({ error: message }, { status: 400 });
	}
};
