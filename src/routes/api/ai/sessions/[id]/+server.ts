import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAgentSession } from '$lib/server/agent-sessions.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const session = await getAgentSession(params.id, locals.user.id);
	if (!session) return json({ error: 'Not found' }, { status: 404 });
	return json({ session });
};
