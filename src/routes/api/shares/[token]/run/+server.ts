import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShareByToken, getShareConnections } from '$lib/server/shared-reports';
import { isRateLimited } from '$lib/server/share-rate-limit';
import { queryExternalConnection } from '$lib/server/connections';
import { substituteFilterTokens } from '$lib/services/filter-substitution';
import { BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';

interface RunRequest {
	cellId: string;
	filters?: Record<string, string>;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const token = params.token;
	if (isRateLimited(token)) return json({ error: 'Too many requests' }, { status: 429 });

	const share = await getShareByToken(token);
	if (!share || share.revoked) return json({ error: 'Not found' }, { status: 410 });

	const body = (await request.json()) as Partial<RunRequest>;
	if (!body?.cellId) return json({ error: 'cellId is required.' }, { status: 400 });

	const cell = share.snapshot.cells.find((c) => c.id === body.cellId);
	if (!cell || !cell.isLive || !cell.sqlTemplate) {
		return json({ error: 'Cell is not live.' }, { status: 400 });
	}
	if (!cell.connectionId || cell.connectionId === BUILTIN_DUCKDB_CONNECTION_ID) {
		return json({ error: 'Cell is not live.' }, { status: 400 });
	}

	const connections = await getShareConnections(token);
	const record = connections.find((c) => c.connectionId === cell.connectionId);
	if (!record) return json({ error: 'Connection not found for this share.' }, { status: 400 });

	const sql = substituteFilterTokens(cell.sqlTemplate, body.filters ?? {});

	try {
		const result = await queryExternalConnection(record.connection, record.secret ?? undefined, sql);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to run query.';
		return json({ error: message }, { status: 400 });
	}
};
