import { describe, expect, it } from 'vitest';
import { isRateLimitedAsync, shareRateLimitKey } from './share-rate-limit.js';

describe('share live-run rate limiting', () => {
	it('uses token, tenant, project, and IP in the limiter key', () => {
		const a = shareRateLimitKey({
			token: 'tok:1',
			ip: '203.0.113.1',
			orgId: 'org-1',
			projectId: 'project-1'
		});
		const b = shareRateLimitKey({
			token: 'tok:1',
			ip: '203.0.113.2',
			orgId: 'org-1',
			projectId: 'project-1'
		});
		expect(a).not.toBe(b);
		expect(a).toBe('org-1:project-1:tok_1:203.0.113.1');
	});

	it('limits one token/IP bucket without blocking a different IP bucket', async () => {
		const hotKey = shareRateLimitKey({
			token: `tok-${crypto.randomUUID()}`,
			ip: '203.0.113.10',
			orgId: 'org-1',
			projectId: 'project-1'
		});
		const otherKey = shareRateLimitKey({
			token: `tok-${crypto.randomUUID()}`,
			ip: '203.0.113.11',
			orgId: 'org-1',
			projectId: 'project-1'
		});

		for (let i = 0; i < 30; i += 1) {
			await expect(isRateLimitedAsync(hotKey)).resolves.toBe(false);
		}
		await expect(isRateLimitedAsync(hotKey)).resolves.toBe(true);
		await expect(isRateLimitedAsync(otherKey)).resolves.toBe(false);
	});
});
