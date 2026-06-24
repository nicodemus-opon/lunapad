import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runQueryAction } from '$lib/server/lunapad-actions';
import { isRateLimited } from '$lib/server/api-rate-limit';

interface RunQueryRequest {
	connectionId: string;
	sql: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json()) as Partial<RunQueryRequest>;
		if (!body?.connectionId || typeof body.sql !== 'string') {
			return json({ error: 'connectionId and sql are required.' }, { status: 400 });
		}
		const result = await runQueryAction({ connectionId: body.connectionId, sql: body.sql });
		return json(result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
