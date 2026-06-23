import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hasAnyUser } from '$lib/server/auth';

export const GET: RequestHandler = async () => {
	return json({ needsSetup: !(await hasAnyUser()) });
};
