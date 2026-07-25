import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { getGitFileContentAtRef } from '$lib/server/git-runner';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		const filePath = url.searchParams.get('path');
		const ref = url.searchParams.get('ref') ?? 'HEAD';
		if (!requestedFolder || !filePath)
			return json({ error: 'folder and path are required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		const content = await getGitFileContentAtRef(folder, filePath, ref);
		return json({ content });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
