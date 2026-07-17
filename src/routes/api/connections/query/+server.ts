import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Connection } from '$lib/types/connection';
import { queryExternalConnection } from '$lib/server/connections';
import { getSecret } from '$lib/server/connection-secrets';
import { registerQuery, unregisterQuery } from '$lib/server/query-registry';
import { resolveConnectionMetadata } from '$lib/server/connection-metadata';
import { getCloudExecutionAdapter } from '$lib/server/cloud-execution';
import { listConnectionsMetadata } from '$lib/server/connections-store';
import { assertCloudTenantRef } from '$lib/server/tenancy';

interface QueryConnectionRequest {
	connection: Connection;
	sql: string;
	runId?: string;
}

function combineAbortSignals(primary: AbortSignal, secondary: AbortSignal): AbortSignal {
	if (primary === secondary) return primary;
	if (typeof AbortSignal.any === 'function') return AbortSignal.any([primary, secondary]);
	const controller = new AbortController();
	const abort = (signal: AbortSignal) => () => controller.abort(signal.reason);
	if (primary.aborted) controller.abort(primary.reason);
	else primary.addEventListener('abort', abort(primary), { once: true });
	if (secondary.aborted) controller.abort(secondary.reason);
	else secondary.addEventListener('abort', abort(secondary), { once: true });
	return controller.signal;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json()) as Partial<QueryConnectionRequest>;
	if (!body?.connection || typeof body.sql !== 'string') {
		return json({ error: 'Connection and SQL payload are required.' }, { status: 400 });
	}

	const { runId } = body;
	const controller = runId ? registerQuery(runId) : new AbortController();
	try {
		assertCloudTenantRef({ orgId: locals.organization?.id ?? '' }, 'Querying a connection');
		const adapter = getCloudExecutionAdapter();
		const execution = await adapter.submit({
			tenant: { orgId: locals.organization!.id, projectId: locals.project?.id },
			userId: locals.user?.id,
			kind: 'query',
			timeoutMs: 60_000,
			quotaKey: 'external_query',
			requestId: locals.requestId,
			entitlements: locals.entitlements,
			payload: { connectionId: body.connection.id, sql: body.sql, runId },
			run: async (_job, signal) => {
				const connection = await resolveConnectionMetadata(
					body.connection!,
					locals.organization?.id
				);
				if (!connection) throw new Error('Unknown connection.');
				const secret = await getSecret(connection.id, locals.organization?.id);
				const availableConnections = await listConnectionsMetadata(locals.organization!.id, {
					includePhysicalCatalogName: true
				});
				return queryExternalConnection(
					connection,
					secret ?? undefined,
					body.sql!,
					combineAbortSignals(controller.signal, signal),
					locals.organization!.id,
					availableConnections
				);
			}
		});
		if (execution.queued) return json({ job: execution.job }, { status: 202 });
		return json(execution.result);
	} catch (err) {
		if ((err as Error)?.name === 'AbortError') {
			return json({ error: 'Query cancelled' }, { status: 499 });
		}
		const message = err instanceof Error ? err.message : 'Failed to query connection.';
		return json({ error: message }, { status: 400 });
	} finally {
		if (runId) unregisterQuery(runId);
	}
};
