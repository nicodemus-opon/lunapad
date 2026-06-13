import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchCellEmbeddings, searchSchemaEmbeddings } from '$lib/server/embeddings.js';

export const POST: RequestHandler = async ({ request }) => {
	let body: { query?: string };
	try {
		body = (await request.json()) as { query?: string };
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body.query?.trim()) {
		return json({ error: 'query required' }, { status: 400 });
	}

	const [cells, tables] = await Promise.all([
		searchCellEmbeddings(body.query, 5),
		searchSchemaEmbeddings(body.query, 5)
	]);

	return json({ cells, tables });
};
