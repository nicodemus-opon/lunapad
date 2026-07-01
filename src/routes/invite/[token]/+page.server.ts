import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getInvitationByToken } from '$lib/server/invitations';

export const load: PageServerLoad = async ({ params }) => {
	const invitation = await getInvitationByToken(params.token);
	if (!invitation) error(404, 'Invitation not found or expired');
	return { invitation, token: params.token };
};
