import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listShareVersions } from '$lib/server/shared-reports';

export const GET: RequestHandler = async ({ params }) => {
	const versions = await listShareVersions(params.token);
	return json({ versions });
};
