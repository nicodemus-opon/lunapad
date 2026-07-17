import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection } from '$lib/types/connection';
import { upsertConnectionMetadata } from '$lib/server/connections-store';
import { assertCloudTenantRef } from '$lib/server/tenancy';

interface SyncConnectionRequest {
	connection: Connection;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		assertCloudTenantRef({ orgId: locals.organization?.id ?? '' }, 'Syncing connection metadata');
		const body = (await request.json()) as Partial<SyncConnectionRequest>;
		if (!body?.connection) {
			return json({ error: 'Connection payload is required.' }, { status: 400 });
		}
		await upsertConnectionMetadata(body.connection, locals.organization?.id);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to sync connection metadata.';
		return json({ error: message }, { status: 400 });
	}
};
