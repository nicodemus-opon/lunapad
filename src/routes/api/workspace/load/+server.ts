import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadWorkspaceState } from '$lib/server/workspace-store';

export const GET: RequestHandler = async () => {
	try {
		const row = await loadWorkspaceState();
		return json({ data: row?.data ?? null, updatedAt: row?.updatedAt ?? null });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load workspace state.';
		return json({ error: message }, { status: 503 });
	}
};
