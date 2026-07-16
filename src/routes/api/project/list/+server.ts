import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { walkProjectDirectory } from '$lib/server/project';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const folder = url.searchParams.get('folder');
		if (!folder) return json({ error: 'folder is required' }, { status: 400 });
		const result = await walkProjectDirectory(assertTenantProjectFolder(locals, folder));
		return json(result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
