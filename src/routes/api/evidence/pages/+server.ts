import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEvidencePages } from '$lib/server/evidence';

export const GET: RequestHandler = async ({ url }) => {
	const folder = url.searchParams.get('folder');
	if (!folder) return json({ error: 'folder is required' }, { status: 400 });
	try {
		const pages = await listEvidencePages(folder);
		return json({ pages });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};
