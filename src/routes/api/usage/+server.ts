import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUsageSummary } from '$lib/server/usage';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization || !locals.project || !locals.entitlements) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const usage = await getUsageSummary({
		orgId: locals.organization.id,
		projectId: locals.project.id,
		entitlements: locals.entitlements
	});
	return json({ usage });
};
