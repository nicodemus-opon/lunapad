import crypto from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { query } from './db.js';
import { ensureAuthTablesOnce } from './auth.js';

type TokenKind = 'password_reset' | 'email_verification';

export interface AccountSessionSummary {
	id: string;
	current: boolean;
	ipAddress: string | null;
	userAgent: string | null;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
}

export interface AccountLifecycleTokenResult {
	ok: true;
	delivery: 'email' | 'manual' | 'silent';
	token?: string;
	expiresAt?: string;
}

let lifecycleTablesReady: Promise<void> | null = null;

async function ensureAccountLifecycleTables(): Promise<void> {
	await ensureAuthTablesOnce();
	await query(`
		CREATE TABLE IF NOT EXISTS account_lifecycle_tokens (
			id         TEXT PRIMARY KEY,
			user_id    TEXT REFERENCES "user"("id") ON DELETE CASCADE,
			email      TEXT NOT NULL,
			kind       TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			expires_at TIMESTAMPTZ NOT NULL,
			used_at    TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await query(
		`CREATE INDEX IF NOT EXISTS account_lifecycle_tokens_lookup_idx
		 ON account_lifecycle_tokens (kind, token_hash, expires_at)`
	);
}

export function ensureAccountLifecycleTablesOnce(): Promise<void> {
	if (!lifecycleTablesReady) lifecycleTablesReady = ensureAccountLifecycleTables();
	return lifecycleTablesReady;
}

function tokenHash(token: string): string {
	return crypto.createHash('sha256').update(token).digest('hex');
}

function manualTokenDeliveryEnabled(): boolean {
	return (
		process.env.EMAIL_PROVIDER === 'manual' ||
		process.env.EMAIL_PROVIDER === 'none' ||
		process.env.NODE_ENV !== 'production'
	);
}

async function createToken(input: {
	userId: string;
	email: string;
	kind: TokenKind;
	ttlMinutes: number;
}): Promise<AccountLifecycleTokenResult> {
	await ensureAccountLifecycleTablesOnce();
	const token = crypto.randomBytes(32).toString('base64url');
	const rows = await query<{ expires_at: string }>(
		`INSERT INTO account_lifecycle_tokens (id, user_id, email, kind, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4, $5, now() + ($6::int * interval '1 minute'))
		 RETURNING expires_at`,
		[
			crypto.randomUUID(),
			input.userId,
			input.email.toLowerCase(),
			input.kind,
			tokenHash(token),
			input.ttlMinutes
		]
	);
	const manual = manualTokenDeliveryEnabled();
	return {
		ok: true,
		delivery: manual ? 'manual' : 'email',
		...(manual ? { token } : {}),
		expiresAt: rows[0]?.expires_at
	};
}

export async function listAccountSessions(input: {
	userId: string;
	currentSessionId?: string | null;
}): Promise<AccountSessionSummary[]> {
	await ensureAuthTablesOnce();
	const rows = await query<{
		id: string;
		ipAddress: string | null;
		userAgent: string | null;
		createdAt: string;
		updatedAt: string;
		expiresAt: string;
	}>(
		`SELECT id, "ipAddress", "userAgent", "createdAt", "updatedAt", "expiresAt"
		 FROM "session"
		 WHERE "userId" = $1
		 ORDER BY "updatedAt" DESC`,
		[input.userId]
	);
	return rows.map((row) => ({
		id: row.id,
		current: row.id === input.currentSessionId,
		ipAddress: row.ipAddress,
		userAgent: row.userAgent,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		expiresAt: row.expiresAt
	}));
}

export async function revokeAccountSessions(input: {
	userId: string;
	keepSessionId?: string | null;
}): Promise<number> {
	await ensureAuthTablesOnce();
	const rows = await query<{ id: string }>(
		`DELETE FROM "session"
		 WHERE "userId" = $1 AND ($2::text IS NULL OR id <> $2)
		 RETURNING id`,
		[input.userId, input.keepSessionId ?? null]
	);
	return rows.length;
}

export async function requestPasswordReset(email: string): Promise<AccountLifecycleTokenResult> {
	await ensureAccountLifecycleTablesOnce();
	const normalized = email.trim().toLowerCase();
	const rows = await query<{ id: string; email: string }>(
		`SELECT id, email FROM "user" WHERE lower(email) = $1 LIMIT 1`,
		[normalized]
	);
	const user = rows[0];
	if (!user) return { ok: true, delivery: 'silent' };
	return createToken({
		userId: user.id,
		email: user.email,
		kind: 'password_reset',
		ttlMinutes: 60
	});
}

async function consumeToken(kind: TokenKind, token: string): Promise<{ userId: string; email: string }> {
	await ensureAccountLifecycleTablesOnce();
	const rows = await query<{ id: string; user_id: string; email: string }>(
		`UPDATE account_lifecycle_tokens
		 SET used_at = now()
		 WHERE kind = $1
		   AND token_hash = $2
		   AND used_at IS NULL
		   AND expires_at > now()
		 RETURNING id, user_id, email`,
		[kind, tokenHash(token)]
	);
	const row = rows[0];
	if (!row) throw new Error('Token is invalid or expired.');
	return { userId: row.user_id, email: row.email };
}

export async function confirmPasswordReset(input: {
	token: string;
	password: string;
}): Promise<void> {
	if (input.password.length < 8) throw new Error('Password must be at least 8 characters.');
	const token = await consumeToken('password_reset', input.token);
	const passwordHash = await hashPassword(input.password);
	await query(
		`UPDATE account
		 SET password = $2, "updatedAt" = now()
		 WHERE "userId" = $1 AND "providerId" = 'credential'`,
		[token.userId, passwordHash]
	);
	await revokeAccountSessions({ userId: token.userId });
}

export async function requestEmailVerification(input: {
	userId: string;
	email: string;
}): Promise<AccountLifecycleTokenResult> {
	return createToken({
		userId: input.userId,
		email: input.email,
		kind: 'email_verification',
		ttlMinutes: 24 * 60
	});
}

export async function confirmEmailVerification(token: string): Promise<void> {
	const consumed = await consumeToken('email_verification', token);
	await query(
		`UPDATE "user" SET "emailVerified" = true, "updatedAt" = now() WHERE id = $1`,
		[consumed.userId]
	);
}

export async function exportAccountData(userId: string): Promise<Record<string, unknown>> {
	await ensureAuthTablesOnce();
	const [users, memberships, apiKeys, sessions] = await Promise.all([
		query(`SELECT id, name, email, "emailVerified", "createdAt", "updatedAt", role FROM "user" WHERE id = $1`, [
			userId
		]),
		query(`SELECT org_id, role, created_at, updated_at FROM organization_members WHERE user_id = $1`, [
			userId
		]),
		query(`SELECT id, name, scopes, "createdAt", "lastUsedAt", "revokedAt" FROM "apiKey" WHERE "userId" = $1`, [
			userId
		]).catch(() => []),
		listAccountSessions({ userId })
	]);
	return { user: users[0] ?? null, memberships, apiKeys, sessions };
}

export async function deleteAccount(userId: string): Promise<void> {
	await ensureAuthTablesOnce();
	await query(`DELETE FROM "user" WHERE id = $1`, [userId]);
}
