import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertSafe } from '$lib/server/project';
import { backfillColumnsFromManifest } from '$lib/server/dbt';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder: requestedFolder } = (await request.json()) as { folder?: string };
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		assertSafe(folder, folder);
		await backfillColumnsFromManifest(folder);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
