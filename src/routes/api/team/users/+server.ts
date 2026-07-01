import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db.js';
import { can, userFromLocals } from '$lib/server/permissions';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'comments:read')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const rows = await query<{ id: string; name: string; email: string; image: string | null }>(
		`SELECT id, name, email, image FROM "user" ORDER BY name ASC`
	);
	return json({
		users: rows.map((u) => ({
			id: u.id,
			name: u.name,
			email: u.email,
			image: u.image,
			mention: u.email.split('@')[0]
		}))
	});
};
