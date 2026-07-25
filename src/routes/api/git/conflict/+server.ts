import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { getGitConflictContent, gitResolveConflict } from '$lib/server/git-runner';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		const filePath = url.searchParams.get('path');
		if (!requestedFolder || !filePath)
			return json({ error: 'folder and path are required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		const content = await getGitConflictContent(folder, filePath);
		return json(content);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const {
			folder: requestedFolder,
			path: filePath,
			resolution
		} = (await request.json()) as {
			folder?: string;
			path?: string;
			resolution?: 'ours' | 'theirs';
		};
		if (!requestedFolder || !filePath || !resolution)
			return json({ error: 'folder, path, and resolution are required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		await gitResolveConflict(folder, filePath, resolution);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
