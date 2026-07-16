import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createInvitation,
	listOrganizationInvitations,
	revokeInvitation
} from '$lib/server/invitations';
import { logAuditEvent } from '$lib/server/audit';
import { can, userFromLocals, type UserRole } from '$lib/server/permissions';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const invitations = await listOrganizationInvitations(locals.organization?.id);
	return json({ invitations });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = await request.json();
	const email = typeof body.email === 'string' ? body.email.trim() : '';
	const role = body.role === 'admin' || body.role === 'viewer' ? body.role : ('editor' as UserRole);
	if (!email) return json({ error: 'email is required' }, { status: 400 });
	const invitation = await createInvitation({
		orgId: locals.organization?.id,
		email,
		role,
		createdBy: locals.user.id
	});
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization?.id,
		projectId: locals.project?.id,
		action: 'user.invited',
		resourceType: 'invitation',
		resourceId: invitation.id,
		metadata: { email, role }
	});
	return json({ invitation }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });
	await revokeInvitation(id, locals.organization?.id);
	return json({ ok: true });
};
