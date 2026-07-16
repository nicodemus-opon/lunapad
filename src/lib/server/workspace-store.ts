import { query } from './db.js';
import { DEFAULT_PROJECT_ID, ensureDefaultTenant } from './tenancy.js';

// Stores the whole shared-workspace blob (notebooks, cells, tabs, prefs, workspace
// standards) as a single JSONB row, so Postgres becomes the source of truth for the
// team's notebook content instead of each browser's localStorage. Single singleton
// row rather than per-notebook rows: notebook.svelte.ts's serialize()/deserialize()
// already work on one whole-workspace blob, and a single row makes last-write-wins
// trivially correct (one UPDATE, no cross-row partial-save states). Demo mode never
// calls into this module at all (see DEMO_BLOCKED_PREFIXES in hooks.server.ts).
let workspaceTableReady: Promise<void> | null = null;

async function ensureWorkspaceTable(): Promise<void> {
	await ensureDefaultTenant();
	await query(`
		CREATE TABLE IF NOT EXISTS workspace_state (
			id         TEXT PRIMARY KEY DEFAULT 'singleton',
			project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
			data       JSONB NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_by TEXT
		)
	`);
	await query(`ALTER TABLE workspace_state ADD COLUMN IF NOT EXISTS project_id TEXT`);
	await query(`UPDATE workspace_state SET project_id = $1 WHERE project_id IS NULL`, [
		DEFAULT_PROJECT_ID
	]);
	await query(
		`CREATE INDEX IF NOT EXISTS workspace_state_project_idx ON workspace_state (project_id)`
	);
}

function ensureWorkspaceTableOnce(): Promise<void> {
	if (!workspaceTableReady) workspaceTableReady = ensureWorkspaceTable();
	return workspaceTableReady;
}

export interface WorkspaceStateRow {
	data: unknown;
	updatedAt: string;
	updatedBy: string | null;
}

/** Resolve a stored user id to a human-readable label for workspace conflict UI. */
export async function resolveWorkspaceUpdatedBy(userId: string | null): Promise<string | null> {
	if (!userId) return null;
	const rows = await query<{ name: string; email: string }>(
		`SELECT name, email FROM "user" WHERE id = $1`,
		[userId]
	);
	const row = rows[0];
	if (!row) return null;
	return row.name || row.email || null;
}

export class WorkspaceConflictError extends Error {
	readonly updatedAt: string;
	readonly updatedBy: string | null;

	constructor(updatedAt: string, updatedBy: string | null) {
		super('Workspace was modified by another user');
		this.name = 'WorkspaceConflictError';
		this.updatedAt = updatedAt;
		this.updatedBy = updatedBy;
	}
}

export async function loadWorkspaceState(
	projectId = DEFAULT_PROJECT_ID
): Promise<WorkspaceStateRow | null> {
	await ensureWorkspaceTableOnce();
	const rows = await query<{
		data: unknown;
		updated_at: string;
		updated_by: string | null;
	}>(
		`SELECT data, updated_at, updated_by
		 FROM workspace_state
		 WHERE project_id = $1 OR (project_id IS NULL AND id = 'singleton')
		 ORDER BY CASE WHEN project_id = $1 THEN 0 ELSE 1 END
		 LIMIT 1`,
		[projectId]
	);
	return rows[0]
		? { data: rows[0].data, updatedAt: rows[0].updated_at, updatedBy: rows[0].updated_by }
		: null;
}

export async function saveWorkspaceState(
	data: unknown,
	userId: string | null,
	opts?: { expectedUpdatedAt?: string | null; force?: boolean; projectId?: string }
): Promise<WorkspaceStateRow> {
	await ensureWorkspaceTableOnce();
	const projectId = opts?.projectId ?? DEFAULT_PROJECT_ID;

	if (opts?.expectedUpdatedAt && !opts.force) {
		const current = await loadWorkspaceState(projectId);
		if (
			current &&
			new Date(current.updatedAt).getTime() !== new Date(opts.expectedUpdatedAt).getTime()
		) {
			throw new WorkspaceConflictError(current.updatedAt, current.updatedBy);
		}
	}

	const rows = await query<{ updated_at: string; updated_by: string | null }>(
		`INSERT INTO workspace_state (id, project_id, data, updated_at, updated_by)
		 VALUES ($1, $1, $2, now(), $3)
		 ON CONFLICT (id) DO UPDATE SET project_id = $1, data = $2, updated_at = now(), updated_by = $3
		 RETURNING updated_at, updated_by`,
		[projectId, JSON.stringify(data), userId]
	);
	return {
		data,
		updatedAt: rows[0].updated_at,
		updatedBy: rows[0].updated_by
	};
}
