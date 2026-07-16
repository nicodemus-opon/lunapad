import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOnboardingChecklist } from '$lib/server/onboarding-checklist';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization || !locals.project || !locals.entitlements) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const checklist = await getOnboardingChecklist({
		tenant: { orgId: locals.organization.id, projectId: locals.project.id },
		userId: locals.user.id,
		entitlements: locals.entitlements
	});
	return json({ checklist });
};
