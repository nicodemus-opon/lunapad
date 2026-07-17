import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createOrganizationForUser, listOrganizationsForUser } from '$lib/server/tenancy';
import { logAuditEvent } from '$lib/server/audit';
import { secureCookieEnabled } from '$lib/server/cloud-config';

function setTenantCookies(
	cookies: Parameters<RequestHandler>[0]['cookies'],
	orgId: string,
	projectId: string
) {
	const options = {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: secureCookieEnabled(),
		maxAge: 60 * 60 * 24 * 365
	};
	cookies.set('lunapad_org_id', orgId, options);
	cookies.set('lunapad_project_id', projectId, options);
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	const organizations = await listOrganizationsForUser(
		locals.user.id,
		locals.organization.id,
		locals.project?.id ?? cookies.get('lunapad_project_id') ?? null
	);
	return json({
		organizations,
		activeOrgId: locals.organization.id,
		activeProjectId: locals.project?.id ?? null
	});
};

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json();
	const workspaceName = typeof body.workspaceName === 'string' ? body.workspaceName.trim() : '';
	const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : 'Starter project';
	if (!workspaceName) return json({ error: 'Workspace name is required.' }, { status: 400 });
	const tenant = await createOrganizationForUser({
		userId: locals.user.id,
		userName: locals.user.name,
		email: locals.user.email,
		orgName: workspaceName,
		projectName
	});
	setTenantCookies(cookies, tenant.organization.id, tenant.project.id);
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: tenant.organization.id,
		projectId: tenant.project.id,
		action: 'organization.created',
		resourceType: 'organization',
		resourceId: tenant.organization.id,
		metadata: { name: tenant.organization.name }
	});
	return json({
		organization: tenant.organization,
		project: tenant.project,
		membership: tenant.membership,
		entitlements: tenant.entitlements
	}, { status: 201 });
};
