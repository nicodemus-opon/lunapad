/**
 * Server-side registry of in-flight external DB queries.
 * Each query gets a client-generated runId; cancel POSTs to /api/connections/cancel
 * abort the associated controller, which propagates to the DB-side fetch/query.
 * This is necessary because Vite's dev proxy does not propagate request.signal when
 * the browser aborts a fetch.
 */

const registry = new Map<string, AbortController>();

// Worst-case TTL: if a client disconnects without calling cancel or the
// request handler errors before its finally block, this prevents the map
// growing unboundedly over a long-running server session.
const QUERY_TTL_MS = 120_000;

export function registerQuery(runId: string): AbortController {
	const controller = new AbortController();
	registry.set(runId, controller);
	setTimeout(() => registry.delete(runId), QUERY_TTL_MS);
	return controller;
}

export function cancelQuery(runId: string): boolean {
	const controller = registry.get(runId);
	if (!controller) return false;
	controller.abort();
	registry.delete(runId);
	return true;
}

export function unregisterQuery(runId: string): void {
	registry.delete(runId);
}
