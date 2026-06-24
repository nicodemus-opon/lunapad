import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNotebooksAction } from '$lib/server/lunapad-actions';
import { isRateLimited } from '$lib/server/api-rate-limit';

export const GET: RequestHandler = async ({ url, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const folder = url.searchParams.get('folder') ?? undefined;
		return json(await listNotebooksAction({ folder }));
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
