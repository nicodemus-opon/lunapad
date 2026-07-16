import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadWorkspaceState, resolveWorkspaceUpdatedBy } from '$lib/server/workspace-store';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const row = await loadWorkspaceState(locals.project?.id);
		return json({
			data: row?.data ?? null,
			updatedAt: row?.updatedAt ?? null,
			updatedBy: await resolveWorkspaceUpdatedBy(row?.updatedBy ?? null)
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load workspace state.';
		return json({ error: message }, { status: 503 });
	}
};
