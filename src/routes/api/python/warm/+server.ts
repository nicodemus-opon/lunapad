import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isWorkerWarm } from '$lib/server/python-runner';

export const GET: RequestHandler = async ({ url }) => {
	const notebookId = url.searchParams.get('notebookId') ?? '';
	return json({ warm: isWorkerWarm(notebookId) });
};
