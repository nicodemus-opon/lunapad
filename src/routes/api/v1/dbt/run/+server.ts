import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';

interface DbtRunRequest {
	folder?: string;
	select?: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json().catch(() => ({}))) as DbtRunRequest;
		return agentActionResponse({ locals, request }, 'dbt_run', {
			folder: body.folder,
			select: body.select
		});
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
