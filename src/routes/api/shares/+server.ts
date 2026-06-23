import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShareByNotebookId, revokeShareByNotebookId, upsertShare } from '$lib/server/shared-reports';
import type { ShareSnapshot } from '$lib/server/shared-reports';
import type { Connection } from '$lib/types/connection';
import { getSecret } from '$lib/server/connection-secrets';

interface UpsertShareRequest {
	notebookId: string;
	notebookName: string;
	snapshot: ShareSnapshot;
	pollIntervalMs?: number | null;
	connections: { connectionId: string; connection: Connection }[];
}

export const GET: RequestHandler = async ({ url }) => {
	const notebookId = url.searchParams.get('notebookId');
	if (!notebookId) return json({ error: 'notebookId is required.' }, { status: 400 });
	const share = await getShareByNotebookId(notebookId);
	if (!share || share.revoked) return json({ share: null });
	return json({
		share: {
			token: share.token,
			pollIntervalMs: share.pollIntervalMs,
			updatedAt: share.updatedAt
		}
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Partial<UpsertShareRequest>;
	if (!body?.notebookId || !body?.notebookName || !body?.snapshot || !Array.isArray(body.connections)) {
		return json({ error: 'notebookId, notebookName, snapshot, and connections are required.' }, { status: 400 });
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
			connections
		});
		return json({ token: share.token });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to publish share.';
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Partial<{ notebookId: string }>;
	if (!body?.notebookId) return json({ error: 'notebookId is required.' }, { status: 400 });
	await revokeShareByNotebookId(body.notebookId);
	return json({ ok: true });
};
