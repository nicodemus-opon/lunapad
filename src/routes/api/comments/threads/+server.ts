import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createThread, listThreads, ensureCommentsTablesOnce } from '$lib/server/comments';
import { logAuditEvent } from '$lib/server/audit';
import { can, userFromLocals } from '$lib/server/permissions';
import type { CommentAnchorType } from '$lib/server/permissions';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'comments:read')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	await ensureCommentsTablesOnce();
	const threads = await listThreads({
		notebookId: url.searchParams.get('notebookId'),
		cellId: url.searchParams.get('cellId'),
		shareToken: url.searchParams.get('shareToken'),
		status: (url.searchParams.get('status') as 'open' | 'resolved' | null) ?? null,
		userId: locals.user.id
	});
	return json({ threads });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'comments:write')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = await request.json();
	const anchorType = body.anchorType as CommentAnchorType;
	const anchorKey = body.anchorKey ?? {};
	const text = typeof body.body === 'string' ? body.body.trim() : '';
	if (!anchorType || !text) {
		return json({ error: 'anchorType and body are required' }, { status: 400 });
	}
	const result = await createThread({
		anchorType,
		anchorKey,
		body: text,
		title: body.title ?? null,
		authorId: locals.user.id,
		assigneeId: body.assigneeId ?? null
	});
	await logAuditEvent({
		actorId: locals.user.id,
		action: 'comment.thread_created',
		resourceType: 'comment_thread',
		resourceId: result.thread.id,
		metadata: { anchorType, cellId: anchorKey.cellId ?? null }
	});
	return json(result, { status: 201 });
};
