import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getShareByToken, toPublicShareView } from '$lib/server/shared-reports';

export const load: PageServerLoad = async ({ params }) => {
	const share = await getShareByToken(params.token);
	if (!share || share.revoked) error(404, 'This report link is not available.');
	return { share: toPublicShareView(share) };
};
