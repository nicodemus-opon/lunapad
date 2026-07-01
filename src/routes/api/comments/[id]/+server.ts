import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteComment,
	editComment,
	listComments,
	toggleReaction
} from '$lib/server/comments';
import { can, canEditComment, userFromLocals } from '$lib/server/permissions';

async function getCommentAuthor(commentId: string): Promise<{
	authorId: string;
	createdAt: string;
	threadId: string;
} | null> {
	const { query } = await import('$lib/server/db.js');
	const rows = await query<{ author_id: string; created_at: string; thread_id: string }>(
		`SELECT author_id, created_at, thread_id FROM comments WHERE id = $1`,
		[commentId]
	);
	const row = rows[0];
	return row
		? { authorId: row.author_id, createdAt: row.created_at, threadId: row.thread_id }
		: null;
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const meta = await getCommentAuthor(params.id);
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
	const meta = await getCommentAuthor(params.id);
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
	const body = await request.json();
	const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : '';
	if (!emoji) return json({ error: 'emoji is required' }, { status: 400 });
	await toggleReaction(params.id, locals.user.id, emoji);
	const meta = await getCommentAuthor(params.id);
	if (!meta) return json({ error: 'Not found' }, { status: 404 });
	const comments = await listComments(meta.threadId);
	return json({ comment: comments.find((c) => c.id === params.id) });
};
