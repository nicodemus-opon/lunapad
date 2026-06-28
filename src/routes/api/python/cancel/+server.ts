import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelPythonJob } from '$lib/server/python-runner';

export const POST: RequestHandler = async ({ request }) => {
	const { jobId, notebookId } = (await request.json()) as {
		jobId?: string;
		notebookId?: string;
	};
	if (typeof jobId !== 'string' || typeof notebookId !== 'string')
		return json({ error: 'jobId and notebookId are required' }, { status: 400 });

	cancelPythonJob(notebookId, jobId);
	return json({ ok: true });
};
