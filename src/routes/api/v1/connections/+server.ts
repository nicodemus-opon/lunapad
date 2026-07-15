import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';

export const GET: RequestHandler = async ({ locals, request }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		return agentActionResponse({ locals, request }, 'list_connections', {});
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
