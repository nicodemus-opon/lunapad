import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('./db.js', () => ({ query: queryMock }));

import { createApiKey, listApiKeys, revokeApiKey, verifyApiKey, getUserById } from './api-keys';

interface FakeApiKeyRow {
	id: string;
	userId: string;
	orgId: string | null;
	projectId: string | null;
	name: string;
	keyHash: string;
	prefix: string;
	createdAt: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
	revokedAt: string | null;
	scopes: string[] | null;
}

interface FakeUserRow {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	createdAt: Date;
	updatedAt: Date;
	role: string | null;
	banned: boolean | null;
	banReason: string | null;
	banExpires: Date | null;
}

let apiKeyRows: FakeApiKeyRow[] = [];
let userRows: FakeUserRow[] = [];

function makeUserRow(overrides: Partial<FakeUserRow> = {}): FakeUserRow {
	return {
		id: 'user-1',
		name: 'Test User',
		email: 'test@example.com',
		emailVerified: true,
		image: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		role: 'admin',
		banned: false,
		banReason: null,
		banExpires: null,
		...overrides
	};
}

beforeEach(() => {
	apiKeyRows = [];
	userRows = [makeUserRow()];
	queryMock.mockReset();
	queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
		if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return [];
		if (sql.includes('ALTER TABLE')) return [];
		if (sql.includes('UPDATE "apiKey" SET "orgId"')) return [];
		if (sql.includes('INSERT INTO organizations')) {
			return [
				{
					id: 'default',
					name: 'Default organization',
					slug: 'default',
					plan: 'team',
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString()
				}
			];
		}
		if (sql.includes('INSERT INTO projects')) {
			return [
				{
					id: 'default',
					org_id: 'default',
					name: 'Default project',
					slug: 'default',
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString()
				}
			];
		}

		if (sql.includes('INSERT INTO "apiKey"')) {
			const [id, userId, orgId, projectId, name, keyHash, prefix, expiresAt, scopes] = params as [
				string,
				string,
				string,
				string,
				string,
				string,
				string,
				Date | null,
				string[] | null
			];
			const row: FakeApiKeyRow = {
				id,
				userId,
				orgId,
				projectId,
				name,
				keyHash,
				prefix,
				createdAt: new Date().toISOString(),
				lastUsedAt: null,
				expiresAt: expiresAt ? expiresAt.toISOString() : null,
				revokedAt: null,
				scopes
			};
			apiKeyRows.push(row);
			return [row];
		}

		if (sql.includes('FROM "apiKey" WHERE "userId" = $1 AND "orgId" = $2')) {
			const [userId, orgId] = params as [string, string];
			return apiKeyRows
				.filter((r) => r.userId === userId && r.orgId === orgId)
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		}

		if (sql.includes('FROM "apiKey" WHERE "keyHash" = $1')) {
			const [keyHash] = params as [string];
			return apiKeyRows.filter((r) => r.keyHash === keyHash);
		}

		if (sql.includes('UPDATE "apiKey" SET "revokedAt"')) {
			const [keyId, userId, orgId] = params as [string, string, string];
			for (const r of apiKeyRows) {
				if (r.id === keyId && r.userId === userId && r.orgId === orgId && !r.revokedAt) {
					r.revokedAt = new Date().toISOString();
				}
			}
			return [];
		}

		if (sql.includes('UPDATE "apiKey" SET "lastUsedAt"')) {
			const [keyId] = params as [string];
			for (const r of apiKeyRows) {
				if (r.id === keyId) r.lastUsedAt = new Date().toISOString();
			}
			return [];
		}

		if (sql.includes('FROM "user" WHERE "id"')) {
			const [userId] = params as [string];
			return userRows.filter((u) => u.id === userId);
		}

		throw new Error(`Unhandled query in test mock: ${sql}`);
	});
});

describe('createApiKey', () => {
	it('returns a full key matching the lp_live_ format and a record without the hash', async () => {
		const { record, fullKey } = await createApiKey('user-1', 'CI pipeline');
		expect(fullKey).toMatch(/^lp_live_[0-9A-Za-z]+$/);
		expect(record).not.toHaveProperty('keyHash');
		expect(record.userId).toBe('user-1');
		expect(record.name).toBe('CI pipeline');
		expect(record.revokedAt).toBeNull();
	});

	it('stores only the SHA-256 hash of the full key, never the raw key', async () => {
		const crypto = await import('node:crypto');
		const { fullKey } = await createApiKey('user-1', 'test key');
		const expectedHash = crypto.createHash('sha256').update(fullKey).digest('hex');
		expect(apiKeyRows[0].keyHash).toBe(expectedHash);
		expect(apiKeyRows[0].keyHash).not.toBe(fullKey);
	});
});

describe('verifyApiKey', () => {
	it('returns userId + apiKeyId for a freshly created key', async () => {
		const { record, fullKey } = await createApiKey('user-1', 'test key');
		const verified = await verifyApiKey(fullKey);
		expect(verified).toEqual({
			userId: 'user-1',
			apiKeyId: record.id,
			scopes: null,
			orgId: 'default',
			projectId: 'default'
		});
	});

	it('returns null for a garbage string', async () => {
		expect(await verifyApiKey('not-a-real-key')).toBeNull();
	});

	it('returns null for a key with the wrong prefix', async () => {
		await createApiKey('user-1', 'test key');
		expect(await verifyApiKey('sk_live_someotherprefix')).toBeNull();
	});

	it('returns null for a revoked key', async () => {
		const { record, fullKey } = await createApiKey('user-1', 'test key');
		await revokeApiKey('user-1', record.id);
		expect(await verifyApiKey(fullKey)).toBeNull();
	});

	it('returns null for an expired key', async () => {
		const past = new Date(Date.now() - 1000);
		const { fullKey } = await createApiKey('user-1', 'test key', past);
		expect(await verifyApiKey(fullKey)).toBeNull();
	});

	it('bumps lastUsedAt on successful verification', async () => {
		const { record, fullKey } = await createApiKey('user-1', 'test key');
		expect(apiKeyRows[0].lastUsedAt).toBeNull();
		await verifyApiKey(fullKey);
		await vi.waitFor(() => {
			const row = apiKeyRows.find((r) => r.id === record.id);
			expect(row?.lastUsedAt).not.toBeNull();
		});
	});
});

describe('revokeApiKey', () => {
	it('sets revokedAt for the owning user', async () => {
		const { record } = await createApiKey('user-1', 'test key');
		await revokeApiKey('user-1', record.id);
		expect(apiKeyRows[0].revokedAt).not.toBeNull();
	});

	it('does not revoke a key belonging to a different user', async () => {
		const { record, fullKey } = await createApiKey('user-1', 'test key');
		await revokeApiKey('user-2', record.id);
		expect(apiKeyRows[0].revokedAt).toBeNull();
		expect(await verifyApiKey(fullKey)).not.toBeNull();
	});
});

describe('listApiKeys', () => {
	it('never exposes keyHash', async () => {
		await createApiKey('user-1', 'key one');
		const keys = await listApiKeys('user-1');
		expect(keys).toHaveLength(1);
		expect(keys[0]).not.toHaveProperty('keyHash');
	});

	it('only returns keys for the given user', async () => {
		await createApiKey('user-1', 'mine');
		await createApiKey('user-2', 'theirs');
		const keys = await listApiKeys('user-1');
		expect(keys).toHaveLength(1);
		expect(keys[0].name).toBe('mine');
	});
});

describe('getUserById', () => {
	it('returns the user row', async () => {
		expect(await getUserById('user-1')).toEqual(userRows[0]);
	});

	it('returns null for an unknown user', async () => {
		expect(await getUserById('nope')).toBeNull();
	});
});
