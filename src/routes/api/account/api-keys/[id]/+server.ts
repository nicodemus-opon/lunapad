import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { revokeApiKey } from '$lib/server/api-keys';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	await revokeApiKey(locals.user.id, params.id, locals.organization?.id);
	return json({ ok: true });
};
