import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import { getRequestEvent } from '$app/server';
import { getPool, query } from './db.js';
import { publicOrigin, secureCookieEnabled } from './cloud-config.js';

export const SIGN_UP_PATH = '/api/auth/sign-up/email';
export const SIGN_IN_PATH = '/api/auth/sign-in/email';

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
if (googleClientId && googleClientSecret) {
	socialProviders.google = { clientId: googleClientId, clientSecret: googleClientSecret };
}
if (githubClientId && githubClientSecret) {
	socialProviders.github = { clientId: githubClientId, clientSecret: githubClientSecret };
}

export const auth = betterAuth({
	database: getPool(),
	emailAndPassword: {
		enabled: true
		// Signup is gated in hooks.server.ts — first account only, then closed.
	},
	...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
	plugins: [
		admin(),
		// Must be last: lets server-side auth.api.* calls (e.g. the bootstrap signup)
		// attach Set-Cookie to the current SvelteKit response automatically.
		sveltekitCookies(getRequestEvent)
	],
	// `vite build` forces NODE_ENV=production internally even during the Docker image-build
	// step, where BETTER_AUTH_SECRET isn't injected yet (compose env vars apply at container
	// run time, not build time) — better-auth hard-throws on a missing secret in production,
	// which would fail `pnpm build`. This module is never evaluated at request-serving time
	// while `building` is true, so the placeholder is never actually used to sign anything.
	secret: building ? 'build-time-placeholder-unused-at-runtime' : process.env.BETTER_AUTH_SECRET,
	baseURL: publicOrigin(),
	trustedOrigins: [publicOrigin()],
	advanced: {
		useSecureCookies: secureCookieEnabled()
	}
});

let authTablesReady: Promise<void> | null = null;

// better-auth's own migration CLI (@better-auth/cli) is currently broken against this
// better-auth version (pulls an incompatible better-call release), and its internal
// getMigrations() helper isn't part of the package's public exports. The schema below
// is hand-derived from @better-auth/core's getAuthTables() + the admin plugin's schema
// for exactly the config above (emailAndPassword + admin plugin, no extra fields,
// no secondaryStorage) — mirrors this repo's existing on-demand CREATE TABLE IF NOT
// EXISTS convention (see ensureEmbeddingTables in ./embeddings.ts).
async function ensureAuthTables(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS "user" (
			"id" TEXT PRIMARY KEY,
			"name" TEXT NOT NULL,
			"email" TEXT NOT NULL UNIQUE,
			"emailVerified" BOOLEAN NOT NULL DEFAULT false,
			"image" TEXT,
			"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
			"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
			"role" TEXT,
			"banned" BOOLEAN DEFAULT false,
			"banReason" TEXT,
			"banExpires" TIMESTAMPTZ
		)
	`);
	await query(`
		CREATE TABLE IF NOT EXISTS "session" (
			"id" TEXT PRIMARY KEY,
			"expiresAt" TIMESTAMPTZ NOT NULL,
			"token" TEXT NOT NULL UNIQUE,
			"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
			"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
			"ipAddress" TEXT,
			"userAgent" TEXT,
			"userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			"impersonatedBy" TEXT
		)
	`);
	await query(`CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session" ("userId")`);
	await query(`
		CREATE TABLE IF NOT EXISTS "account" (
			"id" TEXT PRIMARY KEY,
			"accountId" TEXT NOT NULL,
			"providerId" TEXT NOT NULL,
			"userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			"accessToken" TEXT,
			"refreshToken" TEXT,
			"idToken" TEXT,
			"accessTokenExpiresAt" TIMESTAMPTZ,
			"refreshTokenExpiresAt" TIMESTAMPTZ,
			"scope" TEXT,
			"password" TEXT,
			"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
			"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await query(`CREATE INDEX IF NOT EXISTS account_user_id_idx ON "account" ("userId")`);
	await query(`
		CREATE TABLE IF NOT EXISTS "verification" (
			"id" TEXT PRIMARY KEY,
			"identifier" TEXT NOT NULL,
			"value" TEXT NOT NULL,
			"expiresAt" TIMESTAMPTZ NOT NULL,
			"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
			"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await query(
		`CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification" ("identifier")`
	);
}

export function ensureAuthTablesOnce(): Promise<void> {
	if (!authTablesReady) authTablesReady = ensureAuthTables();
	return authTablesReady;
}

export async function hasAnyUser(): Promise<boolean> {
	const rows = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "user"`);
	return Number(rows[0]?.count ?? 0) > 0;
}

// Called right after a sign-up that hooks.server.ts allowed through (which only
// happens when no user existed yet), so this only ever promotes the first account.
export async function promoteSoleUserToAdmin(): Promise<void> {
	await query(
		`UPDATE "user" SET role = 'admin' WHERE id = (SELECT id FROM "user" ORDER BY "createdAt" ASC LIMIT 1)`
	);
}
