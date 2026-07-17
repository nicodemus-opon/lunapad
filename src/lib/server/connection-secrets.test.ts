import { describe, expect, it } from 'vitest';
import { parseEncryptionKey } from './connection-secrets.js';

describe('connection secret encryption key parsing', () => {
	it('accepts a 32-byte base64 key', () => {
		expect(parseEncryptionKey(Buffer.alloc(32, 1).toString('base64'))).toHaveLength(32);
	});

	it('accepts a Coolify-style 64-character hex key', () => {
		expect(parseEncryptionKey('a'.repeat(64))).toHaveLength(32);
	});
});
