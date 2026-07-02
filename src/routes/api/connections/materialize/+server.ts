import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection } from '$lib/types/connection';
import {
	materializeExternalConnection,
	type ExternalMaterializationMode
} from '$lib/server/connections';
import { getSecret } from '$lib/server/connection-secrets';
import { getConnectionMetadata } from '$lib/server/connections-store';

interface MaterializeConnectionRequest {
	connection: Connection;
	targetName: string;
	targetSchema?: string;
	sql: string;
	mode: ExternalMaterializationMode;
}

function isMaterializationMode(value: unknown): value is ExternalMaterializationMode {
	return value === 'table' || value === 'view' || value === 'incremental';
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as Partial<MaterializeConnectionRequest>;
		if (!body?.connection || typeof body.targetName !== 'string' || typeof body.sql !== 'string') {
			return json(
				{ error: 'Connection, target name, and SQL payload are required.' },
				{ status: 400 }
			);
		}
		if (!isMaterializationMode(body.mode)) {
			return json({ error: 'Materialization mode is invalid.' }, { status: 400 });
		}

		const connection = await getConnectionMetadata(body.connection.id);
		if (!connection) return json({ error: 'Unknown connection.' }, { status: 404 });
		const secret = await getSecret(connection.id);
		const result = await materializeExternalConnection(
			connection,
			secret ?? undefined,
			body.targetName,
			typeof body.targetSchema === 'string' ? body.targetSchema : undefined,
			body.sql,
			body.mode
		);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to materialize relation.';
		return json({ error: message }, { status: 400 });
	}
};
