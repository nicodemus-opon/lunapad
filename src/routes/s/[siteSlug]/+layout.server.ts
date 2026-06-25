import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getSiteWithPages } from '$lib/server/sites';

export const load: LayoutServerLoad = async ({ params, locals, url }) => {
	const site = await getSiteWithPages(params.siteSlug);
	if (!site) error(404, 'This site is not available.');
	if (site.requireAuth && !locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	return {
		site: {
			slug: site.slug,
			name: site.name,
			pages: site.pages
				.filter((p) => !p.revoked)
				.map((p) => ({ pageSlug: p.pageSlug, navLabel: p.navLabel }))
		}
	};
};
