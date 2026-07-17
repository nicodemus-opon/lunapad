import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimitedAsync } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';
import { publicApiErrorResponse } from '$lib/server/public-api-errors';

interface DbtCompileRequest {
	folder?: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (await isRateLimitedAsync(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json().catch(() => ({}))) as DbtCompileRequest;
		return agentActionResponse({ locals, request }, 'dbt_compile', { folder: body.folder });
	} catch (err) {
		return publicApiErrorResponse(err, { surface: 'v1.dbt.compile' });
	}
};
