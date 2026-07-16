import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listCloudJobs } from '$lib/server/cloud-jobs';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const jobs = await listCloudJobs({
		orgId: locals.organization.id,
		projectId: url.searchParams.get('allProjects') === '1' ? null : locals.project?.id,
		limit
	});
	return json({ jobs });
};
