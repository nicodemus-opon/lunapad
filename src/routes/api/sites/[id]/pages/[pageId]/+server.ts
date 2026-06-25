import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removePageFromSite, updatePage } from '$lib/server/sites';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json()) as Partial<{ pageSlug: string; navLabel: string }>;
	const pageId = Number(params.pageId);
	if (!Number.isInteger(pageId)) return json({ error: 'Invalid page id.' }, { status: 400 });
	try {
		const page = await updatePage(pageId, body);
		return json({ page });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update page.';
		return json({ error: message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const pageId = Number(params.pageId);
	if (!Number.isInteger(pageId)) return json({ error: 'Invalid page id.' }, { status: 400 });
	await removePageFromSite(pageId);
	return json({ ok: true });
};
