import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCloudWorkerAuth } from '$lib/server/cloud-worker-auth';
import { runClaimedCloudJob } from '$lib/server/cloud-job-runner';

export const POST: RequestHandler = async ({ params, request }) => {
	const denied = requireCloudWorkerAuth(request);
	if (denied) return denied;
	const body = (await request.json().catch(() => ({}))) as {
		orgId?: string;
		workerId?: string;
	};
	const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';
	const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
	if (!orgId) return json({ error: 'orgId is required.' }, { status: 400 });
	if (!workerId) return json({ error: 'workerId is required.' }, { status: 400 });
	try {
		const result = await runClaimedCloudJob({ orgId, jobId: params.id, workerId });
		return json({ result });
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : 'Failed to run job.' }, { status: 400 });
	}
};
