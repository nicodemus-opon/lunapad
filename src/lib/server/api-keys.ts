import crypto from 'node:crypto';
import { query } from './db.js';

const KEY_PREFIX = 'lp_live_';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const PREFIX_DISPLAY_LEN = 12;

function randomBase62(byteLen: number): string {
	const bytes = crypto.randomBytes(byteLen);
	let out = '';
	for (const b of bytes) out += BASE62[b % 62];
	return out;
}

function hashKey(key: string): string {
	return crypto.createHash('sha256').update(key).digest('hex');
}

export interface ApiKeyRecord {
	id: string;
	userId: string;
	name: string;
	prefix: string;
	createdAt: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
	revokedAt: string | null;
}

// Mirrors better-auth's own user schema (see auth.ts) so the result can be assigned
// directly to event.locals.user without a structural cast.
export interface ApiKeyUser {
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

let apiKeyTableReady: Promise<void> | null = null;

async function ensureApiKeyTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS "apiKey" (
			"id"         TEXT PRIMARY KEY,
			"userId"     TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			"name"       TEXT NOT NULL,
			"keyHash"    TEXT NOT NULL UNIQUE,
			"prefix"     TEXT NOT NULL,
			"scopes"     TEXT[],
			"createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
			"lastUsedAt" TIMESTAMPTZ,
			"expiresAt"  TIMESTAMPTZ,
			"revokedAt"  TIMESTAMPTZ
		)
	`);
	await query(`CREATE INDEX IF NOT EXISTS apikey_user_id_idx ON "apiKey" ("userId")`);
	await query(`CREATE INDEX IF NOT EXISTS apikey_key_hash_idx ON "apiKey" ("keyHash")`);
}

export function ensureApiKeyTableOnce(): Promise<void> {
	if (!apiKeyTableReady) apiKeyTableReady = ensureApiKeyTable();
	return apiKeyTableReady;
}

function toRecord(row: {
	id: string;
	userId: string;
	name: string;
	prefix: string;
	createdAt: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
	revokedAt: string | null;
}): ApiKeyRecord {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		prefix: row.prefix,
		createdAt: row.createdAt,
		lastUsedAt: row.lastUsedAt,
		expiresAt: row.expiresAt,
		revokedAt: row.revokedAt
	};
}

export async function createApiKey(
	userId: string,
	name: string,
	expiresAt: Date | null = null,
	scopes: string[] | null = null
): Promise<{ record: ApiKeyRecord; fullKey: string }> {
	await ensureApiKeyTableOnce();
	const fullKey = `${KEY_PREFIX}${randomBase62(32)}`;
	const id = crypto.randomUUID();
	const prefix = fullKey.slice(0, PREFIX_DISPLAY_LEN);
	const keyHash = hashKey(fullKey);

	const rows = await query<{
		id: string;
		userId: string;
		name: string;
		prefix: string;
		createdAt: string;
		lastUsedAt: string | null;
		expiresAt: string | null;
		revokedAt: string | null;
	}>(
		`INSERT INTO "apiKey" ("id", "userId", "name", "keyHash", "prefix", "expiresAt", "scopes")
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING "id", "userId", "name", "prefix", "createdAt", "lastUsedAt", "expiresAt", "revokedAt"`,
		[id, userId, name, keyHash, prefix, expiresAt, scopes]
	);

	return { record: toRecord(rows[0]), fullKey };
}

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
	await ensureApiKeyTableOnce();
	const rows = await query<{
		id: string;
		userId: string;
		name: string;
		prefix: string;
		createdAt: string;
		lastUsedAt: string | null;
		expiresAt: string | null;
		revokedAt: string | null;
	}>(
		`SELECT "id", "userId", "name", "prefix", "createdAt", "lastUsedAt", "expiresAt", "revokedAt"
		 FROM "apiKey" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
		[userId]
	);
	return rows.map(toRecord);
}

export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
	await ensureApiKeyTableOnce();
	await query(
		`UPDATE "apiKey" SET "revokedAt" = now() WHERE "id" = $1 AND "userId" = $2 AND "revokedAt" IS NULL`,
		[keyId, userId]
	);
}

export interface VerifiedApiKey {
	userId: string;
	apiKeyId: string;
	scopes: string[] | null;
}

export async function verifyApiKey(presentedKey: string): Promise<VerifiedApiKey | null> {
	if (!presentedKey.startsWith(KEY_PREFIX)) return null;
	await ensureApiKeyTableOnce();
	const hash = hashKey(presentedKey);
	const rows = await query<{
		id: string;
		userId: string;
		expiresAt: string | null;
		revokedAt: string | null;
		scopes: string[] | null;
	}>(
		`SELECT "id", "userId", "expiresAt", "revokedAt", "scopes" FROM "apiKey" WHERE "keyHash" = $1`,
		[hash]
	);
	const row = rows[0];
	if (!row || row.revokedAt) return null;
	if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;

	// Best-effort, fire-and-forget — must not block/fail the auth check on this write.
	query(`UPDATE "apiKey" SET "lastUsedAt" = now() WHERE "id" = $1`, [row.id]).catch(() => {});

	return { userId: row.userId, apiKeyId: row.id, scopes: row.scopes };
}

export async function getUserById(userId: string): Promise<ApiKeyUser | null> {
	const rows = await query<ApiKeyUser>(
		`SELECT "id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt",
		        "role", "banned", "banReason", "banExpires"
		 FROM "user" WHERE "id" = $1`,
		[userId]
	);
	return rows[0] ?? null;
}
