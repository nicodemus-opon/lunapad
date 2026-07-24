import { json, type Handle, type RequestEvent } from '@sveltejs/kit';
import crypto from 'node:crypto';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { setCurrentFolder } from '$lib/server/dbt-schedules';
import {
	auth,
	ensureAuthTablesOnce,
	hasAnyUser,
	promoteSoleUserToAdmin,
	SIGN_IN_PATH,
	SIGN_UP_PATH
} from '$lib/server/auth';
import { ensureApiKeyTableOnce, verifyApiKey, getUserById } from '$lib/server/api-keys';
import {
	can,
	hasApiScope,
	isUserBanned,
	userFromLocals,
	type PermissionAction
} from '$lib/server/permissions';
import { startShareRefreshWorker } from '$lib/server/share-refresh-worker';
import { startTrinoCatalogReconciler } from '$lib/server/trino-reconcile-worker';
import { ensureBaseTrinoAccessFile } from '$lib/server/connections';
import {
	createOrganizationForUser,
	deploymentMode,
	ensureDefaultMembership,
	ensureDefaultTenant,
	ensureTenantTablesOnce,
	entitlementsForPlan,
	resolveTenantContext
} from '$lib/server/tenancy';
import { query } from '$lib/server/db';
import { getSetupStatus } from '$lib/server/onboarding';
import { cloudSignupOpen } from '$lib/server/cloud-config';
import { assertCloudEnv } from '$lib/server/cloud-readiness';
import { isRateLimitedShared, rateLimitIp } from '$lib/server/redis-rate-limit';

startShareRefreshWorker();
startTrinoCatalogReconciler();
ensureBaseTrinoAccessFile().catch((err) =>
	console.warn('[trino-access-control] failed to seed base rules file:', err)
);
if (!building) assertCloudEnv();

// If a project folder is pre-configured via env (useful in Docker deployments),
// set it so the Inngest scheduler function can immediately find due schedules.
// (The frontend also reads this in +page.server.ts to auto-open/scaffold it.)
const startupFolder = process.env.PROJECT_FOLDER;
if (startupFolder) {
	setCurrentFolder(startupFolder);
}

// Dev/test-only escape hatch so e2e specs (which have no concept of logging in) can
// still hit the app. Hard-fails at startup if ever combined with NODE_ENV=production,
// so it can't accidentally ship disabled-auth to the real (Postgres-backed, multi-feature)
// deployment.
const testAuthDisabled = process.env.DISABLE_AUTH === '1';
if (testAuthDisabled && process.env.NODE_ENV === 'production') {
	throw new Error('DISABLE_AUTH=1 is not allowed when NODE_ENV=production.');
}

// DEMO_MODE is a separate, deliberate opt-out for a public read-only demo deployment
// (DuckDB-WASM only, no Postgres/Trino/dbt configured) — it's allowed in production. It
// skips the login gate, but unlike DISABLE_AUTH it also locks down every server-side
// feature below so the demo can't be used to reach external connections, the dbt CLI, or
// project file I/O even via a direct API call.
const DEMO_MODE = process.env.DEMO_MODE === '1';
const authDisabled = testAuthDisabled || DEMO_MODE;

// /api/inngest is excluded from the session gate: Inngest's own serve() handler verifies
// requests via INNGEST_SIGNING_KEY (or INNGEST_DEV), not browser cookies, so the dev/prod
// Inngest server (running outside the browser session) needs to reach it unauthenticated.
// /r and /s are published reports/sites — the whole point of "publish a link" is that
// people without a Lunapad account can open it. Per-report/per-site `requireAuth` is
// enforced inside each route's own load function instead, not here, since /r and /s must
// be reachable before we know which specific report someone's asking for.
const PUBLIC_PREFIXES = [
	'/api/auth',
	'/api/setup',
	'/api/signup',
	'/api/inngest',
	'/api/health',
	'/api/jobs/worker',
	'/login',
	'/signup',
	'/reset-password',
	'/setup',
	'/invite',
	'/r',
	'/s'
];
// The live-cell run endpoint a published report's page calls client-side — same
// public-by-default, per-report-gated reasoning as /r and /s above.
const PUBLIC_PATH_PATTERNS = [
	/^\/api\/shares\/[^/]+\/run$/,
	/^\/api\/invitations\/[^/]+\/accept$/,
	/^\/api\/account\/password-reset\/(request|confirm)$/,
	/^\/api\/account\/email\/verify$/
];
// /api/v1 and /api/mcp reach external connections and the dbt CLI exactly like
// /api/connections and /api/dbt already do — DEMO_MODE exists specifically to close
// that door, so they must be blocked here too even though they're a separate surface.
// /api/workspace persists the shared-workspace notebook content (cells, tabs, etc.) to
// Postgres — block it even though the client is coded to never call it in demo mode,
// since a direct request would otherwise be the first crack in demo mode's "no Postgres
// involvement at all" guarantee.
const DEMO_BLOCKED_PREFIXES = [
	'/api/connections',
	'/api/dbt',
	'/api/project',
	'/api/schedules',
	'/api/jobs',
	'/api/workspace',
	'/api/admin',
	'/admin',
	'/api/v1',
	'/api/mcp',
	// Server-side subprocess execution needs a real tenant + entitlements (quota
	// tracking), neither of which DEMO_MODE provisions — without this block it
	// 400s with a raw "Cannot read properties of undefined (reading 'id')" from
	// locals.organization! instead of the same clean 403 every other server-only
	// feature gets here.
	'/api/python'
];

function isPublicPath(pathname: string): boolean {
	if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
	return PUBLIC_PATH_PATTERNS.some((re) => re.test(pathname));
}

function isDemoBlockedPath(pathname: string): boolean {
	return DEMO_BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function routePermission(pathname: string, method: string): PermissionAction | null {
	if (isPublicPath(pathname)) return null;

	const write = method !== 'GET' && method !== 'HEAD';

	if (pathname.startsWith('/api/workspace/load')) return 'workspace:read';
	if (pathname.startsWith('/api/workspace/save')) return 'workspace:write';

	if (pathname.startsWith('/api/connections/query')) return 'connections:query';
	if (pathname.startsWith('/api/connections/schema')) return 'connections:query';
	if (pathname.startsWith('/api/connections/cancel')) return 'connections:query';
	if (pathname.startsWith('/api/connections')) return 'connections:manage';

	if (pathname.startsWith('/api/dbt/manifest') || pathname.startsWith('/api/dbt/logs')) {
		return 'dbt:read';
	}
	if (pathname.startsWith('/api/dbt')) return 'dbt:run';

	if (pathname.startsWith('/api/v1/query')) return 'connections:query';
	if (pathname.startsWith('/api/v1/connections')) return 'connections:query';
	if (pathname.startsWith('/api/v1/dbt/manifest') || pathname.startsWith('/api/v1/dbt/jobs')) {
		return 'dbt:read';
	}
	if (pathname.startsWith('/api/v1/dbt')) return 'dbt:run';
	if (pathname.startsWith('/api/v1/notebooks')) return write ? 'workspace:write' : 'workspace:read';
	if (pathname.startsWith('/api/v1/prql')) return 'workspace:read';
	// /api/mcp's per-tool permission is enforced inside createLunapadMcpServer's tool
	// handlers instead of here — a JSON-RPC POST body's tool name isn't visible to this
	// path-based router before dispatch, and returning a single fixed action here would
	// either block every read tool (if action is a write action) or let every write tool
	// through unscoped (if action is a read action). Authentication (a user must still be
	// resolved) is still enforced by the !event.locals.user check below; this just skips
	// the per-action gate specifically for this one path.
	if (pathname.startsWith('/api/mcp')) return null;

	if (pathname.startsWith('/api/project')) return write ? 'workspace:write' : 'workspace:read';

	// Server-side Python/Evidence endpoints execute or inspect local server processes.
	// On a multi-tenant deployment they are admin-only even if editors can run dbt.
	if (pathname.startsWith('/api/python')) return 'admin:manage';
	if (pathname.startsWith('/api/evidence')) return 'admin:manage';

	if (pathname.startsWith('/api/shares/check-slug')) return 'shares:publish';
	if (pathname.startsWith('/api/shares/refresh-schedule')) return 'shares:publish';
	if (pathname.startsWith('/api/shares/regenerate')) return 'shares:publish';
	if (pathname.startsWith('/api/shares')) return write ? 'shares:publish' : 'shares:read';

	if (pathname.startsWith('/api/sites')) return 'sites:manage';

	if (pathname.startsWith('/api/comments')) {
		if (method === 'DELETE' || method === 'PATCH') return 'comments:resolve';
		return write ? 'comments:write' : 'comments:read';
	}
	if (pathname.startsWith('/api/team/users')) return write ? 'admin:manage' : 'comments:read';
	if (pathname === '/api/orgs') return 'workspace:read';
	if (pathname.startsWith('/api/orgs/') && pathname.endsWith('/activate')) return 'workspace:read';
	if (pathname.startsWith('/api/orgs')) return write ? 'admin:manage' : 'workspace:read';
	if (pathname.startsWith('/api/presence')) return 'comments:read';

	if (pathname.startsWith('/api/ai/authorize-tool')) return 'ai:read';
	if (pathname.startsWith('/api/ai/edit-cell')) return 'ai:mutate';
	if (pathname.startsWith('/api/ai/sessions') && write) return 'ai:mutate';
	if (pathname.startsWith('/api/ai')) return 'ai:read';
	if (pathname.startsWith('/api/llm')) return 'ai:mutate';

	if (pathname.startsWith('/api/schedules')) return 'dbt:run';
	if (pathname.startsWith('/api/jobs')) return write ? 'dbt:run' : 'dbt:read';
	if (pathname.startsWith('/api/admin')) return 'admin:manage';
	if (pathname.startsWith('/api/audit')) return 'admin:manage';
	if (pathname.startsWith('/api/invitations')) return 'admin:manage';
	if (pathname.startsWith('/api/account')) return null;
	if (pathname.startsWith('/api/setup')) return null;
	if (pathname.startsWith('/api/health')) return null;

	return null;
}

async function isThemeOnlyOrgPatch(event: RequestEvent): Promise<boolean> {
	const { pathname } = event.url;
	if (event.request.method !== 'PATCH') return false;
	if (!/^\/api\/orgs\/[^/]+$/.test(pathname)) return false;

	try {
		const body = (await event.request.clone().json()) as unknown;
		if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
		const keys = Object.keys(body);
		return keys.length === 1 && keys[0] === 'theme';
	} catch {
		return false;
	}
}

async function requiresVerifiedEmail(event: RequestEvent): Promise<boolean> {
	const { pathname } = event.url;
	const method = event.request.method;
	if (deploymentMode() !== 'cloud') return false;
	if (method === 'GET' || method === 'HEAD') return false;
	// Workspace theme changes are an admin-only visual preference. Keep broader
	// workspace/admin writes gated, but do not block theme persistence on email verification.
	if (await isThemeOnlyOrgPatch(event)) return false;
	return (
		pathname.startsWith('/api/account/api-keys') ||
		pathname.startsWith('/api/invitations') ||
		pathname.startsWith('/api/shares') ||
		pathname.startsWith('/api/sites') ||
		pathname.startsWith('/api/connections') ||
		pathname.startsWith('/api/orgs') ||
		pathname.startsWith('/api/projects')
	);
}

function emailVerified(user: App.Locals['user']): boolean {
	return Boolean((user as unknown as { emailVerified?: boolean })?.emailVerified);
}

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = event.request.headers.get('X-Request-Id') ?? crypto.randomUUID();
	event.locals.requestId = requestId;
	const decorateResponse = (response: Response): Response => {
		response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
		response.headers.set('X-Request-Id', requestId);
		response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
		return response;
	};
	if (DEMO_MODE && isDemoBlockedPath(event.url.pathname)) {
		return decorateResponse(
			event.url.pathname.startsWith('/api/')
				? json({ error: 'Not available in demo mode' }, { status: 403 })
				: new Response('Not available in demo mode', { status: 403 })
		);
	}

	if (authDisabled) {
		// DISABLE_AUTH / DEMO_MODE skip svelteKitHandler, so better-auth routes never
		// register — stub get-session so useSession() doesn't 404-spam the dev console.
		if (event.url.pathname === '/api/auth/get-session') {
			if (testAuthDisabled) {
				const user = {
					id: 'local-dev',
					role: 'admin',
					name: 'Local Dev',
					email: 'local-dev@localhost'
				};
				return decorateResponse(
					json({
						user,
						session: {
							id: 'local-dev-session',
							userId: user.id,
							expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString()
						}
					})
				);
			}
			return decorateResponse(json({ user: null, session: null }));
		}

		// DISABLE_AUTH (dev/e2e) means "act as a fully-authorized user". Without a synthetic
		// user, endpoints that internally enforce can(user, ...) — e.g. /api/workspace/save —
		// see locals.user === null and 403, which surfaces as a perpetual "Couldn't save
		// changes — retrying…" banner for any non-demo notebook. DEMO_MODE deliberately leaves
		// user null so its server-side features stay locked even here.
		if (testAuthDisabled) {
			event.locals.user = {
				id: 'local-dev',
				role: 'admin',
				name: 'Local Dev',
				email: 'local-dev@localhost'
			} as unknown as typeof event.locals.user;
			event.locals.session = null;
			event.locals.apiKeyId = null;
			event.locals.apiKeyScopes = null;
			const tenant = await ensureDefaultTenant();
			const membership = await ensureDefaultMembership('local-dev', 'admin');
			event.locals.organization = tenant.organization;
			event.locals.project = tenant.project;
			event.locals.membership = membership;
			event.locals.entitlements = entitlementsForPlan(tenant.organization.plan);
		}
		return decorateResponse(await resolve(event));
	}

	await ensureAuthTablesOnce();
	await ensureApiKeyTableOnce();
	await ensureTenantTablesOnce();

	// Email/password sign-up is left enabled in better-auth's own config (disableSignUp
	// blocks it unconditionally, even from server code — see auth.ts), so it's gated here
	// instead: open only for the very first account, then permanently closed. Whoever
	// completes it is promoted to admin below; from then on only an admin can create
	// further accounts (via /admin, using the admin plugin's createUser endpoint).
	const isSignUpAttempt = event.url.pathname === SIGN_UP_PATH && event.request.method === 'POST';
	const isSignInAttempt = event.url.pathname === SIGN_IN_PATH && event.request.method === 'POST';
	let signUpProfile: { email?: string; name?: string } | null = null;
	if (isSignUpAttempt) {
		try {
			const body = (await event.request.clone().json()) as { email?: string; name?: string };
			signUpProfile = {
				email: typeof body.email === 'string' ? body.email.toLowerCase().trim() : undefined,
				name: typeof body.name === 'string' ? body.name.trim() : undefined
			};
		} catch {
			signUpProfile = null;
		}
	}
	if (isSignUpAttempt && deploymentMode() === 'self_hosted' && (await hasAnyUser())) {
		return decorateResponse(
			json({ error: 'Sign-up is closed — an admin account already exists.' }, { status: 403 })
		);
	}
	if (isSignUpAttempt && deploymentMode() === 'cloud') {
		return decorateResponse(
			json({ error: 'Use /api/signup so workspace setup is created atomically.' }, { status: 403 })
		);
	}
	if (isSignInAttempt && deploymentMode() === 'cloud') {
		const ip = rateLimitIp(event.request);
		if (await isRateLimitedShared(`login:${ip}`, 30, 60 * 60 * 1000)) {
			return decorateResponse(json({ error: 'Too many login attempts.' }, { status: 429 }));
		}
	}

	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;
	event.locals.apiKeyId = null;
	event.locals.apiKeyScopes = null;
	event.locals.organization = null;
	event.locals.project = null;
	event.locals.membership = null;
	event.locals.entitlements = null;

	if (event.locals.user && isUserBanned(event.locals.user)) {
		event.locals.user = null;
		event.locals.session = null;
	}

	// API-key fallback for non-browser callers (the /api/v1 and /api/mcp surfaces) —
	// only checked when no session cookie already authenticated the request, so
	// browser auth behavior above is completely unaffected.
	if (!event.locals.user) {
		const presentedKey = event.request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
		if (presentedKey) {
			const verified = await verifyApiKey(presentedKey);
			if (verified) {
				const user = await getUserById(verified.userId);
				if (user && !isUserBanned(user)) {
					event.locals.user = user;
					event.locals.apiKeyId = verified.apiKeyId;
					event.locals.apiKeyScopes = verified.scopes;
					const tenant = await resolveTenantContext(user, verified.projectId, verified.orgId);
					event.locals.organization = tenant.organization;
					event.locals.project = tenant.project;
					event.locals.membership = tenant.membership;
					event.locals.entitlements = tenant.entitlements;
					event.locals.user.role = tenant.membership.role;
				}
			}
		}
	}

	if (event.locals.user && !event.locals.organization) {
		try {
			const tenant = await resolveTenantContext(
				event.locals.user,
				event.cookies.get('lunapad_project_id'),
				event.cookies.get('lunapad_org_id')
			);
			event.locals.organization = tenant.organization;
			event.locals.project = tenant.project;
			event.locals.membership = tenant.membership;
			event.locals.entitlements = tenant.entitlements;
			event.locals.user.role = tenant.membership.role;
		} catch {
			event.locals.user = null;
			event.locals.session = null;
			event.locals.apiKeyId = null;
			event.locals.apiKeyScopes = null;
			event.locals.organization = null;
			event.locals.project = null;
			event.locals.membership = null;
			event.locals.entitlements = null;
		}
	}

	const path = event.url.pathname;
	if (!event.locals.user && !isPublicPath(path)) {
		if (path.startsWith('/api/')) {
			return decorateResponse(json({ error: 'Unauthorized' }, { status: 401 }));
		}
		// Fresh or repairable setup goes to /setup instead of /login. A user without
		// tenant rows cannot log into the product until setup repairs the workspace.
		const setupStatus = await getSetupStatus();
		if (setupStatus.mode !== 'closed') {
			if (deploymentMode() === 'cloud' && cloudSignupOpen() && setupStatus.mode === 'fresh') {
				return decorateResponse(
					new Response(null, { status: 303, headers: { location: '/signup' } })
				);
			}
			return decorateResponse(new Response(null, { status: 303, headers: { location: '/setup' } }));
		}
		if (deploymentMode() === 'cloud' && cloudSignupOpen()) {
			return decorateResponse(
				new Response(null, { status: 303, headers: { location: '/signup' } })
			);
		}
		const redirectTo = encodeURIComponent(path + event.url.search);
		return decorateResponse(
			new Response(null, {
				status: 303,
				headers: { location: `/login?redirectTo=${redirectTo}` }
			})
		);
	}

	if (path.startsWith('/admin') && event.locals.user?.role !== 'admin') {
		return decorateResponse(new Response('Forbidden', { status: 403 }));
	}

	const requiredPermission = routePermission(path, event.request.method);
	if (
		event.locals.user &&
		(await requiresVerifiedEmail(event)) &&
		!emailVerified(event.locals.user)
	) {
		return decorateResponse(
			json({ error: 'Verify your email before using this cloud feature.' }, { status: 403 })
		);
	}
	if (requiredPermission) {
		const user = userFromLocals(event.locals.user);
		if (!can(user, requiredPermission)) {
			return decorateResponse(json({ error: 'Forbidden' }, { status: 403 }));
		}
		// Scope restriction only applies to requests actually authenticated via a bearer
		// API key (apiKeyId set by the fallback path above) — a normal session-cookie
		// login always has apiKeyScopes === null too, and must NOT be scope-limited by
		// that; it's gated by role (can()) alone, same as before scopes existed.
		if (event.locals.apiKeyId && !hasApiScope(event.locals.apiKeyScopes, requiredPermission)) {
			return decorateResponse(
				json({ error: 'Forbidden: API key scope does not allow this action' }, { status: 403 })
			);
		}
	}

	const response = await svelteKitHandler({ event, resolve, auth, building });

	if (
		isSignUpAttempt &&
		deploymentMode() === 'self_hosted' &&
		response.status >= 200 &&
		response.status < 300
	) {
		if (deploymentMode() === 'self_hosted') {
			await promoteSoleUserToAdmin();
		}
		if (signUpProfile?.email) {
			const rows = await query<{ id: string; name: string; email: string }>(
				`SELECT id, name, email FROM "user" WHERE lower(email) = $1 ORDER BY "createdAt" DESC LIMIT 1`,
				[signUpProfile.email]
			);
			const user = rows[0];
			if (user) {
				await createOrganizationForUser({
					userId: user.id,
					userName: signUpProfile.name || user.name,
					email: user.email
				});
			}
		}
	}

	// 'credentialless' (like require-corp) enables crossOriginIsolated/SharedArrayBuffer
	// but does NOT require CORP headers on same-origin resources (require-corp does, which
	// blocks Workers served as static files from sirv that bypasses this hook).
	return decorateResponse(response);
};
