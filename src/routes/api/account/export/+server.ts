import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exportAccountData } from '$lib/server/account-lifecycle';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json(await exportAccountData(locals.user.id));
};
