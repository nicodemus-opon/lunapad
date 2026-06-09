import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection, ConnectionSecret } from '$lib/types/connection';
import { testExternalConnection } from '$lib/server/connections';

interface TestConnectionRequest {
	connection: Connection;
	secret?: ConnectionSecret;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as Partial<TestConnectionRequest>;
		if (!body?.connection) {
			return json({ error: 'Connection payload is required.' }, { status: 400 });
		}

		const result = await testExternalConnection(body.connection, body.secret);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to test connection.';
		return json({ error: message }, { status: 400 });
	}
};