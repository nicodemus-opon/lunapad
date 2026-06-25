import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getShareByTokenOrSlug, toPublicShareView } from '$lib/server/shared-reports';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const share = await getShareByTokenOrSlug(params.token);
	if (!share || share.revoked) error(404, 'This report link is not available.');
	if (share.requireAuth && !locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	return { share: toPublicShareView(share) };
};
