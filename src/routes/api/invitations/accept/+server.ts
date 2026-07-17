import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { secureCookieEnabled } from '$lib/server/cloud-config';
import { getInvitationByToken, markInvitationAccepted } from '$lib/server/invitations';
import { query } from '$lib/server/db.js';
import { resolveTenantContext, upsertOrganizationMember } from '$lib/server/tenancy';

const cookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: secureCookieEnabled(),
	maxAge: 60 * 60 * 24 * 365
};

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json();
	const token = body.token as string;
	if (!token) return json({ error: 'token required' }, { status: 400 });
	const pendingInvite = await getInvitationByToken(token);
	if (!pendingInvite) return json({ error: 'Invitation not found or expired.' }, { status: 404 });
	if (locals.user.email.toLowerCase() !== pendingInvite.email.toLowerCase()) {
		return json(
			{ error: 'This invitation was sent to a different email address.' },
			{ status: 403 }
		);
	}
	const invite = await markInvitationAccepted(token, locals.user.id);
	if (!invite) return json({ error: 'Invitation not found or expired.' }, { status: 404 });
	await upsertOrganizationMember({
		orgId: invite.orgId,
		userId: locals.user.id,
		role: invite.role
	});

	// Self-host/backcompat: keep the global role roughly in sync for older code paths.
	if (process.env.DEPLOYMENT_MODE !== 'cloud') {
		await query(`UPDATE "user" SET role = $1 WHERE id = $2`, [invite.role, locals.user.id]);
	}
	const tenant = await resolveTenantContext(locals.user, null, invite.orgId);
	cookies.set('lunapad_org_id', tenant.organization.id, cookieOptions);
	cookies.set('lunapad_project_id', tenant.project.id, cookieOptions);
	return json({ ok: true, orgId: invite.orgId, role: invite.role, projectId: tenant.project.id });
};
