import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteComment, editComment, listComments, toggleReaction } from '$lib/server/comments';
import { can, canEditComment, userFromLocals } from '$lib/server/permissions';
import { assertCloudTenantRef } from '$lib/server/tenancy';

async function getScopedCommentAuthor(
	commentId: string,
	tenant: { orgId?: string | null; projectId?: string | null }
): Promise<{
	authorId: string;
	createdAt: string;
	threadId: string;
} | null> {
	const { query } = await import('$lib/server/db.js');
	const { DEFAULT_ORG_ID, DEFAULT_PROJECT_ID } = await import('$lib/server/tenancy.js');
	const rows = await query<{ author_id: string; created_at: string; thread_id: string }>(
		`SELECT c.author_id, c.created_at, c.thread_id
		 FROM comments c
		 JOIN comment_threads t ON t.id = c.thread_id
		 WHERE c.id = $1 AND t.org_id = $2 AND t.project_id = $3`,
		[commentId, tenant.orgId ?? DEFAULT_ORG_ID, tenant.projectId ?? DEFAULT_PROJECT_ID]
	);
	const row = rows[0];
	return row
		? { authorId: row.author_id, createdAt: row.created_at, threadId: row.thread_id }
		: null;
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		assertCloudTenantRef({ orgId: locals.organization?.id ?? '' }, 'Editing a comment');
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 403 });
	}
	const meta = await getScopedCommentAuthor(params.id, {
		orgId: locals.organization?.id,
		projectId: locals.project?.id
	});
	if (!meta) return json({ error: 'Not found' }, { status: 404 });
	if (!canEditComment(userFromLocals(locals.user), meta.authorId, meta.createdAt)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = await request.json();
	const text = typeof body.body === 'string' ? body.body.trim() : '';
	if (!text) return json({ error: 'body is required' }, { status: 400 });
	await editComment(params.id, text);
	const comments = await listComments(meta.threadId);
	return json({ comment: comments.find((c) => c.id === params.id) });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		assertCloudTenantRef({ orgId: locals.organization?.id ?? '' }, 'Deleting a comment');
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 403 });
	}
	const meta = await getScopedCommentAuthor(params.id, {
		orgId: locals.organization?.id,
		projectId: locals.project?.id
	});
	if (!meta) return json({ error: 'Not found' }, { status: 404 });
	const user = userFromLocals(locals.user)!;
	if (meta.authorId !== user.id && !can(user, 'comments:resolve')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	await deleteComment(params.id);
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'comments:write')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	try {
		assertCloudTenantRef({ orgId: locals.organization?.id ?? '' }, 'Reacting to a comment');
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 403 });
	}
	const body = await request.json();
	const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : '';
	if (!emoji) return json({ error: 'emoji is required' }, { status: 400 });
	const meta = await getScopedCommentAuthor(params.id, {
		orgId: locals.organization?.id,
		projectId: locals.project?.id
	});
	if (!meta) return json({ error: 'Not found' }, { status: 404 });
	await toggleReaction(params.id, locals.user.id, emoji);
	const comments = await listComments(meta.threadId);
	return json({ comment: comments.find((c) => c.id === params.id) });
};
