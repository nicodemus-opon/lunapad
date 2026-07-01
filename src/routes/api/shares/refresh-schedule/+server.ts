import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertShareRefreshSchedule } from '$lib/server/shared-reports';
import { requireSharesPublish } from '$lib/server/share-guards';

export const POST: RequestHandler = async ({ request, locals }) => {
	const denied = requireSharesPublish(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const body = (await request.json()) as Partial<{
		notebookId: string;
		intervalMs: number;
		enabled: boolean;
	}>;
	if (!body?.notebookId || !body.intervalMs) {
		return json({ error: 'notebookId and intervalMs are required.' }, { status: 400 });
	}
	const schedule = await upsertShareRefreshSchedule(
		body.notebookId,
		body.intervalMs,
		body.enabled ?? true
	);
	return json({ schedule });
};
