import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markInvitationAccepted } from '$lib/server/invitations';
import { query } from '$lib/server/db.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const token = body.token as string;
	if (!token) return json({ error: 'token required' }, { status: 400 });
	await markInvitationAccepted(token);

	// Apply invited role to the user who just signed up
	const rows = await query<{ email: string; role: string }>(
		`SELECT email, role FROM invitations WHERE token = $1`,
		[token]
	);
	const invite = rows[0];
	if (invite && locals.user?.email === invite.email) {
		await query(`UPDATE "user" SET role = $1 WHERE id = $2`, [invite.role, locals.user.id]);
	}
	return json({ ok: true });
};
