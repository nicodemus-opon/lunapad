import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addPageToSite, reorderPages } from '$lib/server/sites';
import { getShareByToken } from '$lib/server/shared-reports';
import { requireSitesManage } from '$lib/server/share-guards';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const denied = requireSitesManage(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const body = (await request.json()) as Partial<{
		pageSlug: string;
		navLabel: string;
		shareToken: string;
		notebookId: string;
	}>;
	if (!body?.pageSlug || !body?.navLabel || !body?.shareToken) {
		return json({ error: 'pageSlug, navLabel, and shareToken are required.' }, { status: 400 });
	}
	const share = await getShareByToken(body.shareToken);
	try {
		const page = await addPageToSite({
			siteId: params.id,
			pageSlug: body.pageSlug,
			navLabel: body.navLabel,
			shareToken: body.shareToken,
			notebookId: body.notebookId ?? share?.notebookId ?? null
		});
		return json({ page });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to add page.';
		return json({ error: message }, { status: 400 });
	}
};

/** Body: `{ orderedPageIds: number[] }` — full new order for every page in this site. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const denied = requireSitesManage(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const body = (await request.json()) as Partial<{ orderedPageIds: number[] }>;
	if (!Array.isArray(body?.orderedPageIds))
		return json({ error: 'orderedPageIds is required.' }, { status: 400 });
	await reorderPages(params.id, body.orderedPageIds);
	return json({ ok: true });
};
