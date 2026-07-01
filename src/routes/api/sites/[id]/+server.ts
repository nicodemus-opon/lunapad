import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSite, getSiteById, listSitePages, updateSite } from '$lib/server/sites';
import { requireSitesManage } from '$lib/server/share-guards';

export const GET: RequestHandler = async ({ params, locals }) => {
	const denied = requireSitesManage(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const site = await getSiteById(params.id);
	if (!site) return json({ error: 'Site not found.' }, { status: 404 });
	const pages = await listSitePages(params.id);
	return json({ site, pages });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const denied = requireSitesManage(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const body = (await request.json()) as Partial<{
		slug: string;
		name: string;
		requireAuth: boolean;
		logoUrl: string | null;
		accentColor: string | null;
		showFooter: boolean;
		homePageId: number | null;
	}>;
	try {
		const site = await updateSite(params.id, body);
		return json({ site });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update site.';
		return json({ error: message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const denied = requireSitesManage(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	await deleteSite(params.id);
	return json({ ok: true });
};
