import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ConnectionSecret } from '$lib/types/connection';
import { setSecret, deleteSecret } from '$lib/server/connection-secrets';
import { assertCloudTenantRef } from '$lib/server/tenancy';

interface SetSecretRequest {
	connectionId: string;
	secret: ConnectionSecret;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json()) as Partial<SetSecretRequest>;
	if (!body?.connectionId || !body.secret) {
		return json({ error: 'connectionId and secret are required.' }, { status: 400 });
	}
	try {
		assertCloudTenantRef({ orgId: locals.organization?.id ?? '' }, 'Storing a connection secret');
		await setSecret(body.connectionId, body.secret, locals.organization?.id);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to store secret.';
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json()) as Partial<{ connectionId: string }>;
	if (!body?.connectionId) {
		return json({ error: 'connectionId is required.' }, { status: 400 });
	}
	try {
		assertCloudTenantRef({ orgId: locals.organization?.id ?? '' }, 'Deleting a connection secret');
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 403 });
	}
	await deleteSecret(body.connectionId, locals.organization?.id);
	return json({ ok: true });
};
