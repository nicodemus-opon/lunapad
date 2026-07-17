import Redis from 'ioredis';

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
	const url = process.env.REDIS_URL;
	if (!url) return null;
	if (!redisClient) {
		redisClient = new Redis(url, {
			lazyConnect: false,
			maxRetriesPerRequest: 2,
			retryStrategy: (times) => Math.min(times * 100, 1000),
			enableOfflineQueue: false
		});
	}
	return redisClient;
}

const memoryWindows = new Map<string, { count: number; windowStart: number }>();

function memoryLimited(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();
	const existing = memoryWindows.get(key);
	if (!existing || now - existing.windowStart >= windowMs) {
		memoryWindows.set(key, { count: 1, windowStart: now });
		return false;
	}
	existing.count += 1;
	return existing.count > limit;
}

export async function isRateLimitedShared(
	key: string,
	limit: number,
	windowMs = 60_000
): Promise<boolean> {
	const redis = getRedis();
	if (!redis) return memoryLimited(key, limit, windowMs);
	try {
		const count = await redis.incr(key);
		if (count === 1) await redis.pexpire(key, windowMs);
		return count > limit;
	} catch {
		return memoryLimited(key, limit, windowMs);
	}
}

export function rateLimitIp(request: Request): string {
	return (
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
		request.headers.get('x-real-ip') ||
		'unknown'
	).replaceAll(':', '_');
}

export async function checkRedisHealth(): Promise<'ok' | 'not_configured'> {
	const redis = getRedis();
	if (!redis) return 'not_configured';
	await redis.ping();
	return 'ok';
}
