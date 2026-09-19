import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import { cleanupOrphanPhysicalCatalogs, reconcileTrinoCatalogs } from '$lib/server/connections';
import { logAuditEvent } from '$lib/server/audit';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const statuses = await reconcileTrinoCatalogs(locals.organization.id);
	// Best-effort: clear lingering lp_* catalogs with no owning connection so a
	// retry after an "already exists" duplicate succeeds without manual cleanup.
	const orphansDropped = await cleanupOrphanPhysicalCatalogs().catch(() => [] as string[]);
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization.id,
		projectId: locals.project?.id,
		action: 'trino.reconciled',
		resourceType: 'trino_catalogs',
		resourceId: locals.organization.id,
		metadata: { statuses, orphansDropped }
	});
	return json({ statuses, orphansDropped });
};
