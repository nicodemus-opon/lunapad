import { query } from './db.js';
import { DEFAULT_ORG_ID, DEFAULT_PROJECT_ID } from './tenancy.js';

let presenceTableReady: Promise<void> | null = null;

export interface PresenceEntry {
	userId: string;
	userName: string;
	userImage: string | null;
	notebookId: string | null;
	cellId: string | null;
	lastSeenAt: string;
}

async function ensurePresenceTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS user_presence (
			org_id      TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
			project_id  TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}',
			user_id     TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			notebook_id TEXT,
			cell_id     TEXT,
			last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (org_id, project_id, user_id)
		)
	`);
	await query(
		`ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
	);
	await query(
		`ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}'`
	);
	await query(
		`CREATE UNIQUE INDEX IF NOT EXISTS user_presence_org_project_user_idx ON user_presence (org_id, project_id, user_id)`
	);
}

export function ensurePresenceTableOnce(): Promise<void> {
	if (!presenceTableReady) presenceTableReady = ensurePresenceTable();
	return presenceTableReady;
}

const STALE_MS = 60_000;

export async function upsertPresence(input: {
	orgId?: string | null;
	projectId?: string | null;
	userId: string;
	notebookId?: string | null;
	cellId?: string | null;
}): Promise<void> {
	await ensurePresenceTableOnce();
	await query(
		`INSERT INTO user_presence (org_id, project_id, user_id, notebook_id, cell_id, last_seen_at)
		 VALUES ($1, $2, $3, $4, $5, now())
		 ON CONFLICT (org_id, project_id, user_id) DO UPDATE
		 SET notebook_id = $4, cell_id = $5, last_seen_at = now()`,
		[
			input.orgId ?? DEFAULT_ORG_ID,
			input.projectId ?? DEFAULT_PROJECT_ID,
			input.userId,
			input.notebookId ?? null,
			input.cellId ?? null
		]
	);
}

export async function listActivePresence(input: {
	orgId?: string | null;
	projectId?: string | null;
	notebookId?: string | null;
}): Promise<PresenceEntry[]> {
	await ensurePresenceTableOnce();
	const cutoff = new Date(Date.now() - STALE_MS).toISOString();
	const orgId = input.orgId ?? DEFAULT_ORG_ID;
	const projectId = input.projectId ?? DEFAULT_PROJECT_ID;
	const rows = input.notebookId
		? await query<{
				user_id: string;
				user_name: string;
				user_image: string | null;
				notebook_id: string | null;
				cell_id: string | null;
				last_seen_at: string;
			}>(
				`SELECT p.user_id, u.name AS user_name, u.image AS user_image,
				        p.notebook_id, p.cell_id, p.last_seen_at
				 FROM user_presence p
				 JOIN "user" u ON u.id = p.user_id
				 WHERE p.last_seen_at >= $1 AND p.notebook_id = $2 AND p.org_id = $3 AND p.project_id = $4`,
				[cutoff, input.notebookId, orgId, projectId]
			)
		: await query<{
				user_id: string;
				user_name: string;
				user_image: string | null;
				notebook_id: string | null;
				cell_id: string | null;
				last_seen_at: string;
			}>(
				`SELECT p.user_id, u.name AS user_name, u.image AS user_image,
				        p.notebook_id, p.cell_id, p.last_seen_at
				 FROM user_presence p
				 JOIN "user" u ON u.id = p.user_id
				 WHERE p.last_seen_at >= $1 AND p.org_id = $2 AND p.project_id = $3`,
				[cutoff, orgId, projectId]
			);
	return rows.map((r) => ({
		userId: r.user_id,
		userName: r.user_name,
		userImage: r.user_image,
		notebookId: r.notebook_id,
		cellId: r.cell_id,
		lastSeenAt: r.last_seen_at
	}));
}
