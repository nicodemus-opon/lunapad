import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimitedAsync } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';
import { publicApiErrorResponse } from '$lib/server/public-api-errors';

export const GET: RequestHandler = async ({ params, locals, request }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (await isRateLimitedAsync(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		return agentActionResponse({ locals, request }, 'get_dbt_job_status', { jobId: params.jobId });
	} catch (err) {
		return publicApiErrorResponse(err, {
			surface: 'v1.dbt.job',
			status: 404,
			fallback: 'Job not found.'
		});
	}
};
