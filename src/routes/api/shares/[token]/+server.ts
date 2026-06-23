import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShareByToken, toPublicShareView } from '$lib/server/shared-reports';

// Public, unauthenticated — toPublicShareView() redacts sqlTemplate/connection/secret.
export const GET: RequestHandler = async ({ params }) => {
	const share = await getShareByToken(params.token);
	if (!share || share.revoked) return json({ error: 'Not found' }, { status: 404 });
	return json(toPublicShareView(share));
};
