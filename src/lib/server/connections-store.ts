import { query } from './db.js';
import type { Connection } from '$lib/types/connection';

// Stores connection metadata (host/port/catalog/etc — never secrets, those live in
// connection-secrets.ts) so the server has its own source of truth independent of any
// browser tab's localStorage. Stored as a single JSONB blob per connection rather than a
// rigid relational schema, since `Connection` is a 13-variant discriminated union — the
// client already passes the whole object wholesale on every /api/connections/* call today.
let connectionsTableReady: Promise<void> | null = null;

async function ensureConnectionsTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS connections (
			connection_id TEXT PRIMARY KEY,
			data          JSONB NOT NULL,
			updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
}

function ensureConnectionsTableOnce(): Promise<void> {
	if (!connectionsTableReady) connectionsTableReady = ensureConnectionsTable();
	return connectionsTableReady;
}

export async function upsertConnectionMetadata(connection: Connection): Promise<void> {
	if (connection.type === 'duckdb-wasm') return;
	await ensureConnectionsTableOnce();
	await query(
		`INSERT INTO connections (connection_id, data, updated_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (connection_id) DO UPDATE SET data = $2, updated_at = now()`,
		[connection.id, JSON.stringify(connection)]
	);
}

export async function listConnectionsMetadata(): Promise<Connection[]> {
	await ensureConnectionsTableOnce();
	const rows = await query<{ data: Connection }>(
		`SELECT data FROM connections ORDER BY connection_id`
	);
	return rows.map((row) => row.data);
}

export async function getConnectionMetadata(connectionId: string): Promise<Connection | null> {
	await ensureConnectionsTableOnce();
	const rows = await query<{ data: Connection }>(
		`SELECT data FROM connections WHERE connection_id = $1`,
		[connectionId]
	);
	return rows[0]?.data ?? null;
}

export async function deleteConnectionMetadata(connectionId: string): Promise<void> {
	await ensureConnectionsTableOnce();
	await query(`DELETE FROM connections WHERE connection_id = $1`, [connectionId]);
}
