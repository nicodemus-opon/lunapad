import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { secureCookieEnabled } from '$lib/server/cloud-config';
import { listOrganizationsForUser, resolveTenantContext } from '$lib/server/tenancy';

const cookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: secureCookieEnabled(),
	maxAge: 60 * 60 * 24 * 365
};

function parseProjectMap(value: string | undefined): Record<string, string> {
	if (!value) return {};
	try {
		return JSON.parse(Buffer.from(value, 'base64url').toString('utf-8')) as Record<string, string>;
	} catch {
		return {};
	}
}

function serializeProjectMap(value: Record<string, string>): string {
	return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url');
}

export const POST: RequestHandler = async ({ params, locals, cookies }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const organizations = await listOrganizationsForUser(locals.user.id);
	const target = organizations.find((item) => item.organization.id === params.id);
	if (!target) return json({ error: 'Workspace not found.' }, { status: 404 });
	const projectMap = parseProjectMap(cookies.get('lunapad_project_by_org'));
	const preferredProjectId = projectMap[params.id];
	const preferred = target.projects.find((project) => project.id === preferredProjectId);
	const project = preferred ?? target.activeProject;
	if (!project) return json({ error: 'Workspace has no active project.' }, { status: 409 });
	const tenant = await resolveTenantContext(locals.user, project.id, params.id);
	projectMap[tenant.organization.id] = tenant.project.id;
	cookies.set('lunapad_org_id', tenant.organization.id, cookieOptions);
	cookies.set('lunapad_project_id', tenant.project.id, cookieOptions);
	cookies.set('lunapad_project_by_org', serializeProjectMap(projectMap), cookieOptions);
	return json({
		organization: tenant.organization,
		project: tenant.project,
		membership: tenant.membership,
		entitlements: tenant.entitlements
	});
};
