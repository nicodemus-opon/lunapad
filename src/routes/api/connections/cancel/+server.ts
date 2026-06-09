import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelQuery } from '$lib/server/query-registry';

export const POST: RequestHandler = async ({ request }) => {
	const { runId } = (await request.json()) as { runId?: string };
	if (!runId) return json({ cancelled: false });
	return json({ cancelled: cancelQuery(runId) });
};
