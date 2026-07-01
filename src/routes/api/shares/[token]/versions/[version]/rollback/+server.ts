import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rollbackShareToVersion } from '$lib/server/shared-reports';
import { requireSharesPublish } from '$lib/server/share-guards';
import { logAuditEvent } from '$lib/server/audit';

export const POST: RequestHandler = async ({ params, locals }) => {
	const denied = requireSharesPublish(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const version = Number(params.version);
	if (!Number.isInteger(version)) return json({ error: 'Invalid version.' }, { status: 400 });
	try {
		const share = await rollbackShareToVersion(params.token, version);
		await logAuditEvent({
			actorId: locals.user!.id,
			action: 'share.rollback',
			resourceType: 'share',
			resourceId: share.token,
			metadata: { version }
		});
		return json({ token: share.token, currentVersion: share.currentVersion });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to roll back.';
		return json({ error: message }, { status: 400 });
	}
};
