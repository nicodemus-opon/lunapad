import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getThread, listComments, updateThread, addComment } from '$lib/server/comments';
import { logAuditEvent } from '$lib/server/audit';
import { can, canResolveThread, userFromLocals } from '$lib/server/permissions';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'comments:read')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const thread = await getThread(params.id, locals.user.id, {
		orgId: locals.organization?.id,
		projectId: locals.project?.id
	});
	if (!thread) return json({ error: 'Not found' }, { status: 404 });
	const comments = await listComments(params.id);
	return json({ thread, comments });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const user = userFromLocals(locals.user)!;
	const thread = await getThread(params.id, null, {
		orgId: locals.organization?.id,
		projectId: locals.project?.id
	});
	if (!thread) return json({ error: 'Not found' }, { status: 404 });
	const body = await request.json();
	if (body.status === 'resolved' || body.status === 'archived') {
		if (
			!canResolveThread(user, {
				createdBy: thread.createdBy,
				assigneeId: thread.assigneeId
			})
		) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}
	const updated = await updateThread(
		params.id,
		{
			status: body.status,
			assigneeId: body.assigneeId,
			title: body.title,
			resolvedBy: body.status === 'resolved' ? locals.user.id : null
		},
		{
			orgId: locals.organization?.id,
			projectId: locals.project?.id
		}
	);
	if (body.status === 'resolved') {
		await logAuditEvent({
			actorId: locals.user.id,
			orgId: locals.organization?.id,
			projectId: locals.project?.id,
			action: 'comment.thread_resolved',
			resourceType: 'comment_thread',
			resourceId: params.id
		});
	}
	return json({ thread: updated });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'comments:write')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = await request.json();
	const text = typeof body.body === 'string' ? body.body.trim() : '';
	if (!text) return json({ error: 'body is required' }, { status: 400 });
	const comment = await addComment({
		threadId: params.id,
		authorId: locals.user.id,
		body: text,
		parentId: body.parentId ?? null
	});
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization?.id,
		projectId: locals.project?.id,
		action: 'comment.created',
		resourceType: 'comment',
		resourceId: comment.id,
		metadata: { threadId: params.id }
	});
	return json({ comment }, { status: 201 });
};
