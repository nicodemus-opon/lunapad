import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSiteWithPages } from '$lib/server/sites';
import { getShareByToken, toPublicShareView } from '$lib/server/shared-reports';

export const load: PageServerLoad = async ({ params }) => {
	const site = await getSiteWithPages(params.siteSlug);
	if (!site) error(404, 'This site is not available.');

	const page = site.pages.find((p) => p.pageSlug === params.pageSlug);
	if (!page || page.revoked) error(404, 'This page is not available.');

	const share = await getShareByToken(page.shareToken);
	if (!share || share.revoked) error(404, 'This page is not available.');

	return { share: toPublicShareView(share) };
};
