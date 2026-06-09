import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection } from '$lib/types/connection';
import { unregisterCatalog } from '$lib/server/connections';

interface RemoveConnectionRequest {
	connection: Connection;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as Partial<RemoveConnectionRequest>;
		if (!body?.connection) {
			return json({ error: 'Connection payload is required.' }, { status: 400 });
		}
		if (body.connection.type === 'duckdb-wasm') {
			return json({ error: 'Cannot remove built-in connection.' }, { status: 400 });
		}
		await unregisterCatalog(body.connection.catalogName);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to remove source.';
		return json({ error: message }, { status: 400 });
	}
};
