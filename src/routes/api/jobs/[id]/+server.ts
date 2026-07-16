import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCloudJob } from '$lib/server/cloud-jobs';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	const job = await getCloudJob({ orgId: locals.organization.id, jobId: params.id });
	if (!job) return json({ error: 'Job not found.' }, { status: 404 });
	return json({ job });
};
