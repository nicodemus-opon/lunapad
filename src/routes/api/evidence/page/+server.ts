import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readEvidencePage, writeEvidencePage } from '$lib/server/evidence';
import { assertSafe } from '$lib/server/project';

export const GET: RequestHandler = async ({ url }) => {
	const folder = url.searchParams.get('folder');
	const pagePath = url.searchParams.get('path');
	if (!folder || !pagePath) return json({ error: 'folder and path are required' }, { status: 400 });
	try {
		assertSafe(folder, `${folder}/${pagePath}`);
		const content = await readEvidencePage(folder, pagePath);
		return json({ content });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { folder, path: pagePath, content } = (await request.json()) as {
			folder?: string;
			path?: string;
			content?: string;
		};
		if (!folder || !pagePath || content === undefined)
			return json({ error: 'folder, path and content are required' }, { status: 400 });
		assertSafe(folder, `${folder}/${pagePath}`);
		await writeEvidencePage(folder, pagePath, content);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};
