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

export function shareRateLimitKey(input: {
	token: string;
	ip?: string | null;
	orgId?: string | null;
	projectId?: string | null;
}): string {
	return [input.orgId ?? 'public', input.projectId ?? 'public', input.token, input.ip ?? 'unknown']
		.map((part) => part.replaceAll(':', '_'))
		.join(':');
}

function memIsRateLimited(key: string): boolean {
	const now = Date.now();
	const entry = windows.get(key);
	if (!entry || now - entry.windowStart >= WINDOW_MS) {
		windows.set(key, { count: 1, windowStart: now });
		return false;
	}
	entry.count += 1;
	return entry.count > MAX_REQUESTS_PER_WINDOW;
}

export function isRateLimited(key: string): boolean {
	if (redisClient) {
		// Sync fallback when Redis is configured but async isn't available in the call path.
		// The async variant is used by the run endpoint when possible.
		return memIsRateLimited(key);
	}
	return memIsRateLimited(key);
}

export async function isRateLimitedAsync(key: string): Promise<boolean> {
	if (redisClient) {
		try {
			const redisKey = `share-rate:${key}`;
			const count = await redisClient.incr(redisKey);
			if (count === 1) await redisClient.pexpire(redisKey, WINDOW_MS);
			return count > MAX_REQUESTS_PER_WINDOW;
		} catch {
			return memIsRateLimited(key);
		}
	}
	return memIsRateLimited(key);
}
