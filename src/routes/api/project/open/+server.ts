import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { detectProject } from '$lib/server/project';
import { setCurrentFolder } from '$lib/server/dbt-schedules';
import { activeTenantProjectFolder, assertTenantProjectFolder } from '$lib/server/project-folders';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder } = (await request.json()) as { folder?: string };
		const resolvedFolder =
			typeof folder === 'string' && folder ? assertTenantProjectFolder(locals, folder) : activeTenantProjectFolder(locals);
		const info = await detectProject(resolvedFolder);
		if (info.isDbtProject) {
			// Tell the Inngest dbt-scheduler function which folder to read schedules from.
			setCurrentFolder(resolvedFolder);
		}
		return json(info);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
