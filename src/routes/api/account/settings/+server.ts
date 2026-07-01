import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserSettings, updateUserSettings } from '$lib/server/user-settings';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const settings = await getUserSettings(locals.user.id);
	return json({ settings });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json();
	const settings = await updateUserSettings(locals.user.id, body.settings ?? body);
	return json({ settings });
};
