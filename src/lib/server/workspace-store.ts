import { query } from './db.js';

// Stores the whole shared-workspace blob (notebooks, cells, tabs, prefs, workspace
// standards) as a single JSONB row, so Postgres becomes the source of truth for the
// team's notebook content instead of each browser's localStorage. Single singleton
// row rather than per-notebook rows: notebook.svelte.ts's serialize()/deserialize()
// already work on one whole-workspace blob, and a single row makes last-write-wins
// trivially correct (one UPDATE, no cross-row partial-save states). Demo mode never
// calls into this module at all (see DEMO_BLOCKED_PREFIXES in hooks.server.ts).
let workspaceTableReady: Promise<void> | null = null;

async function ensureWorkspaceTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS workspace_state (
			id         TEXT PRIMARY KEY DEFAULT 'singleton',
			data       JSONB NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_by TEXT
		)
	`);
}

function ensureWorkspaceTableOnce(): Promise<void> {
	if (!workspaceTableReady) workspaceTableReady = ensureWorkspaceTable();
	return workspaceTableReady;
}

export interface WorkspaceStateRow {
	data: unknown;
	updatedAt: string;
}

export async function loadWorkspaceState(): Promise<WorkspaceStateRow | null> {
	await ensureWorkspaceTableOnce();
	const rows = await query<{ data: unknown; updated_at: string }>(
		`SELECT data, updated_at FROM workspace_state WHERE id = 'singleton'`
	);
	return rows[0] ? { data: rows[0].data, updatedAt: rows[0].updated_at } : null;
}

export async function saveWorkspaceState(data: unknown, userId: string | null): Promise<void> {
	await ensureWorkspaceTableOnce();
	await query(
		`INSERT INTO workspace_state (id, data, updated_at, updated_by)
		 VALUES ('singleton', $1, now(), $2)
		 ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now(), updated_by = $2`,
		[JSON.stringify(data), userId]
	);
}
