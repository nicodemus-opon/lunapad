import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteAccount, exportAccountData } from '$lib/server/account-lifecycle';
import { logAuditEvent } from '$lib/server/audit';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json(await exportAccountData(locals.user.id));
};

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization?.id,
		projectId: locals.project?.id,
		action: 'account.deleted',
		resourceType: 'account',
		resourceId: locals.user.id,
		requestId: locals.requestId
	});
	await deleteAccount(locals.user.id);
	return json({ ok: true });
};
