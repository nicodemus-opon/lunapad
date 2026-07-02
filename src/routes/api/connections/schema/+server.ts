import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection } from '$lib/types/connection';
import { fetchExternalConnectionSchema } from '$lib/server/connections';
import { getSecret } from '$lib/server/connection-secrets';
import { getConnectionMetadata } from '$lib/server/connections-store';

interface SchemaConnectionRequest {
	connection: Connection;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as Partial<SchemaConnectionRequest>;
		if (!body?.connection) {
			return json({ error: 'Connection payload is required.' }, { status: 400 });
		}

		const connection = await getConnectionMetadata(body.connection.id);
		if (!connection) return json({ error: 'Unknown connection.' }, { status: 404 });
		const secret = await getSecret(connection.id);
		const result = await fetchExternalConnectionSchema(connection, secret ?? undefined);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch schema.';
		return json({ error: message }, { status: 400 });
	}
};
