import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSite, listSites } from '$lib/server/sites';
import { requireSitesManage } from '$lib/server/share-guards';

export const GET: RequestHandler = async ({ locals }) => {
	const denied = requireSitesManage(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const sites = await listSites();
	return json({ sites });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const denied = requireSitesManage(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const body = (await request.json()) as Partial<{
		slug: string;
		name: string;
		requireAuth: boolean;
	}>;
	if (!body?.slug || !body?.name)
		return json({ error: 'slug and name are required.' }, { status: 400 });
	try {
		const site = await createSite({
			slug: body.slug,
			name: body.name,
			requireAuth: body.requireAuth
		});
		return json({ site });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to create site.';
		return json({ error: message }, { status: 400 });
	}
};
