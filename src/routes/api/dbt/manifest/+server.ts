import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadManifest } from '$lib/server/dbt';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		const models = await loadManifest(folder);
		return json({ models });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
