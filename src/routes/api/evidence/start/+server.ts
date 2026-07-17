import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startEvidenceServer } from '$lib/server/evidence-runner';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder: requestedFolder } = (await request.json()) as { folder?: string };
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		const jobId = startEvidenceServer(folder);
		return json({ jobId });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};
