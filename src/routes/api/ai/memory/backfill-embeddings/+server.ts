import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertTenantProjectFolder } from '$lib/server/project-folders.js';
import { backfillMemoryEmbeddings } from '$lib/server/ai-memory.js';

// Best-effort, idempotent — see backfillMemoryEmbeddings for why re-running this is safe.
// Called fire-and-forget from the client once per folder-open when Postgres+Ollama are
// both available (see loadProjectMemoryIfNeeded in ai-chat-client.ts).
export const POST: RequestHandler = async ({ request, locals }) => {
	const { folder: requestedFolder } = (await request.json()) as { folder?: string };
	if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });

	try {
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		const result = await backfillMemoryEmbeddings(folder);
		return json(result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
