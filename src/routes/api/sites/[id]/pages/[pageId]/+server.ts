import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removePageFromSite, updatePage } from '$lib/server/sites';
import { requireSitesManage } from '$lib/server/share-guards';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const denied = requireSitesManage(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const body = (await request.json()) as Partial<{ pageSlug: string; navLabel: string }>;
	const pageId = Number(params.pageId);
	if (!Number.isInteger(pageId)) return json({ error: 'Invalid page id.' }, { status: 400 });
	try {
		const page = await updatePage(pageId, {
			...body,
			tenant: { orgId: locals.organization!.id, projectId: locals.project?.id }
		});
		return json({ page });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update page.';
		return json({ error: message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const denied = requireSitesManage(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const pageId = Number(params.pageId);
	if (!Number.isInteger(pageId)) return json({ error: 'Invalid page id.' }, { status: 400 });
	await removePageFromSite(pageId, {
		orgId: locals.organization!.id,
		projectId: locals.project?.id
	});
	return json({ ok: true });
};
