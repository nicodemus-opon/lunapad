import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadManifest } from '$lib/server/dbt';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const folder = url.searchParams.get('folder');
		if (!folder) return json({ error: 'folder is required' }, { status: 400 });
		const models = await loadManifest(folder);
		return json({ models });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
