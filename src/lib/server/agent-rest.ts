import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { executeAgentAction, type ActionEnvelope } from './agent-actions.js';
import { userFromLocals } from './permissions.js';

export async function agentActionResponse(
	event: Pick<RequestEvent, 'locals' | 'request'>,
	action: string,
	input: Record<string, unknown>,
	opts: { dryRun?: boolean } = {}
): Promise<Response> {
	const idempotencyKey = event.request.headers.get('Idempotency-Key') ?? undefined;
	const requestId = event.locals.requestId;
	const result = await executeAgentAction(
		action,
		input,
		{
			user: userFromLocals(event.locals.user),
			apiKeyId: event.locals.apiKeyId,
			apiKeyScopes: event.locals.apiKeyScopes,
			tenant: event.locals.organization
				? { orgId: event.locals.organization.id, projectId: event.locals.project?.id }
				: undefined,
			entitlements: event.locals.entitlements
		},
		{ idempotencyKey, requestId, dryRun: opts.dryRun }
	);
	return agentEnvelopeResponse(result);
}

export function agentEnvelopeResponse(result: ActionEnvelope): Response {
	const status = result.ok
		? 200
		: result.diagnostics.some((d) => d.code === 'FORBIDDEN')
			? 403
			: 422;
	return json(result, { status });
}
