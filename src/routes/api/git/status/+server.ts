import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant, resolveGitCredential } from '$lib/server/git-tenant';
import { isGitRepo, getGitStatus, hasGitRemote } from '$lib/server/git-runner';
import type { GitStatus } from '$lib/types/git';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const ctx = resolveGitTenant(locals, requestedFolder);

		if (!isGitRepo(ctx.folder)) {
			const status: GitStatus = {
				isRepo: false,
				branch: null,
				ahead: 0,
				behind: 0,
				staged: [],
				unstaged: [],
				untracked: [],
				conflicted: [],
				hasRemote: false
			};
			return json(status);
		}

		const credential = await resolveGitCredential(ctx);
		const [parsed, remote] = await Promise.all([
			getGitStatus(ctx.folder, credential),
			hasGitRemote(ctx.folder)
		]);
		const status: GitStatus = { isRepo: true, ...parsed, hasRemote: remote };
		return json(status);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
