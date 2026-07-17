import { isRateLimitedShared } from './redis-rate-limit.js';

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

export async function isRateLimitedAsync(
	key: string,
	maxRequests: number,
	windowMs = 60_000
): Promise<boolean> {
	return isRateLimitedShared(`api-rate:${key}`, maxRequests, windowMs);
}
