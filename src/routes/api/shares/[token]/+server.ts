import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShareByToken, toPublicShareView } from '$lib/server/shared-reports';
import { hasOrganizationMembership } from '$lib/server/tenancy';

// Public, unauthenticated — toPublicShareView() redacts sqlTemplate/connection/secret.
export const GET: RequestHandler = async ({ params, locals }) => {
	const share = await getShareByToken(params.token);
	if (!share || share.revoked) return json({ error: 'Not found' }, { status: 404 });
	if (share.requireAuth) {
		if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
		const allowed = await hasOrganizationMembership(share.orgId, locals.user.id);
		if (!allowed) return json({ error: 'Forbidden' }, { status: 403 });
	}
	return json(toPublicShareView(share));
};
