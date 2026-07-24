import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { isGitRepo, getGitBranches } from '$lib/server/git-runner';
import type { GitBranches } from '$lib/types/git';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		if (!isGitRepo(folder)) return json({ current: '', branches: [] } satisfies GitBranches);

		const result = await getGitBranches(folder);
		return json(result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
