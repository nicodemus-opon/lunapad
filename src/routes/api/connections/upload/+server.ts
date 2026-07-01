import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection } from '$lib/types/connection';
import { uploadToExternalConnection } from '$lib/server/connections';
import { getSecret } from '$lib/server/connection-secrets';

interface UploadConnectionRequest {
	connection: Connection;
	tableName: string;
	schema?: string;
	columns: { name: string; type: string }[];
	rows: unknown[][];
	mode: 'replace' | 'append';
}

export const POST: RequestHandler = async ({ request }) => {
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
		const secret = await getSecret(body.connection.id);
		const result = await uploadToExternalConnection(
			body.connection,
			secret ?? undefined,
			body.tableName,
			body.schema,
			body.columns,
			body.rows,
			mode
		);
		return json({ ok: true, rowsInserted: result.rowsInserted });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Upload failed.';
		return json({ ok: false, error: message }, { status: 400 });
	}
};
