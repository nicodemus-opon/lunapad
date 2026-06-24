/**
 * In-memory per-key rate limit for the /api/v1 and /api/mcp surfaces. Resets on server
 * restart and is per-instance only (no shared store) — same trade-off as
 * share-rate-limit.ts, kept as a separate module since the risk profile differs:
 * authenticated API keys (this file) vs. unauthenticated public share links (that file).
 */

const windows = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(key: string, maxRequests: number, windowMs = 60_000): boolean {
	const now = Date.now();
	const entry = windows.get(key);
	if (!entry || now - entry.windowStart >= windowMs) {
		windows.set(key, { count: 1, windowStart: now });
		return false;
	}
	entry.count += 1;
	return entry.count > maxRequests;
}
