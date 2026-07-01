import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getShareByNotebookId,
	listActiveShares,
	revokeShareByNotebookId,
	setShareSlug,
	upsertShare
} from '$lib/server/shared-reports';
import type { ShareSnapshot } from '$lib/server/shared-reports';
import type { Connection } from '$lib/types/connection';
import { getSecret } from '$lib/server/connection-secrets';
import { can, userFromLocals } from '$lib/server/permissions';
import { logAuditEvent } from '$lib/server/audit';

interface UpsertShareRequest {
	notebookId: string;
	notebookName: string;
	snapshot: ShareSnapshot;
	pollIntervalMs?: number | null;
	requireAuth?: boolean;
	slug?: string | null;
	connections: { connectionId: string; connection: Connection }[];
}

export const GET: RequestHandler = async ({ url }) => {
	const notebookId = url.searchParams.get('notebookId');
	if (!notebookId) {
		// No notebookId — list every active share, for pickers like the site-builder's
		// "add an existing report as a page".
		const shares = await listActiveShares();
		return json({
			shares: shares.map((s) => ({
				notebookId: s.notebookId,
				notebookName: s.notebookName,
				token: s.token,
				slug: s.slug
			}))
		});
	}
	const share = await getShareByNotebookId(notebookId);
	if (!share || share.revoked) return json({ share: null });
	return json({
		share: {
			token: share.token,
			slug: share.slug,
			pollIntervalMs: share.pollIntervalMs,
			requireAuth: share.requireAuth,
			updatedAt: share.updatedAt
		}
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'shares:publish')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = (await request.json()) as Partial<UpsertShareRequest>;
	if (
		!body?.notebookId ||
		!body?.notebookName ||
		!body?.snapshot ||
		!Array.isArray(body.connections)
	) {
		return json(
			{ error: 'notebookId, notebookName, snapshot, and connections are required.' },
			{ status: 400 }
		);
	}
	try {
		const connections = await Promise.all(
			body.connections.map(async (conn) => ({
				connectionId: conn.connectionId,
				connection: conn.connection,
				secret: await getSecret(conn.connectionId)
			}))
		);
		const share = await upsertShare({
			notebookId: body.notebookId,
			notebookName: body.notebookName,
			snapshot: body.snapshot,
			pollIntervalMs: body.pollIntervalMs ?? null,
			requireAuth: body.requireAuth,
			slug: body.slug,
			connections
		});
		await logAuditEvent({
			actorId: locals.user.id,
			action: 'share.published',
			resourceType: 'share',
			resourceId: share.token,
			metadata: { notebookId: body.notebookId }
		});
		return json({ token: share.token, slug: share.slug });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to publish share.';
		return json({ error: message }, { status: 400 });
	}
};

/** Slug-only rename — doesn't touch the snapshot/connections, so it doesn't require republishing. */
export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Partial<{ notebookId: string; slug: string | null }>;
	if (!body?.notebookId) return json({ error: 'notebookId is required.' }, { status: 400 });
	try {
		const share = await setShareSlug(body.notebookId, body.slug ?? null);
		return json({ token: share.token, slug: share.slug });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update slug.';
		return json({ error: message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Partial<{ notebookId: string }>;
	if (!body?.notebookId) return json({ error: 'notebookId is required.' }, { status: 400 });
	await revokeShareByNotebookId(body.notebookId);
	return json({ ok: true });
};
