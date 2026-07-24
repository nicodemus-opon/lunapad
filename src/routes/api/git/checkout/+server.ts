import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { gitCheckoutBranch } from '$lib/server/git-runner';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const {
			folder: requestedFolder,
			branch,
			create
		} = (await request.json()) as {
			folder?: string;
			branch?: string;
			create?: boolean;
		};
		if (!requestedFolder || !branch?.trim())
			return json({ error: 'folder and branch are required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		await gitCheckoutBranch(folder, branch, !!create);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
