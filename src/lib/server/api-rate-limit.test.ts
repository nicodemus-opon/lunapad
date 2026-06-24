import { describe, expect, it, vi } from 'vitest';
import { isRateLimited } from './api-rate-limit';

describe('isRateLimited', () => {
	it('allows requests up to the limit, rejects the next one', () => {
		const key = `test-${Math.random()}`;
		for (let i = 0; i < 5; i++) {
			expect(isRateLimited(key, 5)).toBe(false);
		}
		expect(isRateLimited(key, 5)).toBe(true);
	});

	it('resets the count once the window has elapsed', () => {
		vi.useFakeTimers();
		try {
			const key = `test-${Math.random()}`;
			for (let i = 0; i < 3; i++) isRateLimited(key, 3, 1000);
			expect(isRateLimited(key, 3, 1000)).toBe(true);
			vi.advanceTimersByTime(1001);
			expect(isRateLimited(key, 3, 1000)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not share buckets between different keys', () => {
		const keyA = `a-${Math.random()}`;
		const keyB = `b-${Math.random()}`;
		for (let i = 0; i < 5; i++) isRateLimited(keyA, 5);
		expect(isRateLimited(keyA, 5)).toBe(true);
		expect(isRateLimited(keyB, 5)).toBe(false);
	});
});
