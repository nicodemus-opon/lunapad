import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dbtCompileAction } from '$lib/server/lunapad-actions';
import { isRateLimited } from '$lib/server/api-rate-limit';

interface DbtCompileRequest {
	folder?: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json().catch(() => ({}))) as DbtCompileRequest;
		return json(await dbtCompileAction({ folder: body.folder }));
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
