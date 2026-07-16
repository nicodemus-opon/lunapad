import { listAuditEvents } from './audit.js';
import { listCloudJobs } from './cloud-jobs.js';
import { listConnectionsMetadata } from './connections-store.js';
import { getCloudExecutionAdapterHealth } from './cloud-execution.js';
import { getTenantRepairWarnings, type Entitlements, type Organization, type Project } from './tenancy.js';
import { getUsageSummary } from './usage.js';

function redactConnection(connection: Record<string, unknown>): Record<string, unknown> {
	const redacted: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(connection)) {
		if (/password|secret|token|credential|key/i.test(key)) redacted[key] = '[redacted]';
		else redacted[key] = value;
	}
	return redacted;
}

export async function buildSupportBundle(input: {
	requestId?: string | null;
	user: { id: string; email?: string | null; role?: string | null };
	organization: Organization;
	project: Project;
	entitlements: Entitlements;
}): Promise<Record<string, unknown>> {
	const [usage, jobs, auditEvents, connections, tenantWarnings] = await Promise.all([
		getUsageSummary({
			orgId: input.organization.id,
			projectId: input.project.id,
			entitlements: input.entitlements
		}),
		listCloudJobs({ orgId: input.organization.id, projectId: null, limit: 25 }),
		listAuditEvents({ orgId: input.organization.id, limit: 25 }),
		listConnectionsMetadata(input.organization.id, { includePhysicalCatalogName: true }).catch(() => []),
		getTenantRepairWarnings({
			activeOrgId: input.organization.id,
			activeProjectId: input.project.id
		})
	]);
	return {
		generatedAt: new Date().toISOString(),
		requestId: input.requestId ?? null,
		user: {
			id: input.user.id,
			email: input.user.email ?? null,
			role: input.user.role ?? null
		},
		organization: input.organization,
		project: input.project,
		executionAdapter: getCloudExecutionAdapterHealth(),
		usage,
		tenantWarnings,
		recentJobs: jobs.map((job) => ({
			id: job.id,
			kind: job.kind,
			status: job.status,
			error: job.error,
			workerId: job.workerId,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
			finishedAt: job.finishedAt
		})),
		recentAuditEvents: auditEvents,
		connections: connections.map((connection) =>
			redactConnection(connection as unknown as Record<string, unknown>)
		)
	};
}
