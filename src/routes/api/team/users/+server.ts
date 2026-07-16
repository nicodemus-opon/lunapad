import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import { listOrganizationMembers, setOrganizationMemberRole } from '$lib/server/tenancy';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'comments:read')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const rows = await listOrganizationMembers(locals.organization.id);
	return json({
		users: rows.map((u) => ({
			id: u.id,
			name: u.name,
			email: u.email,
			image: u.image,
			role: u.role,
			mention: u.email.split('@')[0]
		}))
	});
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = await request.json();
	const userId = typeof body.userId === 'string' ? body.userId : '';
	const role = body.role === 'admin' || body.role === 'viewer' ? body.role : 'editor';
	if (!userId) return json({ error: 'userId is required.' }, { status: 400 });
	const updated = await setOrganizationMemberRole({ orgId: locals.organization.id, userId, role });
	if (!updated)
		return json({ error: 'User is not a member of this organization.' }, { status: 404 });
	return json({ ok: true });
};
