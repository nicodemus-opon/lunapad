import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAgentSession } from '$lib/server/agent-sessions.js';
import { listAgentTools } from '$lib/agent/tools/registry.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { prompt?: string; mode?: 'investigation' | 'full' };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const mode = body.mode ?? 'investigation';
	if (mode === 'full') {
		return json(
			{ error: 'Full mutation mode requires workspace concurrency — use investigation mode' },
			{ status: 501 }
		);
	}

	const session = await createAgentSession({
		userId: locals.user.id,
		mode,
		prompt: body.prompt,
		metadata: {
			allowedTools: listAgentTools({ mutates: false }).map((t) => t.name)
		}
	});

	return json({ session });
};
