import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { detectProject } from '$lib/server/project';
import { setCurrentFolder } from '$lib/server/dbt-schedules';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { folder } = (await request.json()) as { folder?: string };
		if (!folder || typeof folder !== 'string') {
			return json({ error: 'folder is required' }, { status: 400 });
		}
		const info = await detectProject(folder);
		if (info.isDbtProject) {
			// Tell the Inngest dbt-scheduler function which folder to read schedules from.
			setCurrentFolder(folder);
		}
		return json(info);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
