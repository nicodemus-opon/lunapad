import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hasPostgres, hasOllama } from '$lib/server/ai-capabilities.js';
import { query } from '$lib/server/db.js';
import { listMemoryEmbeddedSlugs } from '$lib/server/embeddings.js';
import { readIndexEntries } from '$lib/server/ai-memory.js';

import type { ContextHealthResponse } from '$lib/agent/types/context-health.js';

export const GET: RequestHandler = async ({ url }) => {
	const issues: string[] = [];
	const folder = url.searchParams.get('folder');

	const [postgres, ollama] = await Promise.all([hasPostgres(), hasOllama()]);
	const rag = postgres && ollama;
	if (!postgres) issues.push('Postgres unavailable — semantic search and memory disabled');
	if (!ollama) issues.push('Ollama unavailable — schema embeddings disabled');
	if (!rag) issues.push('RAG degraded — using truncated client schema');

	let memory = false;
	if (postgres) {
		try {
			await query('SELECT 1 FROM memory_embeddings LIMIT 1');
			memory = true;
		} catch {
			issues.push('memory_embeddings table missing — workspace memory disabled');
		}
	}

	let patterns = false;
	if (postgres) {
		try {
			const rows = await query<{ count: string }>(
				`SELECT COUNT(*)::text AS count FROM workspace_patterns WHERE recorded_at > NOW() - INTERVAL '30 days'`
			);
			patterns = Number(rows[0]?.count ?? 0) > 0;
			if (!patterns) issues.push('No edit-outcome patterns yet — feedback loop warming up');
		} catch {
			issues.push('workspace_patterns unavailable');
		}
	}

	let memoryCoverage: ContextHealthResponse['memoryCoverage'];
	if (memory && folder) {
		try {
			const [entries, embeddedSlugs] = await Promise.all([
				readIndexEntries(folder),
				listMemoryEmbeddedSlugs(folder)
			]);
			memoryCoverage = {
				embedded: entries.filter((e) => embeddedSlugs.has(e.slug)).length,
				total: entries.length
			};
		} catch {
			// folder not readable/allowed — omit coverage rather than fail the whole health check
		}
	}

	const response: ContextHealthResponse = {
		rag,
		memory,
		patterns,
		issues,
		...(memoryCoverage && { memoryCoverage })
	};
	return json(response);
};
