import { query } from './db.js';
import { getUsageSummary } from './usage.js';
import type { Entitlements } from './tenancy.js';

export type OnboardingChecklistItemId =
	| 'create_project'
	| 'add_connection'
	| 'run_query'
	| 'invite_teammate'
	| 'publish_report';

export interface OnboardingChecklistItem {
	id: OnboardingChecklistItemId;
	label: string;
	description: string;
	done: boolean;
	dismissed: boolean;
	href: string;
}

let checklistTableReady: Promise<void> | null = null;

async function ensureOnboardingChecklistTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS onboarding_dismissals (
			org_id     TEXT NOT NULL,
			user_id    TEXT NOT NULL,
			item_id    TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (org_id, user_id, item_id)
		)
	`);
}

export function ensureOnboardingChecklistTableOnce(): Promise<void> {
	if (!checklistTableReady) checklistTableReady = ensureOnboardingChecklistTable();
	return checklistTableReady;
}

async function countRows(sql: string, params: unknown[]): Promise<number> {
	try {
		const rows = await query<{ count: string }>(sql, params);
		return Number(rows[0]?.count ?? 0);
	} catch {
		return 0;
	}
}

export async function getOnboardingChecklist(input: {
	tenant: { orgId: string; projectId: string };
	userId: string;
	entitlements: Entitlements;
}): Promise<{ items: OnboardingChecklistItem[]; completed: number; total: number }> {
	await ensureOnboardingChecklistTableOnce();
	const [usage, dismissedRows, queryRuns, invitedMembers] = await Promise.all([
		getUsageSummary({
			orgId: input.tenant.orgId,
			projectId: input.tenant.projectId,
			entitlements: input.entitlements
		}),
		query<{ item_id: string }>(
			`SELECT item_id FROM onboarding_dismissals WHERE org_id = $1 AND user_id = $2`,
			[input.tenant.orgId, input.userId]
		),
		countRows(
			`SELECT COUNT(*)::text AS count
			 FROM audit_events
			 WHERE org_id = $1 AND project_id = $2 AND action IN ('query.executed', 'connection.query')`,
			[input.tenant.orgId, input.tenant.projectId]
		),
		countRows(
			`SELECT COUNT(*)::text AS count FROM organization_members WHERE org_id = $1`,
			[input.tenant.orgId]
		)
	]);
	const dismissed = new Set(dismissedRows.map((row) => row.item_id));
	const item = (
		id: OnboardingChecklistItemId,
		label: string,
		description: string,
		done: boolean,
		href: string
	): OnboardingChecklistItem => ({
		id,
		label,
		description,
		done,
		dismissed: dismissed.has(id),
		href
	});
	const items = [
		item(
			'create_project',
			'Create a project',
			'Keep notebooks and dbt files grouped by workspace project.',
			usage.usage.projects > 1,
			'/settings/projects'
		),
		item(
			'add_connection',
			'Add a connection',
			'Connect a warehouse or database for shared team queries.',
			usage.usage.externalConnections > 0,
			'/settings/connections'
		),
		item(
			'run_query',
			'Run a query',
			'Verify this project can execute work and produce a result.',
			queryRuns > 0,
			'/'
		),
		item(
			'invite_teammate',
			'Invite a teammate',
			'Bring another person into this workspace with the right role.',
			invitedMembers > 1,
			'/settings/team'
		),
		item(
			'publish_report',
			'Publish a report',
			'Share a trustworthy output from the notebook.',
			usage.usage.publishedShares > 0,
			'/settings/usage'
		)
	];
	const visible = items.filter((entry) => !entry.dismissed);
	return {
		items,
		completed: visible.filter((entry) => entry.done).length,
		total: visible.length
	};
}

export async function dismissOnboardingChecklistItem(input: {
	orgId: string;
	userId: string;
	itemId: OnboardingChecklistItemId;
}): Promise<void> {
	await ensureOnboardingChecklistTableOnce();
	await query(
		`INSERT INTO onboarding_dismissals (org_id, user_id, item_id)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (org_id, user_id, item_id) DO NOTHING`,
		[input.orgId, input.userId, input.itemId]
	);
}
