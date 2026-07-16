import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { regenerateShareToken } from '$lib/server/shared-reports';
import { requireSharesPublish } from '$lib/server/share-guards';
import { logAuditEvent } from '$lib/server/audit';

export const POST: RequestHandler = async ({ request, locals }) => {
	const denied = requireSharesPublish(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const body = (await request.json()) as Partial<{ notebookId: string }>;
	if (!body?.notebookId) return json({ error: 'notebookId is required.' }, { status: 400 });
	try {
		const share = await regenerateShareToken(body.notebookId, {
			orgId: locals.organization!.id,
			projectId: locals.project?.id
		});
		await logAuditEvent({
			actorId: locals.user!.id,
			orgId: locals.organization?.id,
			projectId: locals.project?.id,
			action: 'share.regenerated',
			resourceType: 'share',
			resourceId: share.token,
			metadata: { notebookId: body.notebookId }
		});
		return json({ token: share.token });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to regenerate share link.';
		return json({ error: message }, { status: 400 });
	}
};
