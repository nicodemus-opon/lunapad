import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import {
	leaveOrganization,
	listOrganizationsForUser,
	resolveTenantContext,
	updateOrganization
} from '$lib/server/tenancy';
import { logAuditEvent } from '$lib/server/audit';

const cookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: process.env.NODE_ENV === 'production',
	maxAge: 60 * 60 * 24 * 365
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	if (params.id !== locals.organization.id) return json({ error: 'Workspace not active.' }, { status: 403 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = await request.json();
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'Workspace name is required.' }, { status: 400 });
	const organization = await updateOrganization(params.id, { name });
	if (!organization) return json({ error: 'Workspace not found.' }, { status: 404 });
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: organization.id,
		projectId: locals.project?.id,
		action: 'organization.updated',
		resourceType: 'organization',
		resourceId: organization.id,
		metadata: { name: organization.name }
	});
	return json({ organization });
};

export const DELETE: RequestHandler = async ({ params, locals, cookies }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const left = await leaveOrganization({ orgId: params.id, userId: locals.user.id });
		if (!left) return json({ error: 'Workspace membership not found.' }, { status: 404 });
		await logAuditEvent({
			actorId: locals.user.id,
			orgId: params.id,
			projectId: null,
			action: 'organization.left',
			resourceType: 'organization',
			resourceId: params.id
		});
		const organizations = await listOrganizationsForUser(locals.user.id);
		const next = organizations[0];
		if (!next?.activeProject) {
			cookies.delete('lunapad_org_id', { path: '/' });
			cookies.delete('lunapad_project_id', { path: '/' });
			return json({ ok: true, organization: null, project: null });
		}
		const tenant = await resolveTenantContext(locals.user, next.activeProject.id, next.organization.id);
		cookies.set('lunapad_org_id', tenant.organization.id, cookieOptions);
		cookies.set('lunapad_project_id', tenant.project.id, cookieOptions);
		return json({
			ok: true,
			organization: tenant.organization,
			project: tenant.project,
			membership: tenant.membership,
			entitlements: tenant.entitlements
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to leave workspace.';
		return json({ error: message }, { status: 400 });
	}
};
