import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { inngest } from '$lib/inngest/client';
import {
	writeEntry,
	removeEntry,
	readIndexEntries,
	readConventions,
	writeConventions,
	type MemoryEntryType
} from '$lib/server/ai-memory.js';

export const GET: RequestHandler = async ({ url }) => {
	const folder = url.searchParams.get('folder');
	if (!folder) return json({ error: 'folder is required' }, { status: 400 });

	const [conventions, entries] = await Promise.all([readConventions(folder), readIndexEntries(folder)]);
	return json({ conventions, entries });
};

export const POST: RequestHandler = async ({ request }) => {
	const { folder, type, text } = (await request.json()) as {
		folder?: string;
		type?: MemoryEntryType;
		text?: string;
	};
	if (!folder || !text?.trim()) {
		return json({ error: 'folder and text are required' }, { status: 400 });
	}

	try {
		const { slug, entries } = await writeEntry(folder, { type: type === 'discovery' ? 'discovery' : 'decision', text });

		// Best-effort — embeddings are an enhancement, not a requirement (Postgres/Ollama may not
		// be configured at all for a plain local project; the lexical fallback in /api/ai/search
		// covers that case).
		try {
			await inngest.send({
				name: 'ai/embed-memory',
				data: { folder, slug, type: type ?? 'decision', description: text.trim().slice(0, 2000) }
			});
		} catch (err) {
			console.error('[memory] inngest.send failed:', err);
		}

		return json({ slug, entries });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { folder, slug } = (await request.json()) as { folder?: string; slug?: string };
	if (!folder || !slug) return json({ error: 'folder and slug are required' }, { status: 400 });

	try {
		const entries = await removeEntry(folder, slug);
		return json({ entries });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	const { folder, conventions } = (await request.json()) as { folder?: string; conventions?: string };
	if (!folder || typeof conventions !== 'string') {
		return json({ error: 'folder and conventions are required' }, { status: 400 });
	}

	try {
		await writeConventions(folder, conventions);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
