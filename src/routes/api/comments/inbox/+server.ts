import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getInbox, countUnreadInbox, markThreadsRead } from '$lib/server/comments';
import { can, userFromLocals } from '$lib/server/permissions';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'comments:read')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	if (url.searchParams.get('count') === '1') {
		const unread = await countUnreadInbox(locals.user.id);
		return json({ unread });
	}
	const items = await getInbox(locals.user.id);
	return json({ items });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json();
	const threadIds = Array.isArray(body.threadIds) ? body.threadIds : [];
	await markThreadsRead(locals.user.id, threadIds);
	return json({ ok: true });
};
