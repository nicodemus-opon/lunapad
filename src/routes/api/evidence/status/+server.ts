import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRunningJob } from '$lib/server/evidence-runner';

export const GET: RequestHandler = () => {
	const running = getRunningJob();
	if (!running) return json({ running: false, port: null, jobId: null });
	return json({ running: true, port: running.port, jobId: running.jobId });
};
