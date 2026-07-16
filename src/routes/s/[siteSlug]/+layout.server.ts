import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getSiteWithPages } from '$lib/server/sites';
import { hasOrganizationMembership } from '$lib/server/tenancy';

export const load: LayoutServerLoad = async ({ params, locals, url }) => {
	const site = await getSiteWithPages(params.siteSlug);
	if (!site) error(404, 'This site is not available.');
	if (site.requireAuth && !locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	if (site.requireAuth && locals.user) {
		const allowed = await hasOrganizationMembership(site.orgId, locals.user.id);
		if (!allowed) error(403, 'This site is private.');
	}

	const activePages = site.pages.filter((p) => !p.revoked);
	const homeFromId = site.homePageId
		? activePages.find((p) => p.id === site.homePageId)
		: undefined;
	const homePage = homeFromId ?? activePages.at(0) ?? null;

	return {
		site: {
			slug: site.slug,
			name: site.name,
			logoUrl: site.logoUrl,
			accentColor: site.accentColor,
			showFooter: site.showFooter,
			homePageSlug: homePage?.pageSlug ?? null,
			pages: activePages.map((p) => ({
				pageSlug: p.pageSlug,
				navLabel: p.navLabel,
				revoked: p.revoked,
				notebookName: p.notebookName
			}))
		},
		currentPageSlug: url.pathname.split('/').pop() ?? null
	};
};
