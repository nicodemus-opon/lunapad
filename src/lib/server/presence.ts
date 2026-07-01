import { query } from './db.js';

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
			user_id     TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
			notebook_id TEXT,
			cell_id     TEXT,
			last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
}

export function ensurePresenceTableOnce(): Promise<void> {
	if (!presenceTableReady) presenceTableReady = ensurePresenceTable();
	return presenceTableReady;
}

const STALE_MS = 60_000;

export async function upsertPresence(input: {
	userId: string;
	notebookId?: string | null;
	cellId?: string | null;
}): Promise<void> {
	await ensurePresenceTableOnce();
	await query(
		`INSERT INTO user_presence (user_id, notebook_id, cell_id, last_seen_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (user_id) DO UPDATE
		 SET notebook_id = $2, cell_id = $3, last_seen_at = now()`,
		[input.userId, input.notebookId ?? null, input.cellId ?? null]
	);
}

export async function listActivePresence(notebookId?: string | null): Promise<PresenceEntry[]> {
	await ensurePresenceTableOnce();
	const cutoff = new Date(Date.now() - STALE_MS).toISOString();
	const rows = notebookId
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
				 WHERE p.last_seen_at >= $1 AND p.notebook_id = $2`,
				[cutoff, notebookId]
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
				 WHERE p.last_seen_at >= $1`,
				[cutoff]
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
