import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { site } = await parent();
	if (site.pages.length > 0) {
		redirect(303, `/s/${params.siteSlug}/${site.pages[0].pageSlug}`);
	}
	return {};
};
