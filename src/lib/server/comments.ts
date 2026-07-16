import crypto from 'node:crypto';
import { query } from './db.js';
import type { CommentAnchorType } from './permissions.js';
import { DEFAULT_ORG_ID, DEFAULT_PROJECT_ID } from './tenancy.js';

let commentsTablesReady: Promise<void> | null = null;

export type ThreadStatus = 'open' | 'resolved' | 'archived';

export interface CommentAnchorKey {
	notebookId?: string;
	cellId?: string;
	shareToken?: string;
	startLine?: number;
	endLine?: number;
	contentHash?: string;
	rowFingerprint?: string;
	column?: string;
	stageIndex?: number;
	testName?: string;
	seriesId?: string;
	category?: string;
	value?: unknown;
}

export interface CommentThread {
	id: string;
	anchorType: CommentAnchorType;
	anchorKey: CommentAnchorKey;
	notebookId: string | null;
	cellId: string | null;
	shareToken: string | null;
	title: string | null;
	status: ThreadStatus;
	assigneeId: string | null;
	createdBy: string;
	createdAt: string;
	resolvedAt: string | null;
	resolvedBy: string | null;
	commentCount: number;
	unread?: boolean;
}

export interface Comment {
	id: string;
	threadId: string;
	parentId: string | null;
	authorId: string;
	authorName: string | null;
	authorImage: string | null;
	body: string;
	createdAt: string;
	editedAt: string | null;
	deletedAt: string | null;
	reactions: { emoji: string; userIds: string[] }[];
}

export interface InboxItem {
	thread: CommentThread;
	latestComment: Comment | null;
	reason: 'assigned' | 'mention' | 'unresolved' | 'share_review';
}

async function ensureCommentsTables(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS comment_threads (
			id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			org_id        TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
			project_id    TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}',
			anchor_type   TEXT NOT NULL,
			anchor_key    JSONB NOT NULL,
			notebook_id   TEXT,
			cell_id       TEXT,
			share_token   TEXT,
			title         TEXT,
			status        TEXT NOT NULL DEFAULT 'open',
			assignee_id   TEXT REFERENCES "user"("id") ON DELETE SET NULL,
			created_by    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
			resolved_at   TIMESTAMPTZ,
			resolved_by   TEXT
		)
	`);
	await query(
		`ALTER TABLE comment_threads ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
	);
	await query(
		`ALTER TABLE comment_threads ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}'`
	);
	await query(`
		CREATE TABLE IF NOT EXISTS comments (
			id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			thread_id     UUID NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
			parent_id     UUID REFERENCES comments(id) ON DELETE SET NULL,
			author_id     TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			body          TEXT NOT NULL,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
			edited_at     TIMESTAMPTZ,
			deleted_at    TIMESTAMPTZ
		)
	`);
	await query(`
		CREATE TABLE IF NOT EXISTS comment_reactions (
			comment_id    UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
			user_id       TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			emoji         TEXT NOT NULL,
			PRIMARY KEY (comment_id, user_id, emoji)
		)
	`);
	await query(`
		CREATE TABLE IF NOT EXISTS comment_read_state (
			user_id       TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			thread_id     UUID NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
			last_read_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (user_id, thread_id)
		)
	`);
	await query(
		`CREATE INDEX IF NOT EXISTS comment_threads_notebook_cell_idx ON comment_threads (notebook_id, cell_id)`
	);
	await query(
		`CREATE INDEX IF NOT EXISTS comment_threads_tenant_idx ON comment_threads (org_id, project_id)`
	);
	await query(
		`CREATE INDEX IF NOT EXISTS comment_threads_share_idx ON comment_threads (share_token)`
	);
	await query(`CREATE INDEX IF NOT EXISTS comments_thread_id_idx ON comments (thread_id)`);
}

export function ensureCommentsTablesOnce(): Promise<void> {
	if (!commentsTablesReady) commentsTablesReady = ensureCommentsTables();
	return commentsTablesReady;
}

function mapThread(row: {
	id: string;
	anchor_type: string;
	anchor_key: CommentAnchorKey;
	notebook_id: string | null;
	cell_id: string | null;
	share_token: string | null;
	title: string | null;
	status: string;
	assignee_id: string | null;
	created_by: string;
	created_at: string;
	resolved_at: string | null;
	resolved_by: string | null;
	comment_count?: string;
}): CommentThread {
	return {
		id: row.id,
		anchorType: row.anchor_type as CommentAnchorType,
		anchorKey: row.anchor_key,
		notebookId: row.notebook_id,
		cellId: row.cell_id,
		shareToken: row.share_token,
		title: row.title,
		status: row.status as ThreadStatus,
		assigneeId: row.assignee_id,
		createdBy: row.created_by,
		createdAt: row.created_at,
		resolvedAt: row.resolved_at,
		resolvedBy: row.resolved_by,
		commentCount: Number(row.comment_count ?? 0)
	};
}

function extractMentions(body: string): string[] {
	const mentions = new Set<string>();
	for (const match of body.matchAll(/@([a-zA-Z0-9._-]+)/g)) {
		if (match[1]) mentions.add(match[1].toLowerCase());
	}
	return [...mentions];
}

export async function listThreads(opts: {
	orgId?: string | null;
	projectId?: string | null;
	notebookId?: string | null;
	cellId?: string | null;
	shareToken?: string | null;
	status?: ThreadStatus | null;
	userId?: string | null;
}): Promise<CommentThread[]> {
	await ensureCommentsTablesOnce();
	const conditions: string[] = [];
	const params: unknown[] = [];
	let i = 1;
	conditions.push(`t.org_id = $${i++}`);
	params.push(opts.orgId ?? DEFAULT_ORG_ID);
	conditions.push(`t.project_id = $${i++}`);
	params.push(opts.projectId ?? DEFAULT_PROJECT_ID);
	if (opts.notebookId) {
		conditions.push(`t.notebook_id = $${i++}`);
		params.push(opts.notebookId);
	}
	if (opts.cellId) {
		conditions.push(`t.cell_id = $${i++}`);
		params.push(opts.cellId);
	}
	if (opts.shareToken) {
		conditions.push(`t.share_token = $${i++}`);
		params.push(opts.shareToken);
	}
	if (opts.status) {
		conditions.push(`t.status = $${i++}`);
		params.push(opts.status);
	}
	const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
	const rows = await query<{
		id: string;
		anchor_type: string;
		anchor_key: CommentAnchorKey;
		notebook_id: string | null;
		cell_id: string | null;
		share_token: string | null;
		title: string | null;
		status: string;
		assignee_id: string | null;
		created_by: string;
		created_at: string;
		resolved_at: string | null;
		resolved_by: string | null;
		comment_count: string;
	}>(
		`SELECT t.*, COUNT(c.id)::text AS comment_count
		 FROM comment_threads t
		 LEFT JOIN comments c ON c.thread_id = t.id AND c.deleted_at IS NULL
		 ${where}
		 GROUP BY t.id
		 ORDER BY t.created_at DESC`,
		params
	);
	const threads = rows.map(mapThread);
	if (!opts.userId) return threads;
	return Promise.all(
		threads.map(async (t) => ({
			...t,
			unread: await isThreadUnread(opts.userId!, t.id)
		}))
	);
}

async function isThreadUnread(userId: string, threadId: string): Promise<boolean> {
	const rows = await query<{ latest: string | null; last_read: string | null }>(
		`SELECT MAX(c.created_at) AS latest, r.last_read_at AS last_read
		 FROM comment_threads t
		 LEFT JOIN comments c ON c.thread_id = t.id AND c.deleted_at IS NULL
		 LEFT JOIN comment_read_state r ON r.thread_id = t.id AND r.user_id = $2
		 WHERE t.id = $1
		 GROUP BY r.last_read_at`,
		[threadId, userId]
	);
	const latest = rows[0]?.latest;
	if (!latest) return false;
	if (!rows[0]?.last_read) return true;
	return new Date(latest) > new Date(rows[0].last_read);
}

export async function getThread(
	threadId: string,
	userId?: string | null,
	tenant?: { orgId?: string | null; projectId?: string | null }
): Promise<CommentThread | null> {
	await ensureCommentsTablesOnce();
	const rows = await query<{
		id: string;
		anchor_type: string;
		anchor_key: CommentAnchorKey;
		notebook_id: string | null;
		cell_id: string | null;
		share_token: string | null;
		title: string | null;
		status: string;
		assignee_id: string | null;
		created_by: string;
		created_at: string;
		resolved_at: string | null;
		resolved_by: string | null;
		comment_count: string;
	}>(
		`SELECT t.*, COUNT(c.id)::text AS comment_count
		 FROM comment_threads t
		 LEFT JOIN comments c ON c.thread_id = t.id AND c.deleted_at IS NULL
		 WHERE t.id = $1 AND t.org_id = $2 AND t.project_id = $3
		 GROUP BY t.id`,
		[threadId, tenant?.orgId ?? DEFAULT_ORG_ID, tenant?.projectId ?? DEFAULT_PROJECT_ID]
	);
	const row = rows[0];
	if (!row) return null;
	const thread = mapThread(row);
	if (userId) thread.unread = await isThreadUnread(userId, threadId);
	return thread;
}

export async function listComments(threadId: string): Promise<Comment[]> {
	await ensureCommentsTablesOnce();
	const rows = await query<{
		id: string;
		thread_id: string;
		parent_id: string | null;
		author_id: string;
		author_name: string | null;
		author_image: string | null;
		body: string;
		created_at: string;
		edited_at: string | null;
		deleted_at: string | null;
	}>(
		`SELECT c.id, c.thread_id, c.parent_id, c.author_id, u.name AS author_name, u.image AS author_image,
		        c.body, c.created_at, c.edited_at, c.deleted_at
		 FROM comments c
		 JOIN "user" u ON u.id = c.author_id
		 WHERE c.thread_id = $1
		 ORDER BY c.created_at ASC`,
		[threadId]
	);
	const comments: Comment[] = [];
	for (const row of rows) {
		const reactions = await query<{ emoji: string; user_id: string }>(
			`SELECT emoji, user_id FROM comment_reactions WHERE comment_id = $1`,
			[row.id]
		);
		const byEmoji = new Map<string, string[]>();
		for (const r of reactions) {
			const list = byEmoji.get(r.emoji) ?? [];
			list.push(r.user_id);
			byEmoji.set(r.emoji, list);
		}
		comments.push({
			id: row.id,
			threadId: row.thread_id,
			parentId: row.parent_id,
			authorId: row.author_id,
			authorName: row.author_name,
			authorImage: row.author_image,
			body: row.deleted_at ? '[deleted]' : row.body,
			createdAt: row.created_at,
			editedAt: row.edited_at,
			deletedAt: row.deleted_at,
			reactions: [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }))
		});
	}
	return comments;
}

export async function createThread(input: {
	orgId?: string | null;
	projectId?: string | null;
	anchorType: CommentAnchorType;
	anchorKey: CommentAnchorKey;
	body: string;
	title?: string | null;
	authorId: string;
	assigneeId?: string | null;
}): Promise<{ thread: CommentThread; comment: Comment }> {
	await ensureCommentsTablesOnce();
	const threadId = crypto.randomUUID();
	const commentId = crypto.randomUUID();
	const title =
		input.title?.trim() || input.body.trim().split('\n')[0]?.slice(0, 80) || 'New thread';

	await query(
		`INSERT INTO comment_threads
		 (id, org_id, project_id, anchor_type, anchor_key, notebook_id, cell_id, share_token, title, assignee_id, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		[
			threadId,
			input.orgId ?? DEFAULT_ORG_ID,
			input.projectId ?? DEFAULT_PROJECT_ID,
			input.anchorType,
			JSON.stringify(input.anchorKey),
			input.anchorKey.notebookId ?? null,
			input.anchorKey.cellId ?? null,
			input.anchorKey.shareToken ?? null,
			title,
			input.assigneeId ?? null,
			input.authorId
		]
	);
	await query(`INSERT INTO comments (id, thread_id, author_id, body) VALUES ($1, $2, $3, $4)`, [
		commentId,
		threadId,
		input.authorId,
		input.body
	]);
	await markThreadsRead(input.authorId, [threadId]);
	const thread = (await getThread(threadId, input.authorId, {
		orgId: input.orgId,
		projectId: input.projectId
	}))!;
	const comments = await listComments(threadId);
	return { thread, comment: comments[0] };
}

export async function addComment(input: {
	threadId: string;
	authorId: string;
	body: string;
	parentId?: string | null;
}): Promise<Comment> {
	await ensureCommentsTablesOnce();
	const id = crypto.randomUUID();
	await query(
		`INSERT INTO comments (id, thread_id, parent_id, author_id, body) VALUES ($1, $2, $3, $4, $5)`,
		[id, input.threadId, input.parentId ?? null, input.authorId, input.body]
	);
	await markThreadsRead(input.authorId, [input.threadId]);
	const comments = await listComments(input.threadId);
	return comments.find((c) => c.id === id)!;
}

export async function updateThread(
	threadId: string,
	patch: {
		status?: ThreadStatus;
		assigneeId?: string | null;
		title?: string | null;
		resolvedBy?: string | null;
	},
	tenant: { orgId?: string | null; projectId?: string | null } = {}
): Promise<CommentThread | null> {
	await ensureCommentsTablesOnce();
	const sets: string[] = [];
	const params: unknown[] = [];
	let i = 1;
	if (patch.status !== undefined) {
		sets.push(`status = $${i++}`);
		params.push(patch.status);
		if (patch.status === 'resolved') {
			sets.push(`resolved_at = now()`, `resolved_by = $${i++}`);
			params.push(patch.resolvedBy ?? null);
		} else if (patch.status === 'open') {
			sets.push(`resolved_at = NULL`, `resolved_by = NULL`);
		}
	}
	if (patch.assigneeId !== undefined) {
		sets.push(`assignee_id = $${i++}`);
		params.push(patch.assigneeId);
	}
	if (patch.title !== undefined) {
		sets.push(`title = $${i++}`);
		params.push(patch.title);
	}
	if (!sets.length) return getThread(threadId, null, tenant);
	params.push(threadId);
	params.push(tenant.orgId ?? DEFAULT_ORG_ID);
	params.push(tenant.projectId ?? DEFAULT_PROJECT_ID);
	await query(
		`UPDATE comment_threads
		 SET ${sets.join(', ')}
		 WHERE id = $${i++} AND org_id = $${i++} AND project_id = $${i}`,
		params
	);
	return getThread(threadId, null, tenant);
}

export async function editComment(commentId: string, body: string): Promise<void> {
	await ensureCommentsTablesOnce();
	await query(`UPDATE comments SET body = $2, edited_at = now() WHERE id = $1`, [commentId, body]);
}

export async function deleteComment(commentId: string): Promise<void> {
	await ensureCommentsTablesOnce();
	await query(`UPDATE comments SET deleted_at = now(), body = '' WHERE id = $1`, [commentId]);
}

export async function toggleReaction(
	commentId: string,
	userId: string,
	emoji: string
): Promise<void> {
	await ensureCommentsTablesOnce();
	const existing = await query<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM comment_reactions
		 WHERE comment_id = $1 AND user_id = $2 AND emoji = $3`,
		[commentId, userId, emoji]
	);
	if (Number(existing[0]?.count ?? 0) > 0) {
		await query(
			`DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3`,
			[commentId, userId, emoji]
		);
	} else {
		await query(`INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES ($1, $2, $3)`, [
			commentId,
			userId,
			emoji
		]);
	}
}

export async function markThreadsRead(userId: string, threadIds: string[]): Promise<void> {
	if (!threadIds.length) return;
	await ensureCommentsTablesOnce();
	for (const threadId of threadIds) {
		await query(
			`INSERT INTO comment_read_state (user_id, thread_id, last_read_at)
			 VALUES ($1, $2, now())
			 ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = now()`,
			[userId, threadId]
		);
	}
}

export async function getInbox(
	userId: string,
	tenant: { orgId?: string | null; projectId?: string | null } = {}
): Promise<InboxItem[]> {
	await ensureCommentsTablesOnce();
	const items: InboxItem[] = [];
	const orgId = tenant.orgId ?? DEFAULT_ORG_ID;
	const projectId = tenant.projectId ?? DEFAULT_PROJECT_ID;

	const assigned = await query<{ id: string }>(
		`SELECT id FROM comment_threads
		 WHERE assignee_id = $1 AND status = 'open' AND org_id = $2 AND project_id = $3
		 ORDER BY created_at DESC LIMIT 50`,
		[userId, orgId, projectId]
	);
	for (const row of assigned) {
		const thread = await getThread(row.id, userId, { orgId, projectId });
		if (!thread) continue;
		const comments = await listComments(row.id);
		items.push({
			thread,
			latestComment: comments[comments.length - 1] ?? null,
			reason: 'assigned'
		});
	}

	const mentionRows = await query<{ thread_id: string }>(
		`SELECT DISTINCT c.thread_id
		 FROM comments c
		 JOIN "user" u ON u.id = $1
		 JOIN comment_threads t ON t.id = c.thread_id
		 WHERE c.deleted_at IS NULL AND t.status = 'open' AND t.org_id = $2 AND t.project_id = $3
		   AND (c.body ILIKE '%@' || split_part(u.email, '@', 1) || '%'
		        OR c.body ILIKE '%@' || u.name || '%')
		 ORDER BY c.thread_id
		 LIMIT 50`,
		[userId, orgId, projectId]
	);
	for (const row of mentionRows) {
		if (items.some((i) => i.thread.id === row.thread_id)) continue;
		const thread = await getThread(row.thread_id, userId, { orgId, projectId });
		if (!thread) continue;
		const comments = await listComments(row.thread_id);
		items.push({
			thread,
			latestComment: comments[comments.length - 1] ?? null,
			reason: 'mention'
		});
	}

	const unresolved = await query<{ id: string }>(
		`SELECT t.id FROM comment_threads t
		 WHERE t.status = 'open' AND t.share_token IS NOT NULL AND t.org_id = $1 AND t.project_id = $2
		 ORDER BY t.created_at DESC LIMIT 30`,
		[orgId, projectId]
	);
	for (const row of unresolved) {
		if (items.some((i) => i.thread.id === row.id)) continue;
		const thread = await getThread(row.id, userId, { orgId, projectId });
		if (!thread) continue;
		const comments = await listComments(row.id);
		items.push({
			thread,
			latestComment: comments[comments.length - 1] ?? null,
			reason: 'share_review'
		});
	}

	return items;
}

export async function countOpenThreadsForCell(
	cellId: string,
	tenant: { orgId?: string | null; projectId?: string | null } = {}
): Promise<number> {
	await ensureCommentsTablesOnce();
	const rows = await query<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM comment_threads
		 WHERE cell_id = $1 AND status = 'open' AND org_id = $2 AND project_id = $3`,
		[cellId, tenant.orgId ?? DEFAULT_ORG_ID, tenant.projectId ?? DEFAULT_PROJECT_ID]
	);
	return Number(rows[0]?.count ?? 0);
}

export async function countOpenThreadsForNotebook(
	notebookId: string,
	tenant: { orgId?: string | null; projectId?: string | null } = {}
): Promise<number> {
	await ensureCommentsTablesOnce();
	const rows = await query<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM comment_threads
		 WHERE notebook_id = $1 AND status = 'open' AND org_id = $2 AND project_id = $3`,
		[notebookId, tenant.orgId ?? DEFAULT_ORG_ID, tenant.projectId ?? DEFAULT_PROJECT_ID]
	);
	return Number(rows[0]?.count ?? 0);
}

export async function countUnreadInbox(
	userId: string,
	tenant: { orgId?: string | null; projectId?: string | null } = {}
): Promise<number> {
	const inbox = await getInbox(userId, tenant);
	return inbox.filter((i) => i.thread.unread).length;
}

export { extractMentions };
