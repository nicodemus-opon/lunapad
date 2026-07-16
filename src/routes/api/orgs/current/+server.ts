import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization || !locals.project || !locals.membership) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return json({
		organization: locals.organization,
		project: locals.project,
		membership: locals.membership,
		entitlements: locals.entitlements
	});
};
