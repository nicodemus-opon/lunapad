import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import { getTrinoCatalogStatuses } from '$lib/server/connections';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const catalogs = await getTrinoCatalogStatuses(locals.organization.id);
	return json({ catalogs });
};
