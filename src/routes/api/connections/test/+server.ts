import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection, ConnectionSecret } from '$lib/types/connection';
import { testExternalConnection } from '$lib/server/connections';
import { getSecret } from '$lib/server/connection-secrets';
import { getConnectionMetadata } from '$lib/server/connections-store';
import { assertCloudTenantRef } from '$lib/server/tenancy';

interface TestConnectionRequest {
	connection: Connection;
	// Only sent for a connection that hasn't been saved yet (the user is testing a
	// password they just typed). Already-saved connections are tested by re-reading
	// their stored secret server-side instead.
	secret?: ConnectionSecret;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		assertCloudTenantRef({ orgId: locals.organization?.id ?? '' }, 'Testing a connection');
		const body = (await request.json()) as Partial<TestConnectionRequest>;
		if (!body?.connection) {
			return json({ error: 'Connection payload is required.' }, { status: 400 });
		}

		const savedConnection = await getConnectionMetadata(
			body.connection.id,
			locals.organization?.id
		);
		const connection = savedConnection ?? body.connection;
		const secret =
			body.secret ?? (await getSecret(connection.id, locals.organization?.id)) ?? undefined;
		const result = await testExternalConnection(connection, secret, locals.organization?.id);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to test connection.';
		return json({ error: message }, { status: 400 });
	}
};
