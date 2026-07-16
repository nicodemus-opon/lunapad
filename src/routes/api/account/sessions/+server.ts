import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listAccountSessions,
	revokeAccountSessions
} from '$lib/server/account-lifecycle';
import { logAuditEvent } from '$lib/server/audit';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const sessions = await listAccountSessions({
		userId: locals.user.id,
		currentSessionId: locals.session?.id
	});
	return json({ sessions });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const keepCurrent = url.searchParams.get('keepCurrent') !== '0';
	const revoked = await revokeAccountSessions({
		userId: locals.user.id,
		keepSessionId: keepCurrent ? locals.session?.id : null
	});
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization?.id,
		projectId: locals.project?.id,
		action: 'account.sessions.revoked',
		resourceType: 'account',
		resourceId: locals.user.id,
		requestId: locals.requestId,
		metadata: { revoked, keepCurrent }
	});
	return json({ revoked });
};
