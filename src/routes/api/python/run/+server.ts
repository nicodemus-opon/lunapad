import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	spawnPythonCell,
	ensureProjectPinnedPackages,
	type PythonTable,
	type PythonTableDescriptor
} from '$lib/server/python-runner';
import { readPinnedPackages } from '$lib/server/python-packages';
import { getCloudExecutionAdapter } from '$lib/server/cloud-execution';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const {
			code,
			tables,
			tableDescriptors,
			notebookId,
			folder: requestedFolder
		} = (await request.json()) as {
			code?: string;
			tables?: Record<string, PythonTable>;
			tableDescriptors?: PythonTableDescriptor[];
			notebookId?: string;
			folder?: string;
		};
		if (typeof code !== 'string') return json({ error: 'code is required' }, { status: 400 });
		if (typeof notebookId !== 'string')
			return json({ error: 'notebookId is required' }, { status: 400 });

		const folder = requestedFolder ? assertTenantProjectFolder(locals, requestedFolder) : undefined;
		if (folder) {
			// One-time (per server process, per project) sync of any extras a
			// teammate already pinned for this project — cheap no-op on every
			// run after the first thanks to ensureProjectPinnedPackages' cache.
			const pins = await readPinnedPackages(folder);
			await ensureProjectPinnedPackages(folder, pins);
		}

		const execution = await getCloudExecutionAdapter().submit({
			tenant: { orgId: locals.organization!.id, projectId: locals.project?.id },
			userId: locals.user?.id,
			kind: 'python',
			timeoutMs: 120_000,
			quotaKey: 'python',
			requestId: locals.requestId,
			entitlements: locals.entitlements,
			payload: {
				notebookId,
				folder,
				code,
				tables: tables ?? {},
				tableDescriptors: tableDescriptors ?? []
			},
			run: async () => ({
				jobId: spawnPythonCell(notebookId, code, tables ?? {}, tableDescriptors ?? [])
			})
		});
		if (execution.queued)
			return json({ job: execution.job, jobId: execution.job.id }, { status: 202 });
		return json(execution.result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
