import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimitedAsync } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';
import { publicApiErrorResponse } from '$lib/server/public-api-errors';

export const GET: RequestHandler = async ({ url, locals, request }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (await isRateLimitedAsync(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const folder = url.searchParams.get('folder') ?? undefined;
		return agentActionResponse({ locals, request }, 'get_dbt_manifest', { folder });
	} catch (err) {
		return publicApiErrorResponse(err, { surface: 'v1.dbt.manifest' });
	}
};
