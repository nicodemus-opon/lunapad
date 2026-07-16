import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import { getTenantRepairWarnings } from '$lib/server/tenancy';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const warnings = await getTenantRepairWarnings({
		activeOrgId: locals.organization?.id ?? cookies.get('lunapad_org_id') ?? null,
		activeProjectId: locals.project?.id ?? cookies.get('lunapad_project_id') ?? null
	});
	return json({ warnings });
};
