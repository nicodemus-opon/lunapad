import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEvidencePages } from '$lib/server/evidence';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const GET: RequestHandler = async ({ url, locals }) => {
	const requestedFolder = url.searchParams.get('folder');
	if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
	try {
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		const pages = await listEvidencePages(folder);
		return json({ pages });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};
