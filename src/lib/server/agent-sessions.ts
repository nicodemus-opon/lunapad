import { query } from './db.js';
import {
	DEFAULT_ORG_ID,
	DEFAULT_PROJECT_ID,
	ensureDefaultTenant,
	type TenantRef
} from './tenancy.js';

let tableReady: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
	await ensureDefaultTenant();
	await query(`
		CREATE TABLE IF NOT EXISTS agent_sessions (
			id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			org_id        TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
			project_id    TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}',
			user_id       TEXT NOT NULL,
			status        TEXT NOT NULL DEFAULT 'active',
			mode          TEXT NOT NULL DEFAULT 'investigation',
			fsm_state     TEXT NOT NULL DEFAULT 'route',
			messages      JSONB NOT NULL DEFAULT '[]',
			metadata      JSONB,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await query(
		`ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
	);
	await query(
		`ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}'`
	);
	await query(
		`CREATE INDEX IF NOT EXISTS agent_sessions_user_id_idx ON agent_sessions (user_id, created_at DESC)`
	);
	await query(
		`CREATE INDEX IF NOT EXISTS agent_sessions_tenant_idx ON agent_sessions (org_id, project_id, created_at DESC)`
	);
}

function ensureOnce(): Promise<void> {
	if (!tableReady) tableReady = ensureTable();
	return tableReady;
}

export interface AgentSession {
	id: string;
	orgId: string;
	projectId: string;
	userId: string;
	status: 'active' | 'completed' | 'failed' | 'cancelled';
	mode: 'investigation' | 'full';
	fsmState: string;
	messages: unknown[];
	metadata: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
}

export async function createAgentSession(input: {
	tenant?: TenantRef | null;
	userId: string;
	mode?: 'investigation' | 'full';
	prompt?: string;
	metadata?: Record<string, unknown>;
}): Promise<AgentSession> {
	await ensureOnce();
	const rows = await query<{
		id: string;
		org_id: string;
		project_id: string;
		user_id: string;
		status: string;
		mode: string;
		fsm_state: string;
		messages: unknown[];
		metadata: Record<string, unknown> | null;
		created_at: string;
		updated_at: string;
	}>(
		`INSERT INTO agent_sessions (org_id, project_id, user_id, mode, messages, metadata)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, org_id, project_id, user_id, status, mode, fsm_state, messages, metadata, created_at, updated_at`,
		[
			input.tenant?.orgId ?? DEFAULT_ORG_ID,
			input.tenant?.projectId ?? DEFAULT_PROJECT_ID,
			input.userId,
			input.mode ?? 'investigation',
			JSON.stringify(input.prompt ? [{ role: 'user', content: input.prompt, at: Date.now() }] : []),
			input.metadata ? JSON.stringify(input.metadata) : null
		]
	);
	return mapRow(rows[0]);
}

export async function getAgentSession(
	id: string,
	userId: string,
	tenant?: TenantRef | null
): Promise<AgentSession | null> {
	await ensureOnce();
	const rows = await query<{
		id: string;
		org_id: string;
		project_id: string;
		user_id: string;
		status: string;
		mode: string;
		fsm_state: string;
		messages: unknown[];
		metadata: Record<string, unknown> | null;
		created_at: string;
		updated_at: string;
	}>(
		`SELECT id, org_id, project_id, user_id, status, mode, fsm_state, messages, metadata, created_at, updated_at
		 FROM agent_sessions
		 WHERE id = $1 AND user_id = $2 AND org_id = $3 AND project_id = $4`,
		[id, userId, tenant?.orgId ?? DEFAULT_ORG_ID, tenant?.projectId ?? DEFAULT_PROJECT_ID]
	);
	return rows[0] ? mapRow(rows[0]) : null;
}

export async function updateAgentSession(
	id: string,
	patch: Partial<{
		status: AgentSession['status'];
		fsmState: string;
		messages: unknown[];
		metadata: Record<string, unknown>;
	}>
): Promise<void> {
	await ensureOnce();
	const sets: string[] = ['updated_at = now()'];
	const vals: unknown[] = [];
	let i = 1;
	if (patch.status) {
		sets.push(`status = $${i++}`);
		vals.push(patch.status);
	}
	if (patch.fsmState) {
		sets.push(`fsm_state = $${i++}`);
		vals.push(patch.fsmState);
	}
	if (patch.messages) {
		sets.push(`messages = $${i++}`);
		vals.push(JSON.stringify(patch.messages));
	}
	if (patch.metadata) {
		sets.push(`metadata = $${i++}`);
		vals.push(JSON.stringify(patch.metadata));
	}
	vals.push(id);
	await query(`UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

/** Pending client-side tool execution (browser bridge). */
const pendingBridge = new Map<
	string,
	{ resolve: (r: unknown) => void; reject: (e: Error) => void; expires: number }
>();

export function registerBridgeWait(sessionId: string, toolCallId: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const key = `${sessionId}:${toolCallId}`;
		pendingBridge.set(key, { resolve, reject, expires: Date.now() + 60_000 });
	});
}

export function completeBridgeWait(
	sessionId: string,
	toolCallId: string,
	result: unknown
): boolean {
	const key = `${sessionId}:${toolCallId}`;
	const pending = pendingBridge.get(key);
	if (!pending) return false;
	pending.resolve(result);
	pendingBridge.delete(key);
	return true;
}

function mapRow(r: {
	id: string;
	org_id: string;
	project_id: string;
	user_id: string;
	status: string;
	mode: string;
	fsm_state: string;
	messages: unknown[];
	metadata: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
}): AgentSession {
	return {
		id: r.id,
		orgId: r.org_id ?? DEFAULT_ORG_ID,
		projectId: r.project_id ?? DEFAULT_PROJECT_ID,
		userId: r.user_id,
		status: r.status as AgentSession['status'],
		mode: r.mode as AgentSession['mode'],
		fsmState: r.fsm_state,
		messages: r.messages,
		metadata: r.metadata,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	};
}
