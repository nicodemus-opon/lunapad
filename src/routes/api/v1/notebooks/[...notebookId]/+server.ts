import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNotebookAction } from '$lib/server/lunapad-actions';
import { isRateLimited } from '$lib/server/api-rate-limit';

// Notebook ids are project-relative paths (e.g. "models/staging/stg_orders"), hence the
// `[...notebookId]` rest parameter rather than a single dynamic segment.
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const folder = url.searchParams.get('folder') ?? undefined;
		return json(await getNotebookAction({ folder, notebookId: params.notebookId }));
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
