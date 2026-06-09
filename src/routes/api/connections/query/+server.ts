import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection, ConnectionSecret } from '$lib/types/connection';
import { queryExternalConnection } from '$lib/server/connections';
import { registerQuery, unregisterQuery } from '$lib/server/query-registry';

interface QueryConnectionRequest {
	connection: Connection;
	secret?: ConnectionSecret;
	sql: string;
	runId?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Partial<QueryConnectionRequest>;
	if (!body?.connection || typeof body.sql !== 'string') {
		return json({ error: 'Connection and SQL payload are required.' }, { status: 400 });
	}

	const { runId } = body;
	const controller = runId ? registerQuery(runId) : new AbortController();
	try {
		const result = await queryExternalConnection(body.connection, body.secret, body.sql, controller.signal);
		return json(result);
	} catch (err) {
		if ((err as Error)?.name === 'AbortError') {
			return json({ error: 'Query cancelled' }, { status: 499 });
		}
		const message = err instanceof Error ? err.message : 'Failed to query connection.';
		return json({ error: message }, { status: 400 });
	} finally {
		if (runId) unregisterQuery(runId);
	}
};