import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSafeOutboundHttpUrl, normalizeSafeLlmBaseUrl } from './safe-outbound-url';

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('safe outbound URLs', () => {
	it('allows public HTTPS URLs', () => {
		expect(assertSafeOutboundHttpUrl('https://api.example.com/v1').toString()).toBe(
			'https://api.example.com/v1'
		);
	});

	it('blocks localhost/private URLs in production', () => {
		vi.stubEnv('NODE_ENV', 'production');
		expect(() => assertSafeOutboundHttpUrl('http://localhost:11434')).toThrow('HTTPS');
		expect(() => assertSafeOutboundHttpUrl('https://127.0.0.1:8443')).toThrow('private');
		expect(() => assertSafeOutboundHttpUrl('https://192.168.0.10')).toThrow('private');
		expect(() => assertSafeOutboundHttpUrl('https://[::1]:8443')).toThrow('private');
	});

	it('allows localhost HTTP only for development LLM endpoints', () => {
		vi.stubEnv('NODE_ENV', 'development');
		expect(
			assertSafeOutboundHttpUrl('http://localhost:11434', { allowLocalhostInDev: true }).toString()
		).toBe('http://localhost:11434/');
	});

	it('blocks URL credentials', () => {
		expect(() => assertSafeOutboundHttpUrl('https://user:pass@example.com')).toThrow('credentials');
	});

	it('normalizes LLM base URLs after validation', () => {
		expect(normalizeSafeLlmBaseUrl('https://api.example.com')).toBe('https://api.example.com/v1');
		expect(normalizeSafeLlmBaseUrl('https://api.example.com/v2')).toBe(
			'https://api.example.com/v2'
		);
	});
});
