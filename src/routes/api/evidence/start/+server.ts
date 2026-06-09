import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startEvidenceServer } from '$lib/server/evidence-runner';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { folder } = (await request.json()) as { folder?: string };
		if (!folder) return json({ error: 'folder is required' }, { status: 400 });
		const jobId = startEvidenceServer(folder);
		return json({ jobId });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};
