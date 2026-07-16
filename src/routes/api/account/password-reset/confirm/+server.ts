import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { confirmPasswordReset } from '$lib/server/account-lifecycle';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		token?: string;
		password?: string;
	};
	const token = typeof body.token === 'string' ? body.token.trim() : '';
	const password = typeof body.password === 'string' ? body.password : '';
	if (!token || !password) return json({ error: 'Token and password are required.' }, { status: 400 });
	try {
		await confirmPasswordReset({ token, password });
		return json({ ok: true });
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : 'Password reset failed.' }, { status: 400 });
	}
};
