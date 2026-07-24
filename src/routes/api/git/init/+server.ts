import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { isGitRepo, gitInitRepo } from '$lib/server/git-runner';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder: requestedFolder } = (await request.json()) as { folder?: string };
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		if (isGitRepo(folder)) return json({ error: 'Already a git repository' }, { status: 400 });

		await gitInitRepo(folder);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
