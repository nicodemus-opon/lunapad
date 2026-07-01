import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canUseAITool, userFromLocals } from '$lib/server/permissions.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { tool?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const tool = body.tool;
	if (!tool || typeof tool !== 'string') {
		return json({ error: 'tool is required' }, { status: 400 });
	}

	const user = userFromLocals(locals.user);
	const allowed = canUseAITool(user, tool);

	return json({
		allowed,
		tool,
		reason: allowed ? undefined : 'Insufficient permissions for this AI tool'
	});
};
