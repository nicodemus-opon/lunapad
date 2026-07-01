import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { completeBridgeWait, getAgentSession } from '$lib/server/agent-sessions.js';

/**
 * Browser bridge RPC — client executes DuckDB WASM / live notebook tools when a
 * server-side agent session needs client-only executors.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const session = await getAgentSession(params.id, locals.user.id);
	if (!session) return json({ error: 'Not found' }, { status: 404 });

	let body: { toolCallId?: string; result?: unknown; error?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body.toolCallId) return json({ error: 'toolCallId required' }, { status: 400 });

	if (body.error) {
		completeBridgeWait(params.id, body.toolCallId, { error: body.error });
		return json({ ok: true });
	}

	const ok = completeBridgeWait(params.id, body.toolCallId, body.result ?? null);
	if (!ok) return json({ error: 'No pending bridge request' }, { status: 404 });
	return json({ ok: true });
};
