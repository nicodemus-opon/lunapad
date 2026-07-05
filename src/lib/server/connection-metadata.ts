import type { Connection } from '$lib/types/connection';
import { getConnectionMetadata, upsertConnectionMetadata } from './connections-store.js';

export async function resolveConnectionMetadata(connection: Connection): Promise<Connection | null> {
	const savedConnection = await getConnectionMetadata(connection.id);
	if (savedConnection) return savedConnection;
	if (connection.type === 'duckdb-wasm') return null;
	await upsertConnectionMetadata(connection);
	return connection;
}
