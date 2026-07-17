import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { claimNextCloudJob, type CloudJobKind } from '$lib/server/cloud-jobs';
import { requireCloudWorkerAuth } from '$lib/server/cloud-worker-auth';
import { projectsRoot } from '$lib/server/tenancy';
import path from 'node:path';

const kinds = new Set<CloudJobKind>([
	'query',
	'dbt',
	'python',
	'ai',
	'share_refresh',
	'notebook_execution'
]);

function redactPayload(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactPayload);
	if (!value || typeof value !== 'object') return value;
	const out: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value)) {
		if (/secret|password|token|api[_-]?key|credential/i.test(key)) {
			out[key] = '[redacted]';
		} else {
			out[key] = redactPayload(nested);
		}
	}
	return out;
}

export const POST: RequestHandler = async ({ request, url }) => {
	const denied = requireCloudWorkerAuth(request);
	if (denied) return denied;

	const body = (await request.json().catch(() => ({}))) as {
		orgId?: string;
		kind?: string;
		workerId?: string;
		leaseMs?: number;
	};
	const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
	if (!workerId) return json({ error: 'workerId is required.' }, { status: 400 });
	const kind = body.kind && kinds.has(body.kind as CloudJobKind) ? (body.kind as CloudJobKind) : null;
	const lease = await claimNextCloudJob({
		orgId: body.orgId,
		kind,
		workerId,
		leaseMs: body.leaseMs
	});
	if (!lease) return json({ lease: null });
	const scratchPath = path.join(projectsRoot(), '.worker-scratch', lease.job.orgId, lease.job.id);
	return json({
		lease: {
			...lease,
			runner: {
				tenantScratchPath: scratchPath,
				timeoutMs: lease.job.timeoutMs,
				cancellationUrl: `${url.origin}/api/jobs/${lease.job.id}/cancel`,
				heartbeatUrl: `${url.origin}/api/jobs/worker/${lease.job.id}/heartbeat`,
				logsUrl: `${url.origin}/api/jobs/worker/${lease.job.id}/logs`,
				runUrl: `${url.origin}/api/jobs/worker/${lease.job.id}/run`,
				finishUrl: `${url.origin}/api/jobs/worker/${lease.job.id}/finish`,
				payload: redactPayload(lease.job.payload)
			}
		}
	});
};
