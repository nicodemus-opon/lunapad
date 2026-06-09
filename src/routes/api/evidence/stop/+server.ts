import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stopEvidenceServer } from '$lib/server/evidence-runner';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { jobId } = (await request.json()) as { jobId?: string };
		if (!jobId) return json({ error: 'jobId is required' }, { status: 400 });
		stopEvidenceServer(jobId);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};
