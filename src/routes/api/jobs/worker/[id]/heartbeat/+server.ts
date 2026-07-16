import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { extendCloudJobLease } from '$lib/server/cloud-jobs';
import { requireCloudWorkerAuth } from '$lib/server/cloud-worker-auth';

export const POST: RequestHandler = async ({ params, request }) => {
	const denied = requireCloudWorkerAuth(request);
	if (denied) return denied;

	const body = (await request.json().catch(() => ({}))) as {
		orgId?: string;
		workerId?: string;
		leaseMs?: number;
	};
	const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
	if (!workerId) return json({ error: 'workerId is required.' }, { status: 400 });
	const job = await extendCloudJobLease({
		orgId: body.orgId,
		jobId: params.id,
		workerId,
		leaseMs: body.leaseMs
	});
	if (!job) return json({ error: 'Job not found or not running for this worker.' }, { status: 404 });
	return json({ job });
};
