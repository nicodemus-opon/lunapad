import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { getGitStashList, gitStashSave } from '$lib/server/git-runner';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		const stashes = await getGitStashList(folder);
		return json({ stashes });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const {
			folder: requestedFolder,
			message,
			includeUntracked
		} = (await request.json()) as {
			folder?: string;
			message?: string;
			includeUntracked?: boolean;
		};
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		await gitStashSave(folder, message, includeUntracked ?? false);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
