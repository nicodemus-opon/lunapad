import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listConnectionsAction } from '$lib/server/lunapad-actions';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		return json(await listConnectionsAction());
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
