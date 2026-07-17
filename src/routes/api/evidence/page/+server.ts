import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readEvidencePage, writeEvidencePage } from '$lib/server/evidence';
import { assertSafe } from '$lib/server/project';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const GET: RequestHandler = async ({ url, locals }) => {
	const requestedFolder = url.searchParams.get('folder');
	const pagePath = url.searchParams.get('path');
	if (!requestedFolder || !pagePath)
		return json({ error: 'folder and path are required' }, { status: 400 });
	try {
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		assertSafe(folder, `${folder}/${pagePath}`);
		const content = await readEvidencePage(folder, pagePath);
		return json({ content });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const {
			folder: requestedFolder,
			path: pagePath,
			content
		} = (await request.json()) as {
			folder?: string;
			path?: string;
			content?: string;
		};
		if (!requestedFolder || !pagePath || content === undefined)
			return json({ error: 'folder, path and content are required' }, { status: 400 });
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		assertSafe(folder, `${folder}/${pagePath}`);
		await writeEvidencePage(folder, pagePath, content);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};
