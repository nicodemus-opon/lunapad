import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import { listCloudJobs } from '$lib/server/cloud-jobs';
import { listAuditEvents } from '$lib/server/audit';
import { getUsageSummary } from '$lib/server/usage';
import { getCloudExecutionAdapterHealth } from '$lib/server/cloud-execution';
import { getTenantRepairWarnings } from '$lib/server/tenancy';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization || !locals.project || !locals.entitlements) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const [jobs, auditEvents, usage, tenantWarnings] = await Promise.all([
		listCloudJobs({ orgId: locals.organization.id, projectId: null, limit: 50 }),
		listAuditEvents({ orgId: locals.organization.id, limit: 50 }),
		getUsageSummary({
			orgId: locals.organization.id,
			projectId: locals.project.id,
			entitlements: locals.entitlements
		}),
		getTenantRepairWarnings({
			activeOrgId: locals.organization.id,
			activeProjectId: locals.project.id
		})
	]);
	const executionAdapter = getCloudExecutionAdapterHealth();
	const activeJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'running');
	const staleJobs = activeJobs.filter((job) => {
		if (job.status !== 'running') return false;
		if (job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() < Date.now()) return true;
		if (job.startedAt) {
			return new Date(job.startedAt).getTime() + job.timeoutMs < Date.now();
		}
		return false;
	});

	return json({
		organization: locals.organization,
		project: locals.project,
		executionAdapter,
		usage,
		activeJobs,
		staleJobs,
		quotaPressure: {
			activeJobs: activeJobs.length,
			maxConcurrentJobs: locals.entitlements.maxConcurrentJobs,
			activeJobRatio: activeJobs.length / Math.max(locals.entitlements.maxConcurrentJobs, 1)
		},
		failedJobs: jobs.filter((job) => job.status === 'failed' || job.status === 'timed_out'),
		tenantWarnings,
		recentJobs: jobs,
		recentAuditEvents: auditEvents
	});
};
