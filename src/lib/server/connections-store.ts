import { query } from './db.js';
import type { Connection } from '$lib/types/connection';
import { DEFAULT_ORG_ID } from './tenancy.js';
import {
	isPhysicalCatalogName,
	publicConnections,
	withPhysicalCatalog
} from './trino-catalog-isolation.js';

// Stores connection metadata (host/port/catalog/etc — never secrets, those live in
// connection-secrets.ts) so the server has its own source of truth independent of any
// browser tab's localStorage. Stored as a single JSONB blob per connection rather than a
// rigid relational schema, since `Connection` is a 13-variant discriminated union — the
// client already passes the whole object wholesale on every /api/connections/* call today.
let connectionsTableReady: Promise<void> | null = null;

async function ensureConnectionsTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS connections (
			org_id        TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
			connection_id TEXT NOT NULL,
			data          JSONB NOT NULL,
			updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (org_id, connection_id)
		)
	`);
	await query(
		`ALTER TABLE connections ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
	);
	await query(`CREATE INDEX IF NOT EXISTS connections_org_idx ON connections (org_id)`);
	await query(
		`CREATE UNIQUE INDEX IF NOT EXISTS connections_org_connection_idx ON connections (org_id, connection_id)`
	);
}

function ensureConnectionsTableOnce(): Promise<void> {
	if (!connectionsTableReady) connectionsTableReady = ensureConnectionsTable();
	return connectionsTableReady;
}

function connectionAlias(connection: Connection): string | null {
	return connection.type === 'duckdb-wasm' ? null : connection.catalogName.toLowerCase();
}

async function assertUniqueAlias(connection: Connection, orgId: string): Promise<void> {
	const alias = connectionAlias(connection);
	if (!alias) return;
	if (isPhysicalCatalogName(alias)) {
		throw new Error('Source alias cannot use Lunapad internal catalog prefix "lp_".');
	}
	const rows = await query<{ data: Connection }>(
		`SELECT data FROM connections WHERE org_id = $1 ORDER BY connection_id`,
		[orgId]
	);
	const duplicate = rows
		.map((row) => row.data)
		.find(
			(existing) =>
				existing.id !== connection.id &&
				existing.type !== 'duckdb-wasm' &&
				existing.catalogName.toLowerCase() === alias
		);
	if (duplicate) {
		throw new Error(`Source alias "${alias}" is already used in this workspace.`);
	}
}

export async function upsertConnectionMetadata(
	connection: Connection,
	orgId = DEFAULT_ORG_ID
): Promise<Connection | null> {
	if (connection.type === 'duckdb-wasm') return null;
	await ensureConnectionsTableOnce();
	await assertUniqueAlias(connection, orgId);
	const storedConnection = withPhysicalCatalog(connection, orgId);
	await query(
		`INSERT INTO connections (org_id, connection_id, data, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (org_id, connection_id) DO UPDATE SET data = $3, updated_at = now()`,
		[orgId, connection.id, JSON.stringify(storedConnection)]
	);
	return storedConnection;
}

export async function listConnectionsMetadata(
	orgId = DEFAULT_ORG_ID,
	opts: { includePhysicalCatalogName?: boolean } = {}
): Promise<Connection[]> {
	await ensureConnectionsTableOnce();
	const rows = await query<{ data: Connection }>(
		`SELECT data FROM connections WHERE org_id = $1 ORDER BY connection_id`,
		[orgId]
	);
	const connections = rows.map((row) => withPhysicalCatalog(row.data, orgId));
	return opts.includePhysicalCatalogName ? connections : publicConnections(connections);
}

export async function getConnectionMetadata(
	connectionId: string,
	orgId = DEFAULT_ORG_ID
): Promise<Connection | null> {
	await ensureConnectionsTableOnce();
	const rows = await query<{ data: Connection }>(
		`SELECT data FROM connections WHERE connection_id = $1 AND org_id = $2`,
		[connectionId, orgId]
	);
	const connection = rows[0]?.data;
	if (!connection) return null;
	return withPhysicalCatalog(connection, orgId);
}

export async function deleteConnectionMetadata(
	connectionId: string,
	orgId = DEFAULT_ORG_ID
): Promise<void> {
	await ensureConnectionsTableOnce();
	await query(`DELETE FROM connections WHERE connection_id = $1 AND org_id = $2`, [
		connectionId,
		orgId
	]);
}
