import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApiKey, listApiKeys } from '$lib/server/api-keys';

interface CreateApiKeyRequest {
	name: string;
	expiresInDays?: number;
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const keys = await listApiKeys(locals.user.id);
	return json({ keys });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const body = (await request.json()) as Partial<CreateApiKeyRequest>;
		const name = body.name?.trim();
		if (!name) return json({ error: 'A name is required.' }, { status: 400 });

		const expiresAt =
			typeof body.expiresInDays === 'number' && body.expiresInDays > 0
				? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
				: null;

		const { record, fullKey } = await createApiKey(locals.user.id, name, expiresAt);
		return json({ key: record, fullKey });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
