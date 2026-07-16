import { query } from './db.js';
import type { Entitlements } from './tenancy.js';

async function countRows(sql: string, params: unknown[]): Promise<number> {
	try {
		const rows = await query<{ count: string }>(sql, params);
		return Number(rows[0]?.count ?? 0);
	} catch {
		return 0;
	}
}

export interface UsageSummary {
	plan: Entitlements['plan'];
	limits: Entitlements;
	usage: {
		projects: number;
		externalConnections: number;
		publishedShares: number;
		scheduledJobs: number;
		apiKeys: number;
		activeJobs: number;
		aiTokens: number;
		storageMb: number;
	};
}

export async function getUsageSummary(input: {
	orgId: string;
	projectId: string;
	entitlements: Entitlements;
}): Promise<UsageSummary> {
	const [projects, externalConnections, publishedShares, scheduledJobs, apiKeys, activeJobs] =
		await Promise.all([
			countRows(
				`SELECT COUNT(*)::text AS count FROM projects WHERE org_id = $1 AND archived_at IS NULL`,
				[input.orgId]
			),
			countRows(`SELECT COUNT(*)::text AS count FROM connections WHERE org_id = $1`, [input.orgId]),
			countRows(
				`SELECT COUNT(*)::text AS count FROM shared_reports WHERE org_id = $1 AND revoked = FALSE`,
				[input.orgId]
			),
			countRows(
				`SELECT COUNT(*)::text AS count
			 FROM share_refresh_schedules s
			 JOIN shared_reports r ON r.notebook_id = s.notebook_id
			 WHERE r.org_id = $1 AND s.enabled = TRUE`,
				[input.orgId]
			),
			countRows(
				`SELECT COUNT(*)::text AS count FROM "apiKey" WHERE "orgId" = $1 AND "revokedAt" IS NULL`,
				[input.orgId]
			),
			countRows(
				`SELECT COUNT(*)::text AS count
			 FROM cloud_jobs
			 WHERE org_id = $1 AND status IN ('queued', 'running')`,
				[input.orgId]
			)
		]);

	return {
		plan: input.entitlements.plan,
		limits: input.entitlements,
		usage: {
			projects,
			externalConnections,
			publishedShares,
			scheduledJobs,
			apiKeys,
			activeJobs,
			aiTokens: 0,
			storageMb: 0
		}
	};
}
