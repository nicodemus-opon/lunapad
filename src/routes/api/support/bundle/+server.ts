import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import { buildSupportBundle } from '$lib/server/support-bundle';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization || !locals.project || !locals.entitlements) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const bundle = await buildSupportBundle({
		requestId: locals.requestId,
		user: locals.user,
		organization: locals.organization,
		project: locals.project,
		entitlements: locals.entitlements
	});
	return json(bundle);
};
