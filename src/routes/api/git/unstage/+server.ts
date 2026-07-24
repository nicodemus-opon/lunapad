import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { gitRestoreStaged } from '$lib/server/git-runner';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder: requestedFolder, paths } = (await request.json()) as {
			folder?: string;
			paths?: string[];
		};
		if (!requestedFolder || !paths?.length)
			return json({ error: 'folder and paths are required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		await gitRestoreStaged(folder, paths);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
