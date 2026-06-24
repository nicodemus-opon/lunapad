import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveWorkspaceState } from '$lib/server/workspace-store';

interface SaveWorkspaceRequest {
	data: unknown;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json()) as Partial<SaveWorkspaceRequest>;
	if (!body || typeof body !== 'object' || !('data' in body)) {
		return json({ error: 'Workspace payload is required.' }, { status: 400 });
	}
	try {
		await saveWorkspaceState(body.data, locals.user?.id ?? null);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to save workspace state.';
		return json({ error: message }, { status: 503 });
	}
};
