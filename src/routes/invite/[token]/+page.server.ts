import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getInvitationRecordByToken, invitationState } from '$lib/server/invitations';

export const load: PageServerLoad = async ({ params, locals }) => {
	const invitation = await getInvitationRecordByToken(params.token);
	if (!invitation) error(404, 'Invitation not found');
	return {
		invitation,
		state: invitationState(invitation),
		token: params.token,
		currentUser: locals.user ? { email: locals.user.email, name: locals.user.name } : null
	};
};
