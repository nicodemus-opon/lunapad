import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scaffoldDbtProject } from '$lib/server/project';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder, name } = (await request.json()) as { folder?: string; name?: string };
		if (!folder || !name) return json({ error: 'folder and name are required' }, { status: 400 });
		const resolvedFolder = assertTenantProjectFolder(locals, folder);
		await scaffoldDbtProject(resolvedFolder, name);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
