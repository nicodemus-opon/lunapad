/**
 * In-memory per-token rate limit for the public report run endpoint. Resets on server
 * restart and is per-instance only (no shared store) — acceptable for v1 since it's the
 * only abuse mitigation available for an unauthenticated, indefinitely-valid link.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

const windows = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(token: string): boolean {
	const now = Date.now();
	const entry = windows.get(token);
	if (!entry || now - entry.windowStart >= WINDOW_MS) {
		windows.set(token, { count: 1, windowStart: now });
		return false;
	}
	entry.count += 1;
	return entry.count > MAX_REQUESTS_PER_WINDOW;
}
