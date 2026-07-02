import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection } from '$lib/types/connection';
import { unregisterCatalog } from '$lib/server/connections';
import { deleteConnectionMetadata, getConnectionMetadata } from '$lib/server/connections-store';

interface RemoveConnectionRequest {
	connection: Connection;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as Partial<RemoveConnectionRequest>;
		if (!body?.connection) {
			return json({ error: 'Connection payload is required.' }, { status: 400 });
		}
		const connection = await getConnectionMetadata(body.connection.id);
		if (!connection) return json({ error: 'Unknown connection.' }, { status: 404 });
		if (connection.type === 'duckdb-wasm') {
			return json({ error: 'Cannot remove built-in connection.' }, { status: 400 });
		}
		await unregisterCatalog(connection.catalogName);
		await deleteConnectionMetadata(connection.id);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to remove source.';
		return json({ error: message }, { status: 400 });
	}
};
