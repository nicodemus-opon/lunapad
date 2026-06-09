import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection, ConnectionSecret } from '$lib/types/connection';
import { fetchExternalConnectionSchema } from '$lib/server/connections';

interface SchemaConnectionRequest {
	connection: Connection;
	secret?: ConnectionSecret;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as Partial<SchemaConnectionRequest>;
		if (!body?.connection) {
			return json({ error: 'Connection payload is required.' }, { status: 400 });
		}

		const result = await fetchExternalConnectionSchema(body.connection, body.secret);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch schema.';
		return json({ error: message }, { status: 400 });
	}
};