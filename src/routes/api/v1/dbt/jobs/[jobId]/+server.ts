import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDbtJobStatusAction } from '$lib/server/lunapad-actions';
import { isRateLimited } from '$lib/server/api-rate-limit';

export const GET: RequestHandler = async ({ params, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		return json(await getDbtJobStatusAction({ jobId: params.jobId }));
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 404 });
	}
};
