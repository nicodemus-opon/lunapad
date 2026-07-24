import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant, resolveGitCredential } from '$lib/server/git-tenant';
import { spawnGitPush } from '$lib/server/git-runner';
import { getCloudExecutionAdapter } from '$lib/server/cloud-execution';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder: requestedFolder, force } = (await request.json()) as {
			folder?: string;
			force?: boolean;
		};
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const ctx = resolveGitTenant(locals, requestedFolder);
		const credential = await resolveGitCredential(ctx);

		const execution = await getCloudExecutionAdapter().submit({
			tenant: { orgId: locals.organization!.id, projectId: locals.project?.id },
			userId: locals.user?.id,
			kind: 'git',
			timeoutMs: 120_000,
			quotaKey: 'git_push',
			requestId: locals.requestId,
			entitlements: locals.entitlements,
			payload: { folder: ctx.folder, op: 'push', force: !!force },
			run: async () => ({ jobId: spawnGitPush(ctx.folder, credential, !!force) })
		});
		if (execution.queued) return json({ job: execution.job }, { status: 202 });
		return json(execution.result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
