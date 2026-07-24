import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { gitCommitChanges } from '$lib/server/git-runner';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder: requestedFolder, message } = (await request.json()) as {
			folder?: string;
			message?: string;
		};
		if (!requestedFolder || !message?.trim())
			return json({ error: 'folder and message are required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		const hash = await gitCommitChanges(folder, message);
		return json({ ok: true, hash });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
