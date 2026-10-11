import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getJob, killJob } from '$lib/server/dbt-runner';
import { cancelCloudJob } from '$lib/server/cloud-jobs';
import { logAuditEvent } from '$lib/server/audit';

/**
 * Cancel an in-flight dbt job.
 *
 * Two id spaces can arrive here. Inline jobs live in the dbt-runner's in-process
 * map and need a SIGTERM; queued jobs are cloud_jobs rows and already have their
 * own cooperative cancellation. We try the runner first and fall back to the
 * cloud row, since a queued job's id is meaningless to `getJob`.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	const jobId = params.jobId;

	const job = getJob(jobId);
	if (job) {
		if (job.done) return json({ error: 'Job already finished.' }, { status: 409 });
		killJob(jobId);
		return json({ ok: true, mode: 'inline' });
	}

	const cancelled = locals.organization
		? await cancelCloudJob({ orgId: locals.organization.id, jobId })
		: null;
	if (!cancelled) return json({ error: 'Job not found or already finished.' }, { status: 404 });

	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization.id,
		projectId: cancelled.projectId,
		action: 'job.cancelled',
		resourceType: 'cloud_job',
		resourceId: cancelled.id,
		jobId: cancelled.id
	});
	return json({ ok: true, mode: 'queue' });
};
