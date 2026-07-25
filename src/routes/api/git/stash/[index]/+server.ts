import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { gitStashApply, gitStashPop, gitStashDrop } from '$lib/server/git-runner';

export const POST: RequestHandler = async ({ request, params, locals }) => {
	try {
		const index = parseInt(params.index, 10);
		if (Number.isNaN(index)) return json({ error: 'invalid stash index' }, { status: 400 });
		const { folder: requestedFolder, action } = (await request.json()) as {
			folder?: string;
			action?: 'apply' | 'pop';
		};
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		if (action === 'apply') await gitStashApply(folder, index);
		else await gitStashPop(folder, index);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	try {
		const index = parseInt(params.index, 10);
		if (Number.isNaN(index)) return json({ error: 'invalid stash index' }, { status: 400 });
		const requestedFolder = url.searchParams.get('folder');
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		await gitStashDrop(folder, index);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
