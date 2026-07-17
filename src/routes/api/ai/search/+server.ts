import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	searchCellEmbeddings,
	searchSchemaEmbeddings,
	searchMemoryEmbeddings
} from '$lib/server/embeddings.js';
import { searchMemoryLexical } from '$lib/server/ai-memory.js';
import { assertTenantProjectFolder } from '$lib/server/project-folders.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: { query?: string; folder?: string };
	try {
		body = (await request.json()) as { query?: string; folder?: string };
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body.query?.trim()) {
		return json({ error: 'query required' }, { status: 400 });
	}

	if (body.folder) {
		try {
			body.folder = assertTenantProjectFolder(locals, body.folder);
		} catch (err) {
			return json({ error: (err as Error).message }, { status: 403 });
		}
	}

	const [cells, tables, memories] = await Promise.all([
		searchCellEmbeddings(body.query, 5, {
			orgId: locals.organization!.id,
			projectId: locals.project?.id
		}),
		searchSchemaEmbeddings(body.query, 5, undefined, {
			orgId: locals.organization!.id,
			projectId: locals.project?.id
		}),
		searchMemoryForFolder(body.query, body.folder, {
			orgId: locals.organization!.id,
			projectId: locals.project?.id
		})
	]);

	return json({ cells, tables, memories });
};

// Postgres+Ollama embeddings are the primary path (consistent with cell/schema search above),
// but a plain local dbt project with no Postgres configured is the common case this feature
// targets — fall back to lexical keyword overlap over the on-disk index rather than returning
// nothing.
async function searchMemoryForFolder(
	query: string,
	folder: string | undefined,
	tenant: { orgId: string; projectId?: string | null }
): Promise<Array<{ slug: string; description: string; type: string; similarity: number }>> {
	if (!folder) return [];
	const embedded = await searchMemoryEmbeddings(query, folder, 5, tenant);
	if (embedded.length > 0) return embedded;
	return searchMemoryLexical(folder, query, 5);
}
