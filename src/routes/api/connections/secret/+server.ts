import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ConnectionSecret } from '$lib/types/connection';
import { setSecret, deleteSecret } from '$lib/server/connection-secrets';

interface SetSecretRequest {
	connectionId: string;
	secret: ConnectionSecret;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Partial<SetSecretRequest>;
	if (!body?.connectionId || !body.secret) {
		return json({ error: 'connectionId and secret are required.' }, { status: 400 });
	}
	try {
		await setSecret(body.connectionId, body.secret);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to store secret.';
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Partial<{ connectionId: string }>;
	if (!body?.connectionId) {
		return json({ error: 'connectionId is required.' }, { status: 400 });
	}
	await deleteSecret(body.connectionId);
	return json({ ok: true });
};
