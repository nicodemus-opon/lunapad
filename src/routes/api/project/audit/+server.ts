import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertSafe } from '$lib/server/project';
import { auditAndFixProjectYmls } from '$lib/server/project';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder } = (await request.json()) as { folder?: string };
		if (!folder) return json({ error: 'folder is required' }, { status: 400 });
		const resolvedFolder = assertTenantProjectFolder(locals, folder);
		assertSafe(resolvedFolder, resolvedFolder);
		const result = await auditAndFixProjectYmls(resolvedFolder);
		return json(result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
