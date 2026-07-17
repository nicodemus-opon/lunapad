import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requestPasswordReset } from '$lib/server/account-lifecycle';
import { isRateLimitedShared, rateLimitIp } from '$lib/server/redis-rate-limit';

export const POST: RequestHandler = async ({ request }) => {
	if (await isRateLimitedShared(`password-reset:${rateLimitIp(request)}`, 10, 60 * 60 * 1000)) {
		return json({ error: 'Too many password reset attempts. Try again later.' }, { status: 429 });
	}
	const body = (await request.json().catch(() => ({}))) as { email?: string };
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	if (!email) return json({ error: 'Email is required.' }, { status: 400 });
	const result = await requestPasswordReset(email);
	return json(result);
};
