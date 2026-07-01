import { query } from './db.js';

let auditTableReady: Promise<void> | null = null;

async function ensureAuditTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS audit_events (
			id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			actor_id      TEXT,
			action        TEXT NOT NULL,
			resource_type TEXT,
			resource_id   TEXT,
			metadata      JSONB,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await query(
		`CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC)`
	);
	await query(`CREATE INDEX IF NOT EXISTS audit_events_actor_id_idx ON audit_events (actor_id)`);
}

export function ensureAuditTableOnce(): Promise<void> {
	if (!auditTableReady) auditTableReady = ensureAuditTable();
	return auditTableReady;
}

export interface AuditEvent {
	id: string;
	actorId: string | null;
	action: string;
	resourceType: string | null;
	resourceId: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
	actorName?: string | null;
}

export async function logAuditEvent(input: {
	actorId?: string | null;
	action: string;
	resourceType?: string | null;
	resourceId?: string | null;
	metadata?: Record<string, unknown> | null;
}): Promise<void> {
	await ensureAuditTableOnce();
	await query(
		`INSERT INTO audit_events (actor_id, action, resource_type, resource_id, metadata)
		 VALUES ($1, $2, $3, $4, $5)`,
		[
			input.actorId ?? null,
			input.action,
			input.resourceType ?? null,
			input.resourceId ?? null,
			input.metadata ? JSON.stringify(input.metadata) : null
		]
	);
}

export async function listAuditEvents(opts: {
	limit?: number;
	offset?: number;
}): Promise<AuditEvent[]> {
	await ensureAuditTableOnce();
	const limit = Math.min(opts.limit ?? 50, 200);
	const offset = opts.offset ?? 0;
	const rows = await query<{
		id: string;
		actor_id: string | null;
		action: string;
		resource_type: string | null;
		resource_id: string | null;
		metadata: Record<string, unknown> | null;
		created_at: string;
		actor_name: string | null;
	}>(
		`SELECT e.id, e.actor_id, e.action, e.resource_type, e.resource_id, e.metadata, e.created_at,
		        u.name AS actor_name
		 FROM audit_events e
		 LEFT JOIN "user" u ON u.id = e.actor_id
		 ORDER BY e.created_at DESC
		 LIMIT $1 OFFSET $2`,
		[limit, offset]
	);
	return rows.map((r) => ({
		id: r.id,
		actorId: r.actor_id,
		action: r.action,
		resourceType: r.resource_type,
		resourceId: r.resource_id,
		metadata: r.metadata,
		createdAt: r.created_at,
		actorName: r.actor_name
	}));
}
