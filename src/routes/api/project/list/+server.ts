import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { walkProjectDirectory } from '$lib/server/project';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const folder = url.searchParams.get('folder');
		if (!folder) return json({ error: 'folder is required' }, { status: 400 });
		const result = await walkProjectDirectory(folder);
		return json(result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
