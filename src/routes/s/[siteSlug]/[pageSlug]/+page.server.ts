import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSitePageBySlugs } from '$lib/server/sites';
import { loadSharePage } from '$lib/server/share-page-load';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const resolved = await getSitePageBySlugs(params.siteSlug, params.pageSlug);
	if (!resolved) error(404, 'This page is not available.');

	if (resolved.site.requireAuth && !locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const pageData = await loadSharePage({
		identifier: resolved.page.shareToken,
		localsUser: locals.user,
		urlPath: url.pathname,
		urlSearch: url.search,
		requireAuth: resolved.site.requireAuth || undefined
	});

	return {
		...pageData,
		sitePage: { navLabel: resolved.page.navLabel, pageSlug: resolved.page.pageSlug },
		siteName: resolved.site.name
	};
};
