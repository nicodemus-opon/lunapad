import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import { reconcileTrinoCatalogs } from '$lib/server/connections';
import { logAuditEvent } from '$lib/server/audit';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const statuses = await reconcileTrinoCatalogs(locals.organization.id);
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization.id,
		projectId: locals.project?.id,
		action: 'trino.reconciled',
		resourceType: 'trino_catalogs',
		resourceId: locals.organization.id,
		metadata: { statuses }
	});
	return json({ statuses });
};
