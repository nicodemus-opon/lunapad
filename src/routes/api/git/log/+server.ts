import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { isGitRepo, getGitLog } from '$lib/server/git-runner';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const filePath = url.searchParams.get('path') ?? undefined;
		const limit = Number(url.searchParams.get('limit') ?? '20');
		const { folder } = resolveGitTenant(locals, requestedFolder);

		if (!isGitRepo(folder)) return json({ commits: [] });

		const commits = await getGitLog(folder, {
			filePath,
			maxCount: Math.max(1, Math.min(200, limit))
		});
		return json({ commits });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
