import { query } from './db.js';
import { DEFAULT_ORG_ID, DEFAULT_PROJECT_ID, ensureDefaultTenant } from './tenancy.js';

let auditTableReady: Promise<void> | null = null;

async function ensureAuditTable(): Promise<void> {
	await ensureDefaultTenant();
	await query(`
		CREATE TABLE IF NOT EXISTS audit_events (
			id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
			project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
			actor_id      TEXT,
			action        TEXT NOT NULL,
			resource_type TEXT,
			resource_id   TEXT,
			request_id    TEXT,
			job_id        TEXT,
			metadata      JSONB,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await query(`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS org_id TEXT`);
	await query(`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS project_id TEXT`);
	await query(`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_id TEXT`);
	await query(`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS job_id TEXT`);
	await query(`UPDATE audit_events SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG_ID]);
	await query(
		`CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC)`
	);
	await query(
		`CREATE INDEX IF NOT EXISTS audit_events_org_created_idx ON audit_events (org_id, created_at DESC)`
	);
	await query(`CREATE INDEX IF NOT EXISTS audit_events_actor_id_idx ON audit_events (actor_id)`);
}

export function ensureAuditTableOnce(): Promise<void> {
	if (!auditTableReady) auditTableReady = ensureAuditTable();
	return auditTableReady;
}

export interface AuditEvent {
	id: string;
	orgId: string | null;
	projectId: string | null;
	actorId: string | null;
	action: string;
	resourceType: string | null;
	resourceId: string | null;
	requestId: string | null;
	jobId: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
	actorName?: string | null;
}

export async function logAuditEvent(input: {
	actorId?: string | null;
	orgId?: string | null;
	projectId?: string | null;
	action: string;
	resourceType?: string | null;
	resourceId?: string | null;
	requestId?: string | null;
	jobId?: string | null;
	metadata?: Record<string, unknown> | null;
}): Promise<void> {
	await ensureAuditTableOnce();
	await query(
		`INSERT INTO audit_events
		 (org_id, project_id, actor_id, action, resource_type, resource_id, request_id, job_id, metadata)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		[
			input.orgId ?? DEFAULT_ORG_ID,
			input.projectId ?? DEFAULT_PROJECT_ID,
			input.actorId ?? null,
			input.action,
			input.resourceType ?? null,
			input.resourceId ?? null,
			input.requestId ?? null,
			input.jobId ?? null,
			input.metadata ? JSON.stringify(input.metadata) : null
		]
	);
}

export async function listAuditEvents(opts: {
	limit?: number;
	offset?: number;
	orgId?: string | null;
}): Promise<AuditEvent[]> {
	await ensureAuditTableOnce();
	const limit = Math.min(opts.limit ?? 50, 200);
	const offset = opts.offset ?? 0;
	const orgId = opts.orgId ?? DEFAULT_ORG_ID;
	const rows = await query<{
		id: string;
		org_id: string | null;
		project_id: string | null;
		actor_id: string | null;
		action: string;
		resource_type: string | null;
		resource_id: string | null;
		request_id: string | null;
		job_id: string | null;
		metadata: Record<string, unknown> | null;
		created_at: string;
		actor_name: string | null;
	}>(
		`SELECT e.id, e.org_id, e.project_id, e.actor_id, e.action, e.resource_type,
		        e.resource_id, e.request_id, e.job_id, e.metadata, e.created_at,
		        u.name AS actor_name
		 FROM audit_events e
		 LEFT JOIN "user" u ON u.id = e.actor_id
		 WHERE e.org_id = $3
		 ORDER BY e.created_at DESC
		 LIMIT $1 OFFSET $2`,
		[limit, offset, orgId]
	);
	return rows.map((r) => ({
		id: r.id,
		orgId: r.org_id,
		projectId: r.project_id,
		actorId: r.actor_id,
		action: r.action,
		resourceType: r.resource_type,
		resourceId: r.resource_id,
		requestId: r.request_id,
		jobId: r.job_id,
		metadata: r.metadata,
		createdAt: r.created_at,
		actorName: r.actor_name
	}));
}
