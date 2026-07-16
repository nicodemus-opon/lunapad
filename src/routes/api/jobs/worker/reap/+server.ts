import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { failTimedOutCloudJobs } from '$lib/server/cloud-jobs';
import { requireCloudWorkerAuth } from '$lib/server/cloud-worker-auth';

export const POST: RequestHandler = async ({ request }) => {
	const denied = requireCloudWorkerAuth(request);
	if (denied) return denied;

	const body = (await request.json().catch(() => ({}))) as { orgId?: string; limit?: number };
	const jobs = await failTimedOutCloudJobs({ orgId: body.orgId, limit: body.limit });
	return json({ jobs });
};
