import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendCloudJobLogs } from '$lib/server/cloud-jobs';
import { requireCloudWorkerAuth } from '$lib/server/cloud-worker-auth';

export const POST: RequestHandler = async ({ params, request }) => {
	const denied = requireCloudWorkerAuth(request);
	if (denied) return denied;

	const body = (await request.json().catch(() => ({}))) as {
		orgId?: string;
		workerId?: string;
		message?: string;
	};
	if (typeof body.message !== 'string') {
		return json({ error: 'message is required.' }, { status: 400 });
	}
	const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
	if (!workerId) return json({ error: 'workerId is required.' }, { status: 400 });
	const job = await appendCloudJobLogs({
		orgId: body.orgId,
		jobId: params.id,
		workerId,
		message: body.message
	});
	if (!job) return json({ error: 'Job not found or not running for this worker.' }, { status: 404 });
	return json({ job });
};
