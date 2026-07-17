import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { finishCloudJob, type CloudJobStatus } from '$lib/server/cloud-jobs';
import { requireCloudWorkerAuth } from '$lib/server/cloud-worker-auth';

type FinalCloudJobStatus = Extract<
	CloudJobStatus,
	'succeeded' | 'failed' | 'timed_out' | 'cancelled'
>;

const finalStatuses = new Set<FinalCloudJobStatus>([
	'succeeded',
	'failed',
	'timed_out',
	'cancelled'
]);

function isFinalCloudJobStatus(status: CloudJobStatus | undefined): status is FinalCloudJobStatus {
	return Boolean(status && finalStatuses.has(status as FinalCloudJobStatus));
}

export const POST: RequestHandler = async ({ params, request }) => {
	const denied = requireCloudWorkerAuth(request);
	if (denied) return denied;

	const body = (await request.json().catch(() => ({}))) as {
		orgId?: string;
		workerId?: string;
		status?: CloudJobStatus;
		logs?: string | null;
		result?: unknown | null;
		resultPointer?: string | null;
		error?: string | null;
	};
	if (!isFinalCloudJobStatus(body.status)) {
		return json({ error: 'A valid final status is required.' }, { status: 400 });
	}
	const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
	if (!workerId) return json({ error: 'workerId is required.' }, { status: 400 });
	const job = await finishCloudJob({
		orgId: body.orgId,
		jobId: params.id,
		workerId,
		status: body.status,
		logs: body.logs,
		result: body.result,
		resultPointer: body.resultPointer,
		error: body.error
	});
	if (!job)
		return json(
			{ error: 'Job not found, already finished, or not owned by this worker.' },
			{ status: 404 }
		);
	return json({ job });
};
