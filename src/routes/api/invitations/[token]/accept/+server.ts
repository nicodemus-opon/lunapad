import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';
import { query } from '$lib/server/db.js';
import {
	getInvitationRecordByToken,
	invitationState,
	markInvitationAccepted
} from '$lib/server/invitations';
import { createPasswordAccount } from '$lib/server/onboarding';
import { resolveTenantContext, upsertOrganizationMember } from '$lib/server/tenancy';
import { logAuditEvent } from '$lib/server/audit';

const cookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: process.env.NODE_ENV === 'production',
	maxAge: 60 * 60 * 24 * 365
};

async function acceptForUser(input: {
	token: string;
	user: { id: string; email: string; role?: string | null };
	cookies: Parameters<RequestHandler>[0]['cookies'];
}) {
	const pendingInvite = await getInvitationRecordByToken(input.token);
	if (!pendingInvite) return { state: 'expired' as const, status: 404, error: 'Invitation not found.' };
	const state = invitationState(pendingInvite);
	if (state !== 'pending') {
		return { state, status: state === 'accepted' ? 409 : 410, error: `Invitation is ${state}.` };
	}
	if (input.user.email.toLowerCase() !== pendingInvite.email.toLowerCase()) {
		return {
			state: 'wrong_email' as const,
			status: 403,
			error: 'This invitation was sent to a different email address.'
		};
	}
	const invite = await markInvitationAccepted(input.token, input.user.id);
	if (!invite) return { state: 'expired' as const, status: 410, error: 'Invitation is no longer valid.' };
	await upsertOrganizationMember({
		orgId: invite.orgId,
		userId: input.user.id,
		role: invite.role
	});
	const tenant = await resolveTenantContext(input.user, null, invite.orgId);
	input.cookies.set('lunapad_org_id', tenant.organization.id, cookieOptions);
	input.cookies.set('lunapad_project_id', tenant.project.id, cookieOptions);
	await logAuditEvent({
		actorId: input.user.id,
		orgId: invite.orgId,
		projectId: tenant.project.id,
		action: 'invitation.accepted',
		resourceType: 'invitation',
		resourceId: invite.id,
		metadata: { email: invite.email, role: invite.role }
	});
	return {
		state: 'accepted' as const,
		status: 200,
		tenant,
		invitation: invite
	};
}

export const POST: RequestHandler = async ({ params, request, locals, cookies }) => {
	const invitation = await getInvitationRecordByToken(params.token);
	if (!invitation) return json({ state: 'expired', error: 'Invitation not found.' }, { status: 404 });
	const state = invitationState(invitation);
	if (state !== 'pending') {
		return json({ state, error: `Invitation is ${state}.` }, { status: state === 'accepted' ? 409 : 410 });
	}

	if (locals.user) {
		const result = await acceptForUser({
			token: params.token,
			user: { id: locals.user.id, email: locals.user.email, role: locals.user.role },
			cookies
		});
		if (!('tenant' in result) || !result.tenant) return json(result, { status: result.status });
		return json({
			state: result.state,
			organization: result.tenant.organization,
			project: result.tenant.project,
			membership: result.tenant.membership,
			entitlements: result.tenant.entitlements
		});
	}

	const body = await request.json().catch(() => ({}));
	const existing = await query<{ id: string }>(
		`SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 1`,
		[invitation.email.toLowerCase()]
	);
	if (existing.length > 0) {
		return json({
			state: 'login_required',
			email: invitation.email,
			loginUrl: `/login?inviteToken=${encodeURIComponent(params.token)}&email=${encodeURIComponent(invitation.email)}`
		}, { status: 409 });
	}

	const password = typeof body.password === 'string' ? body.password : '';
	const name = typeof body.name === 'string' ? body.name : invitation.email.split('@')[0];
	if (password.length < 8) {
		return json({ state: 'pending', error: 'Password must be at least 8 characters.' }, { status: 400 });
	}
	const user = await createPasswordAccount({
		name,
		email: invitation.email,
		password,
		role: invitation.role
	});
	await auth.api.signInEmail({
		body: { email: invitation.email, password, rememberMe: true },
		headers: request.headers
	});
	const result = await acceptForUser({
		token: params.token,
		user,
		cookies
	});
	if (!('tenant' in result) || !result.tenant) return json(result, { status: result.status });
	return json({
		state: result.state,
		user,
		organization: result.tenant.organization,
		project: result.tenant.project,
		membership: result.tenant.membership,
		entitlements: result.tenant.entitlements
	}, { status: 201 });
};
