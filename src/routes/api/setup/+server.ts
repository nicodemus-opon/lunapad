import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { completeInitialSetup, getSetupStatus } from '$lib/server/onboarding';

export const GET: RequestHandler = async () => {
	const status = await getSetupStatus();
	return json({ ...status, needsSetup: status.mode !== 'closed' });
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		const body = (await request.json()) as {
			name?: string;
			email?: string;
			password?: string;
			workspaceName?: string;
			projectName?: string;
		};
		const result = await completeInitialSetup({
			name: typeof body.name === 'string' ? body.name : '',
			email: typeof body.email === 'string' ? body.email : '',
			password: typeof body.password === 'string' ? body.password : '',
			workspaceName: typeof body.workspaceName === 'string' ? body.workspaceName : '',
			projectName: typeof body.projectName === 'string' ? body.projectName : '',
			headers: request.headers
		});
		cookies.set('lunapad_org_id', result.tenant.organization.id, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			maxAge: 60 * 60 * 24 * 365
		});
		cookies.set('lunapad_project_id', result.tenant.project.id, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			maxAge: 60 * 60 * 24 * 365
		});
		return json({
			user: result.user,
			organization: result.tenant.organization,
			project: result.tenant.project
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to complete setup.';
		const status = message.includes('already complete') ? 403 : 400;
		return json({ error: message }, { status });
	}
};
