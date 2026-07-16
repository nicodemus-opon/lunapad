import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAuditEvents } from '$lib/server/audit';
import { can, userFromLocals } from '$lib/server/permissions';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const events = await listAuditEvents({ limit, offset, orgId: locals.organization?.id });
	return json({ events });
};
