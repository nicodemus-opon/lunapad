import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isPythonEnvReady } from '$lib/server/python-runner';

export const GET: RequestHandler = async () => {
	return json({ ready: isPythonEnvReady() });
};
