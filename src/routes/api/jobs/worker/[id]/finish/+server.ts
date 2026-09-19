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

	const raw = await request.text().catch(() => '');
	let body: {
		orgId?: string;
		workerId?: string;
		status?: CloudJobStatus;
		logs?: string | null;
		result?: unknown | null;
		resultPointer?: string | null;
		error?: string | null;
	} = {};
	try {
		body = raw ? (JSON.parse(raw) as typeof body) : {};
	} catch {
		console.warn(
			`[jobs-finish] job ${params.id}: body is not valid JSON (${raw.length} chars). ` +
				`Rejecting so the worker keeps the job rather than losing it silently.`
		);
		return json({ error: 'A valid final status is required.' }, { status: 400 });
	}
	if (!isFinalCloudJobStatus(body.status)) {
		// Log the shape (never the result payload) — a previous incident showed the
		// worker sending finish requests the endpoint rejected while the worker
		// believed it sent status 'succeeded'. Keys + types pinpoint field renames,
		// proxy rewrites, or truncated bodies without leaking row data.
		const shape = Object.fromEntries(
			Object.entries(body).map(([key, value]) => [key, Array.isArray(value) ? 'array' : typeof value])
		);
		console.warn(
			`[jobs-finish] job ${params.id}: invalid status ${JSON.stringify(body.status)} ` +
				`(body ${raw.length} chars, keys ${JSON.stringify(shape)}).`
		);
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
