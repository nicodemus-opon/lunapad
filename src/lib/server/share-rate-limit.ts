import { query } from './db.js';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

let redisClient: Redis | null = null;
if (REDIS_URL) {
	redisClient = new Redis(REDIS_URL, {
		lazyConnect: false,
		maxRetriesPerRequest: 3,
		retryStrategy: (times) => Math.min(times * 100, 3000),
		enableOfflineQueue: false
	});
}

const windows = new Map<string, { count: number; windowStart: number }>();

function memIsRateLimited(token: string): boolean {
	const now = Date.now();
	const entry = windows.get(token);
	if (!entry || now - entry.windowStart >= WINDOW_MS) {
		windows.set(token, { count: 1, windowStart: now });
		return false;
	}
	entry.count += 1;
	return entry.count > MAX_REQUESTS_PER_WINDOW;
}

export function isRateLimited(token: string): boolean {
	if (redisClient) {
		// Sync fallback when Redis is configured but async isn't available in the call path.
		// The async variant is used by the run endpoint when possible.
		return memIsRateLimited(token);
	}
	return memIsRateLimited(token);
}

export async function isRateLimitedAsync(token: string): Promise<boolean> {
	if (redisClient) {
		try {
			const key = `share-rate:${token}`;
			const count = await redisClient.incr(key);
			if (count === 1) await redisClient.pexpire(key, WINDOW_MS);
			return count > MAX_REQUESTS_PER_WINDOW;
		} catch {
			return memIsRateLimited(token);
		}
	}
	return memIsRateLimited(token);
}
