import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawnDbt } from '$lib/server/dbt-runner';
import { precompileProjectModels, collectProjectModelNames } from '$lib/server/prql-compiler';
import { getCloudExecutionAdapter } from '$lib/server/cloud-execution';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder } = (await request.json()) as { folder?: string };
		if (!folder) return json({ error: 'folder is required' }, { status: 400 });

		// Compile .prql → .sql so dbt-fusion can process them
		const knownModels = await collectProjectModelNames(folder);
		await precompileProjectModels(folder, knownModels);

		const execution = await getCloudExecutionAdapter().submit({
			tenant: { orgId: locals.organization!.id, projectId: locals.project?.id },
			userId: locals.user?.id,
			kind: 'dbt',
			timeoutMs: 300_000,
			quotaKey: 'dbt_compile',
			requestId: locals.requestId,
			entitlements: locals.entitlements,
			payload: { folder, args: ['compile'] },
			run: async () => ({ jobId: spawnDbt(['compile'], folder) })
		});
		if (execution.queued) return json({ job: execution.job }, { status: 202 });
		return json(execution.result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
