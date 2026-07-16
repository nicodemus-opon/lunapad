import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { countOpenThreadsForCell, countOpenThreadsForNotebook } from '$lib/server/comments';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const notebookId = url.searchParams.get('notebookId');
	const cellId = url.searchParams.get('cellId');
	if (cellId) {
		return json({
			count: await countOpenThreadsForCell(cellId, {
				orgId: locals.organization?.id,
				projectId: locals.project?.id
			})
		});
	}
	if (notebookId) {
		return json({
			count: await countOpenThreadsForNotebook(notebookId, {
				orgId: locals.organization?.id,
				projectId: locals.project?.id
			})
		});
	}
	return json({ error: 'notebookId or cellId required' }, { status: 400 });
};
