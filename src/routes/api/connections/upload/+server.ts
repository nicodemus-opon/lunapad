import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection } from '$lib/types/connection';
import { uploadToExternalConnection } from '$lib/server/connections';
import { getSecret } from '$lib/server/connection-secrets';
import { getConnectionMetadata } from '$lib/server/connections-store';
import { assertCloudTenantRef } from '$lib/server/tenancy';

interface UploadConnectionRequest {
	connection: Connection;
	tableName: string;
	schema?: string;
	columns: { name: string; type: string }[];
	rows: unknown[][];
	mode: 'replace' | 'append';
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json()) as Partial<UploadConnectionRequest>;

	if (
		!body?.connection ||
		!body.tableName ||
		!Array.isArray(body.columns) ||
		!Array.isArray(body.rows)
	) {
		return json(
			{ error: 'connection, tableName, columns, and rows are required.' },
			{ status: 400 }
		);
	}

	const mode = body.mode === 'append' ? 'append' : 'replace';

	try {
		assertCloudTenantRef({ orgId: locals.organization?.id ?? '' }, 'Uploading to a connection');
		const connection = await getConnectionMetadata(body.connection.id, locals.organization?.id);
		if (!connection) return json({ error: 'Unknown connection.' }, { status: 404 });
		const secret = await getSecret(connection.id, locals.organization?.id);
		const result = await uploadToExternalConnection(
			connection,
			secret ?? undefined,
			body.tableName,
			body.schema,
			body.columns,
			body.rows,
			mode,
			locals.organization?.id
		);
		return json({ ok: true, rowsInserted: result.rowsInserted });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Upload failed.';
		return json({ ok: false, error: message }, { status: 400 });
	}
};
