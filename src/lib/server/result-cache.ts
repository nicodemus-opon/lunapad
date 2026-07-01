import { createHash } from 'node:crypto';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

// ---- Redis backend ----

let redisClient: Redis | null = null;

if (REDIS_URL) {
	redisClient = new Redis(REDIS_URL, {
		lazyConnect: false,
		maxRetriesPerRequest: 3,
		retryStrategy: (times) => Math.min(times * 100, 3000),
		enableOfflineQueue: false
	});
	redisClient.on('connect', () => console.log('[result-cache] connected to Redis'));
	redisClient.on('error', (err: Error) =>
		console.error('[result-cache] Redis error:', err.message)
	);
}

// ---- In-memory fallback (dev without Docker) ----

interface MemEntry {
	value: string;
	expiresAt: number;
}

const MEM_MAX = 200;
const memCache = new Map<string, MemEntry>();

function memGet(key: string): string | null {
	const entry = memCache.get(key);
	if (!entry) return null;
	if (Date.now() > entry.expiresAt) {
		memCache.delete(key);
		return null;
	}
	return entry.value;
}

function memSet(key: string, value: string, ttlMs: number): void {
	if (memCache.size >= MEM_MAX) {
		// evict oldest
		memCache.delete(memCache.keys().next().value!);
	}
	memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ---- Public API ----

export function makeQueryCacheKey(shareToken: string, cellId: string, sql: string): string {
	const hash = createHash('sha256').update(sql).digest('hex');
	return `report-cell:${shareToken}:${cellId}:${hash}`;
}

export async function getCachedResult(key: string): Promise<unknown | null> {
	try {
		if (redisClient) {
			const raw = await redisClient.get(key);
			return raw ? (JSON.parse(raw) as unknown) : null;
		}
		const raw = memGet(key);
		return raw ? (JSON.parse(raw) as unknown) : null;
	} catch {
		return null;
	}
}

export async function setCachedResult(key: string, value: unknown, ttlMs: number): Promise<void> {
	try {
		const serialized = JSON.stringify(value);
		if (redisClient) {
			await redisClient.set(key, serialized, 'PX', ttlMs);
			return;
		}
		memSet(key, serialized, ttlMs);
	} catch {
		// never let cache failures break query execution
	}
}
