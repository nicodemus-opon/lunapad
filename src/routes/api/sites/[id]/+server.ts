import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSite, getSiteById, listSitePages, updateSite } from '$lib/server/sites';

export const GET: RequestHandler = async ({ params }) => {
	const site = await getSiteById(params.id);
	if (!site) return json({ error: 'Site not found.' }, { status: 404 });
	const pages = await listSitePages(params.id);
	return json({ site, pages });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json()) as Partial<{
		slug: string;
		name: string;
		requireAuth: boolean;
	}>;
	try {
		const site = await updateSite(params.id, body);
		return json({ site });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update site.';
		return json({ error: message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	await deleteSite(params.id);
	return json({ ok: true });
};
