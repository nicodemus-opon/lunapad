import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelCloudJob } from '$lib/server/cloud-jobs';
import { logAuditEvent } from '$lib/server/audit';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	const job = await cancelCloudJob({ orgId: locals.organization.id, jobId: params.id });
	if (!job) return json({ error: 'Job not found or already finished.' }, { status: 404 });
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization.id,
		projectId: job.projectId,
		action: 'job.cancelled',
		resourceType: 'cloud_job',
		resourceId: job.id,
		jobId: job.id
	});
	return json({ job });
};
