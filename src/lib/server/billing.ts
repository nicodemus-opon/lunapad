import { query } from './db.js';
import {
	DEFAULT_ORG_ID,
	ensureDefaultTenant,
	type BillingProvider,
	type OrganizationPlan
} from './tenancy.js';

let billingTablesReady: Promise<void> | null = null;

async function ensureBillingTables(): Promise<void> {
	await ensureDefaultTenant();
	await query(`
		CREATE TABLE IF NOT EXISTS organization_billing (
			org_id              TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
			provider            TEXT NOT NULL DEFAULT 'none',
			provider_customer_id TEXT,
			provider_subscription_id TEXT,
			plan                TEXT NOT NULL DEFAULT 'free',
			status              TEXT NOT NULL DEFAULT 'none',
			renews_at           TIMESTAMPTZ,
			updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await query(
		`INSERT INTO organization_billing (org_id, provider, plan, status)
		 VALUES ($1, 'none', 'team', 'none')
		 ON CONFLICT (org_id) DO NOTHING`,
		[DEFAULT_ORG_ID]
	);
}

export function ensureBillingTablesOnce(): Promise<void> {
	if (!billingTablesReady) billingTablesReady = ensureBillingTables();
	return billingTablesReady;
}

export interface BillingRecord {
	orgId: string;
	provider: BillingProvider;
	plan: OrganizationPlan;
	status: string;
	renewsAt: string | null;
}

export async function getBillingRecord(orgId = DEFAULT_ORG_ID): Promise<BillingRecord | null> {
	await ensureBillingTablesOnce();
	const rows = await query<{
		org_id: string;
		provider: string;
		plan: string;
		status: string;
		renews_at: string | null;
	}>(
		`SELECT org_id, provider, plan, status, renews_at
		 FROM organization_billing
		 WHERE org_id = $1`,
		[orgId]
	);
	const row = rows[0];
	if (!row) return null;
	return {
		orgId: row.org_id,
		provider: row.provider as BillingProvider,
		plan: row.plan as OrganizationPlan,
		status: row.status,
		renewsAt: row.renews_at
	};
}

export async function setManualBillingPlan(input: {
	orgId: string;
	plan: OrganizationPlan;
	status?: string;
	renewsAt?: string | null;
}): Promise<void> {
	await ensureBillingTablesOnce();
	await query(
		`INSERT INTO organization_billing (org_id, provider, plan, status, renews_at, updated_at)
		 VALUES ($1, 'manual', $2, $3, $4, now())
		 ON CONFLICT (org_id) DO UPDATE
		 SET provider = 'manual', plan = EXCLUDED.plan, status = EXCLUDED.status,
		     renews_at = EXCLUDED.renews_at, updated_at = now()`,
		[input.orgId, input.plan, input.status ?? 'active', input.renewsAt ?? null]
	);
	await query(`UPDATE organizations SET plan = $2, updated_at = now() WHERE id = $1`, [
		input.orgId,
		input.plan
	]);
}
