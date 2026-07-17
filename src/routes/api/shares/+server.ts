import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getShareByNotebookId,
	listActiveShares,
	revokeShareByNotebookId,
	setShareSlug,
	updateShareSettings,
	upsertShare,
	type ShareTheme
} from '$lib/server/shared-reports';
import type { ShareSnapshot } from '$lib/server/shared-reports';
import type { Connection } from '$lib/types/connection';
import { getSecret } from '$lib/server/connection-secrets';
import { requireSharesPublish, requireSharesRead } from '$lib/server/share-guards';
import { logAuditEvent } from '$lib/server/audit';
import {
	assertCountEntitlement,
	entitlementViolation,
	EntitlementError
} from '$lib/server/entitlements';
import { putObject } from '$lib/server/object-storage';

interface UpsertShareRequest {
	notebookId: string;
	notebookName: string;
	snapshot: ShareSnapshot;
	pollIntervalMs?: number | null;
	requireAuth?: boolean;
	slug?: string | null;
	connections: { connectionId: string; connection: Connection }[];
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const denied = requireSharesRead(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const notebookId = url.searchParams.get('notebookId');
	if (!notebookId) {
		const shares = await listActiveShares({
			orgId: locals.organization!.id,
			projectId: locals.project?.id
		});
		return json({
			shares: shares.map((s) => ({
				notebookId: s.notebookId,
				notebookName: s.notebookName,
				token: s.token,
				slug: s.slug,
				updatedAt: s.updatedAt
			}))
		});
	}
	const share = await getShareByNotebookId(notebookId, {
		orgId: locals.organization!.id,
		projectId: locals.project?.id
	});
	if (!share || share.revoked) return json({ share: null });
	return json({
		share: {
			token: share.token,
			slug: share.slug,
			pollIntervalMs: share.pollIntervalMs,
			requireAuth: share.requireAuth,
			theme: share.theme,
			description: share.description,
			expiresAt: share.expiresAt,
			updatedAt: share.updatedAt
		}
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const denied = requireSharesPublish(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

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
		const existingShares = await listActiveShares({
			orgId: locals.organization!.id,
			projectId: locals.project?.id
		});
		if (!existingShares.some((share) => share.notebookId === body.notebookId)) {
			assertCountEntitlement({
				code: 'max_published_shares',
				limit: locals.entitlements?.maxPublishedShares ?? 0,
				usage: existingShares.length,
				label: 'published share(s)'
			});
		}
		const connections = await Promise.all(
			body.connections.map(async (conn) => ({
				connectionId: conn.connectionId,
				connection: conn.connection,
				secret: await getSecret(conn.connectionId, locals.organization?.id)
			}))
		);
		const share = await upsertShare({
			tenant: { orgId: locals.organization!.id, projectId: locals.project?.id },
			notebookId: body.notebookId,
			notebookName: body.notebookName,
			snapshot: body.snapshot,
			pollIntervalMs: body.pollIntervalMs ?? null,
			requireAuth: body.requireAuth,
			slug: body.slug,
			connections
		});
		if (process.env.OBJECT_STORAGE_PROVIDER === 's3') {
			await putObject({
				key: `shares/${locals.organization!.id}/${share.token}/v${share.currentVersion}.json`,
				body: JSON.stringify(
					{
						token: share.token,
						version: share.currentVersion,
						notebookId: body.notebookId,
						notebookName: body.notebookName,
						snapshot: body.snapshot,
						publishedAt: new Date().toISOString()
					},
					null,
					2
				),
				contentType: 'application/json; charset=utf-8'
			});
		}
		await logAuditEvent({
			actorId: locals.user!.id,
			orgId: locals.organization?.id,
			projectId: locals.project?.id,
			action: 'share.published',
			resourceType: 'share',
			resourceId: share.token,
			metadata: { notebookId: body.notebookId }
		});
		return json({ token: share.token, slug: share.slug });
	} catch (err) {
		if (err instanceof EntitlementError) {
			return json(
				{ error: 'Plan limit reached.', violation: entitlementViolation(err) },
				{ status: 403 }
			);
		}
		const message = err instanceof Error ? err.message : 'Failed to publish share.';
		return json({ error: message }, { status: 400 });
	}
};

/** Slug-only rename or metadata-only settings update — no snapshot rebuild. */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const denied = requireSharesPublish(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const body = (await request.json()) as Partial<{
		notebookId: string;
		slug: string | null;
		pollIntervalMs: number | null;
		requireAuth: boolean;
		expiresAt: string | null;
		theme: ShareTheme;
		description: string | null;
	}>;
	if (!body?.notebookId) return json({ error: 'notebookId is required.' }, { status: 400 });

	try {
		if (body.slug !== undefined) {
			const share = await setShareSlug(body.notebookId, body.slug ?? null, {
				orgId: locals.organization!.id,
				projectId: locals.project?.id
			});
			if (
				body.pollIntervalMs === undefined &&
				body.requireAuth === undefined &&
				body.expiresAt === undefined &&
				body.theme === undefined &&
				body.description === undefined
			) {
				return json({ token: share.token, slug: share.slug });
			}
		}
		const share = await updateShareSettings(
			body.notebookId,
			{
				pollIntervalMs: body.pollIntervalMs,
				requireAuth: body.requireAuth,
				expiresAt: body.expiresAt,
				theme: body.theme,
				description: body.description
			},
			{
				orgId: locals.organization!.id,
				projectId: locals.project?.id
			}
		);
		return json({
			token: share.token,
			slug: share.slug,
			pollIntervalMs: share.pollIntervalMs,
			requireAuth: share.requireAuth,
			expiresAt: share.expiresAt,
			theme: share.theme,
			description: share.description
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update share.';
		return json({ error: message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const denied = requireSharesPublish(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const body = (await request.json()) as Partial<{ notebookId: string }>;
	if (!body?.notebookId) return json({ error: 'notebookId is required.' }, { status: 400 });
	await revokeShareByNotebookId(body.notebookId, {
		orgId: locals.organization!.id,
		projectId: locals.project?.id
	});
	await logAuditEvent({
		actorId: locals.user!.id,
		orgId: locals.organization?.id,
		projectId: locals.project?.id,
		action: 'share.revoked',
		resourceType: 'share',
		resourceId: body.notebookId
	});
	return json({ ok: true });
};
