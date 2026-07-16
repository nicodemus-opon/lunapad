import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { completeCloudSignup } from '$lib/server/onboarding';
import { deploymentMode } from '$lib/server/tenancy';
import { logAuditEvent } from '$lib/server/audit';

function setTenantCookies(
	cookies: Parameters<RequestHandler>[0]['cookies'],
	orgId: string,
	projectId: string
) {
	const options = {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: process.env.NODE_ENV === 'production',
		maxAge: 60 * 60 * 24 * 365
	};
	cookies.set('lunapad_org_id', orgId, options);
	cookies.set('lunapad_project_id', projectId, options);
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (deploymentMode() !== 'cloud') {
		return json({ error: 'Cloud signup is not available in this deployment.' }, { status: 404 });
	}
	if (process.env.PUBLIC_CLOUD_SIGNUP_ENABLED === 'false') {
		return json({ error: 'Cloud signup is currently closed.' }, { status: 403 });
	}
	const body = await request.json();
	try {
		const result = await completeCloudSignup({
			name: typeof body.name === 'string' ? body.name : '',
			email: typeof body.email === 'string' ? body.email : '',
			password: typeof body.password === 'string' ? body.password : '',
			workspaceName: typeof body.workspaceName === 'string' ? body.workspaceName : '',
			projectName: typeof body.projectName === 'string' ? body.projectName : '',
			headers: request.headers
		});
		setTenantCookies(
			cookies,
			result.tenant.organization.id,
			result.tenant.project.id
		);
		await logAuditEvent({
			actorId: result.user.id,
			orgId: result.tenant.organization.id,
			projectId: result.tenant.project.id,
			action: 'signup.completed',
			resourceType: 'organization',
			resourceId: result.tenant.organization.id,
			metadata: { email: result.user.email }
		});
		return json({
			user: result.user,
			organization: result.tenant.organization,
			project: result.tenant.project,
			membership: result.tenant.membership,
			entitlements: result.tenant.entitlements
		}, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to create workspace.';
		return json({ error: message }, { status: 400 });
	}
};
