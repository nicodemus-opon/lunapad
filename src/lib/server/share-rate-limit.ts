import { isRateLimitedShared } from './redis-rate-limit.js';

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

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
	return memIsRateLimited(key);
}

export async function isRateLimitedAsync(key: string): Promise<boolean> {
	return isRateLimitedShared(`share-rate:${key}`, MAX_REQUESTS_PER_WINDOW, WINDOW_MS);
}
