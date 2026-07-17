import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimitedAsync } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';
import { publicApiErrorResponse } from '$lib/server/public-api-errors';

interface RunQueryRequest {
	connectionId: string;
	sql: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (await isRateLimitedAsync(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json()) as Partial<RunQueryRequest>;
		if (!body?.connectionId || typeof body.sql !== 'string') {
			return json({ error: 'connectionId and sql are required.' }, { status: 400 });
		}
		return agentActionResponse({ locals, request }, 'run_query', {
			connectionId: body.connectionId,
			sql: body.sql
		});
	} catch (err) {
		return publicApiErrorResponse(err, { surface: 'v1.query' });
	}
};
