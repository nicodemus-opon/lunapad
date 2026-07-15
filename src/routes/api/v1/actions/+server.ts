import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';

export const GET: RequestHandler = async ({ locals, request }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		return agentActionResponse({ locals, request }, 'list_capabilities', {});
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json()) as {
			action?: string;
			input?: Record<string, unknown>;
			dryRun?: boolean;
		};
		if (!body.action) return json({ error: 'action is required' }, { status: 400 });
		return agentActionResponse({ locals, request }, body.action, body.input ?? {}, {
			dryRun: body.dryRun
		});
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
