import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	confirmEmailVerification,
	requestEmailVerification
} from '$lib/server/account-lifecycle';
import { logAuditEvent } from '$lib/server/audit';
import { redirect } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const token = url.searchParams.get('token')?.trim();
	if (!token) throw redirect(303, '/login?verified=missing');
	try {
		await confirmEmailVerification(token);
	} catch {
		throw redirect(303, '/login?verified=failed');
	}
	throw redirect(303, '/login?verified=1');
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { token?: string };
	const token = typeof body.token === 'string' ? body.token.trim() : '';
	if (token) {
		try {
			await confirmEmailVerification(token);
			await logAuditEvent({
				actorId: locals.user.id,
				orgId: locals.organization?.id,
				projectId: locals.project?.id,
				action: 'account.email.verified',
				resourceType: 'account',
				resourceId: locals.user.id,
				requestId: locals.requestId
			});
			return json({ ok: true, verified: true });
		} catch (err) {
			return json({ error: err instanceof Error ? err.message : 'Email verification failed.' }, { status: 400 });
		}
	}
	const result = await requestEmailVerification({
		userId: locals.user.id,
		email: locals.user.email ?? ''
	});
	return json(result);
};
