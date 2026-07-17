import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimitedAsync } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';
import { publicApiErrorResponse } from '$lib/server/public-api-errors';

interface RunPrqlRequest {
	connectionId: string;
	prql: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (await isRateLimitedAsync(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json()) as Partial<RunPrqlRequest>;
		if (!body?.connectionId || typeof body.prql !== 'string') {
			return json({ error: 'connectionId and prql are required.' }, { status: 400 });
		}
		return agentActionResponse({ locals, request }, 'run_prql', {
			connectionId: body.connectionId,
			prql: body.prql
		});
	} catch (err) {
		return publicApiErrorResponse(err, { surface: 'v1.prql' });
	}
};
