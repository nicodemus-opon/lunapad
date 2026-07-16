import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	dismissOnboardingChecklistItem,
	type OnboardingChecklistItemId
} from '$lib/server/onboarding-checklist';

const itemIds = new Set<OnboardingChecklistItemId>([
	'create_project',
	'add_connection',
	'run_query',
	'invite_teammate',
	'publish_report'
]);

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	const itemId = params.item as OnboardingChecklistItemId;
	if (!itemIds.has(itemId)) return json({ error: 'Unknown checklist item.' }, { status: 404 });
	await dismissOnboardingChecklistItem({
		orgId: locals.organization.id,
		userId: locals.user.id,
		itemId
	});
	return json({ ok: true });
};
