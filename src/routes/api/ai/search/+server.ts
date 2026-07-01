import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	searchCellEmbeddings,
	searchSchemaEmbeddings,
	searchMemoryEmbeddings
} from '$lib/server/embeddings.js';
import { searchMemoryLexical } from '$lib/server/ai-memory.js';

export const POST: RequestHandler = async ({ request }) => {
	let body: { query?: string; folder?: string };
	try {
		body = (await request.json()) as { query?: string; folder?: string };
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body.query?.trim()) {
		return json({ error: 'query required' }, { status: 400 });
	}

	const [cells, tables, memories] = await Promise.all([
		searchCellEmbeddings(body.query, 5),
		searchSchemaEmbeddings(body.query, 5),
		searchMemoryForFolder(body.query, body.folder)
	]);

	return json({ cells, tables, memories });
};

// Postgres+Ollama embeddings are the primary path (consistent with cell/schema search above),
// but a plain local dbt project with no Postgres configured is the common case this feature
// targets — fall back to lexical keyword overlap over the on-disk index rather than returning
// nothing.
async function searchMemoryForFolder(
	query: string,
	folder: string | undefined
): Promise<Array<{ slug: string; description: string; type: string; similarity: number }>> {
	if (!folder) return [];
	const embedded = await searchMemoryEmbeddings(query, folder, 5);
	if (embedded.length > 0) return embedded;
	return searchMemoryLexical(folder, query, 5);
}
