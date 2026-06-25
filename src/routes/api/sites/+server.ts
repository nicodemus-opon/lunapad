import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSite, listSites } from '$lib/server/sites';

export const GET: RequestHandler = async () => {
	const sites = await listSites();
	return json({ sites });
};

export const POST: RequestHandler = async ({ request }) => {
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
