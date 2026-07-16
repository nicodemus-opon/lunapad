import type { Connection } from '$lib/types/connection';
import { getConnectionMetadata, upsertConnectionMetadata } from './connections-store.js';

export async function resolveConnectionMetadata(
	connection: Connection,
	orgId?: string
): Promise<Connection | null> {
	const savedConnection = await getConnectionMetadata(connection.id, orgId);
	if (savedConnection) return savedConnection;
	if (connection.type === 'duckdb-wasm') return null;
	const saved = orgId
		? await upsertConnectionMetadata(connection, orgId)
		: await upsertConnectionMetadata(connection);
	return saved ?? connection;
}
