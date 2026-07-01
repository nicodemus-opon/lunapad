import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShareByToken } from '$lib/server/shared-reports';
import { runShareLiveCell } from '$lib/server/share-run';

interface RunRequest {
	cellId: string;
	filters?: Record<string, string>;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const token = params.token;
	const share = await getShareByToken(token);
	if (share?.requireAuth && !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as Partial<RunRequest>;
	if (!body?.cellId) return json({ error: 'cellId is required.' }, { status: 400 });

	const result = await runShareLiveCell(token, body.cellId, body.filters ?? {});
	if ('error' in result) return json({ error: result.error }, { status: result.status });
	return json(result);
};
