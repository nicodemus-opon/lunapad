import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { finishCloudJob, type CloudJobStatus } from '$lib/server/cloud-jobs';
import { requireCloudWorkerAuth } from '$lib/server/cloud-worker-auth';
import { finishPayloadShape, isFinalCloudJobStatus } from '$lib/server/cloud-job-finish';

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
		// Echo the (safe) diagnostics back so the worker log — the only log always
		// visible in Coolify — captures them too. Never echo payload data.
		return json(
			{ error: 'A valid final status is required.', reason: 'invalid_json', chars: raw.length },
			{ status: 400 }
		);
	}
	if (!isFinalCloudJobStatus(body.status)) {
		// Log the shape (never the result payload) — a previous incident showed the
		// worker sending finish requests the endpoint rejected while the worker
		// believed it sent status 'succeeded'. Keys + types pinpoint field renames,
		// proxy rewrites, or truncated bodies without leaking row data. The same
		// diagnostics go back in the 400 body so the worker log captures them.
		const shape = finishPayloadShape(body as Record<string, unknown>);
		console.warn(
			`[jobs-finish] job ${params.id}: invalid status ${JSON.stringify(body.status)} ` +
				`(body ${raw.length} chars, keys ${JSON.stringify(shape)}).`
		);
		return json(
			{
				error: 'A valid final status is required.',
				reason: 'invalid_status',
				receivedStatus: body.status ?? null,
				keys: shape,
				chars: raw.length
			},
			{ status: 400 }
		);
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
