/**
 * Minimal Sentry ingestion client ("sentry-lite").
 *
 * The npm registry is unreachable from some build environments, so instead of
 * depending on @sentry/sveltekit (~2.5MB + transitive deps) this module speaks
 * Sentry's stable envelope ingestion protocol directly with zero dependencies:
 *
 *   POST {scheme}://{host}{path}/api/{projectId}/envelope/
 *   Content-Type: application/x-sentry-envelope
 *
 * Only error events are sent (no tracing, no replay, no PII). When the DSN is
 * empty every entry point is a no-op, so local dev / Tauri / demo are
 * unaffected. Swapping to the official SDK later keeps the same env contract
 * (SENTRY_DSN server-side, PUBLIC_SENTRY_DSN client-side).
 */

export interface ParsedDsn {
	/** Envelope ingestion URL, e.g. https://o123.ingest.sentry.io/api/456/envelope/ */
	envelopeUrl: string;
	/** Full DSN string, echoed in the envelope header for auth. */
	dsn: string;
	key: string;
	projectId: string;
}

/**
 * Parse a Sentry DSN. Returns null for empty/malformed input (caller no-ops).
 * Supports path prefixes (self-hosted) and ports:
 *   https://key@host/42  |  https://key@host:9000/prefix/42
 */
export function parseDsn(raw: string | null | undefined): ParsedDsn | null {
	const dsn = (raw ?? '').trim();
	if (!dsn) return null;
	let url: URL;
	try {
		url = new URL(dsn);
	} catch {
		return null;
	}
	if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.username) return null;
	const segments = url.pathname.split('/').filter(Boolean);
	if (segments.length === 0) return null;
	const projectId = segments[segments.length - 1];
	if (!/^\d+$/.test(projectId)) return null;
	const basePath = segments.slice(0, -1).join('/');
	const prefix = basePath ? `/${basePath}` : '';
	return {
		envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
		dsn,
		key: url.username,
		projectId
	};
}

export function newEventId(): string {
	// crypto.randomUUID is available in Node 19+ and all modern browsers.
	return crypto.randomUUID().replaceAll('-', '');
}

export interface SentryFrame {
	filename: string;
	lineno?: number;
	colno?: number;
	function?: string;
	in_app: boolean;
}

function isInApp(filename: string): boolean {
	if (!filename) return false;
	if (filename.startsWith('node:') || filename.startsWith('node ')) return false;
	if (filename.includes('node_modules')) return false;
	if (filename.includes('sentry-envelope') || filename.includes('sentry-lite')) return false;
	return true;
}

/**
 * Parse a V8-style stack string into Sentry frames (oldest call first, as
 * Sentry expects). Non-V8 stacks yield a single frame carrying the raw text.
 */
export function parseStack(stack: string | undefined): SentryFrame[] {
	if (!stack) return [];
	const lines = stack.split('\n').slice(1); // first line is the error message
	const frames: SentryFrame[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('at ')) continue;
		// "at fn (location)" | "at location" | "at async fn (location)"
		const match = trimmed.match(/^at (?:async )?(?:(.+?) \()?(.+?)\)?$/);
		if (!match) continue;
		const fnName = match[1]?.trim();
		let location = (match[2] ?? '').trim();
		// Strip file:// URLs to plain paths; drop Vite query suffixes (?t=...).
		location = location.replace(/^file:\/\//, '').split('?')[0];
		const pos = location.match(/:(\d+):(\d+)$/);
		const filename = pos ? location.slice(0, pos.index) : location;
		if (!filename || filename === 'native') continue;
		frames.push({
			filename,
			lineno: pos ? Number(pos[1]) : undefined,
			colno: pos ? Number(pos[2]) : undefined,
			function: fnName && fnName !== 'Object.<anonymous>' ? fnName : undefined,
			in_app: isInApp(filename)
		});
	}
	frames.reverse(); // V8 lists newest-first; Sentry wants oldest-first.
	return frames;
}

export interface SentryEventContext {
	/** Pathname + method only — query strings and headers are never sent. */
	url?: string;
	method?: string;
	userId?: string;
	requestId?: string;
	/** HTTP status of the failed API response (handled-5xx reports). */
	status?: number;
	platform?: string;
	runtimeName?: string;
	runtimeVersion?: string;
}

export interface SentryEnvelopeOptions {
	dsn: ParsedDsn;
	type: string;
	value: string;
	stack?: string;
	context?: SentryEventContext;
	environment?: string;
	release?: string;
	sdkName?: string;
}

/** Build the full envelope body for one error event. */
export function buildEnvelope(options: SentryEnvelopeOptions): string {
	const {
		dsn,
		type,
		value,
		stack,
		context = {},
		environment,
		release,
		sdkName = 'lunapad.sentry-lite'
	} = options;
	const eventId = newEventId();
	const frames = parseStack(stack);
	const event: Record<string, unknown> = {
		event_id: eventId,
		timestamp: Date.now() / 1000,
		platform: context.platform ?? 'javascript',
		level: 'error',
		environment: environment ?? 'production',
		...(release ? { release } : {}),
		exception: {
			values: [
				{
					type,
					value: value.slice(0, 2000),
					...(frames.length > 0 ? { stacktrace: { frames } } : {}),
					...(frames.length === 0 && stack ? { raw_stacktrace: stack.slice(0, 4000) } : {})
				}
			]
		},
		...(context.url || context.method
			? {
					request: {
						...(context.url ? { url: context.url } : {}),
						...(context.method ? { method: context.method } : {})
					}
				}
			: {}),
		...(context.userId ? { user: { id: context.userId } } : {}),
		...(context.requestId || context.status !== undefined
			? {
					tags: {
						...(context.requestId ? { request_id: context.requestId } : {}),
						...(context.status !== undefined ? { status_code: String(context.status) } : {})
					}
				}
			: {})
	};
	if (context.runtimeName) {
		event.contexts = {
			runtime: {
				name: context.runtimeName,
				...(context.runtimeVersion ? { version: context.runtimeVersion } : {})
			}
		};
	}
	const payload = JSON.stringify(event);
	const header = JSON.stringify({
		event_id: eventId,
		sent_at: new Date().toISOString(),
		dsn: dsn.dsn,
		sdk: { name: sdkName, version: '1.0.0' }
	});
	const encoder = new TextEncoder();
	const itemHeader = JSON.stringify({
		type: 'event',
		content_type: 'application/json',
		length: encoder.encode(payload).length
	});
	return `${header}\n${itemHeader}\n${payload}`;
}

/** Credential string for `X-Sentry-Auth` / `Authorization` style ingest auth. */
function authHeader(key: string): string {
	return `Sentry sentry_key=${key}, sentry_version=7, sentry_client=lunapad.sentry-lite/1.0.0`;
}

/**
 * POST an envelope. Never throws — error reporting must not break the app.
 * Fire-and-forget at call sites (`void postEnvelope(...)`); awaited in tests.
 *
 * `key` is the DSN public key. It is sent twice because receivers disagree on
 * where to read it: Sentry/Relay accept the `dsn` field in the envelope
 * header, but GlitchTip's fallback view only inspects `X-Sentry-Auth` /
 * `Authorization` / `?sentry_key=` and answers 403 `{"detail":"Denied"}` to a
 * header-only DSN — and older builds deny the Rust path the same way. The key
 * is a public ingest credential (it ships in browser bundles), so putting it
 * in the URL is not a leak.
 *
 * Rejections are silent by default. Enable `setSentryDebug(true)` (server:
 * SENTRY_DEBUG=1, browser: ?sentryDebug=1) to log the HTTP status plus the
 * response body of a rejected send, which is what names the cause:
 * `{"detail":"Denied"}` = the receiver rejected the DSN key, HTML starting
 * `<title>Attention Required` = Cloudflare blocked the POST (fix it on the
 * receiver), `429` = the receiver is throttling. Throttled per status so a
 * persistent rejection can't spam the logs.
 */
export async function postEnvelope(envelopeUrl: string, body: string, key?: string): Promise<void> {
	try {
		let url = envelopeUrl;
		const headers: Record<string, string> = { 'Content-Type': 'application/x-sentry-envelope' };
		if (key) {
			headers['X-Sentry-Auth'] = authHeader(key);
			try {
				const parsed = new URL(url);
				parsed.searchParams.set('sentry_key', key);
				url = parsed.toString();
			} catch {
				// Relative/unparsable URL — the header alone still authenticates.
			}
		}
		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(5000)
		});
		// 429/4xx: drop silently — retrying error reports risks feedback loops.
		if (!response.ok) {
			const status = response.status;
			if (sentryDebugEnabled && shouldReportDeduped(`ingest ${status}`)) {
				const detail = await describeRejection(response).catch(() => '');
				console.warn(
					`[sentry] ingest rejected the event (HTTP ${status} from ${envelopeUrl}). ` +
						`${diagnoseRejection(status, detail)}`
				);
			} else {
				await response.body?.cancel().catch(() => {});
			}
		}
	} catch {
		// Offline / DNS / timeout — never surface.
	}
}

/** Bounded body + transport headers of a rejected ingest response. */
async function describeRejection(response: Response): Promise<string> {
	const header = (name: string) => response.headers.get(name) ?? '';
	const transport = [
		header('server') && `server=${header('server')}`,
		header('cf-ray') && `cf-ray=${header('cf-ray')}`,
		header('cf-mitigated') && `cf-mitigated=${header('cf-mitigated')}`,
		header('retry-after') && `retry-after=${header('retry-after')}`
	]
		.filter(Boolean)
		.join(' ');
	const text = (await response.text().catch(() => '')).trim().slice(0, 300);
	return [transport && `[${transport}]`, text].filter(Boolean).join(' ');
}

/** One-line reading of a rejection, given its body ("" when unavailable). */
function diagnoseRejection(status: number, detail: string): string {
	if (/^\s*<\s*(html|!doctype)/i.test(detail)) {
		return (
			'The receiver answered with an HTML error page instead of the ingest API — ' +
			'most likely a Cloudflare/WAF rule on the receiver. Check its security rules, not this app.'
		);
	}
	if (status === 401 || status === 403) {
		return (
			`The receiver rejected the DSN key (${detail || 'no body'}). ` +
			`Copy a fresh key from the receiver's project settings into SENTRY_DSN.`
		);
	}
	if (status === 429) {
		return `The receiver is throttling${detail ? ` (${detail})` : ''} — drop events or raise its quota.`;
	}
	return detail ? `Receiver said: ${detail}` : 'No body returned by the receiver.';
}

let sentryDebugEnabled = false;

/** Enable one-line warnings for rejected ingest sends. Safe to call anytime. */
export function setSentryDebug(enabled: boolean): void {
	sentryDebugEnabled = enabled;
}

/** Test-only: reset debug state and the dedupe cache. */
export function clearSentryTestState(): void {
	sentryDebugEnabled = false;
	clearReportDedupCache();
}

function formatConsoleValue(value: unknown, maxLength: number = 1000): string {
	if (value instanceof Error) return `${value.name || 'Error'}: ${value.message || String(value)}`;
	if (typeof value === 'string') return value;
	if (value === null || value === undefined) return String(value);
	try {
		const json = JSON.stringify(value);
		return (json ?? String(value)).slice(0, maxLength);
	} catch {
		return String(value);
	}
}

/**
 * Turn console.error(...) args into an event value + stack, mirroring how the
 * message looks in the console. The first Error arg's stack becomes the event
 * stacktrace; everything is bounded so a huge logged object can't blow up the
 * envelope. Never throws.
 */
export function describeConsoleArgs(args: unknown[]): { value: string; stack?: string } {
	try {
		let stack: string | undefined;
		for (const arg of args) {
			if (!stack && arg instanceof Error && arg.stack) {
				stack = arg.stack;
				break;
			}
		}
		const [first, ...rest] = args;
		let template = typeof first === 'string' ? first : '';
		let values: unknown[] = typeof first === 'string' ? [...rest] : [...args];
		if (template.includes('%')) {
			template = template.replace(/%[sdifoO%]/g, (match) => {
				if (match === '%%') return '%';
				const next = values.shift();
				return formatConsoleValue(next);
			});
		}
		const parts = [template, ...values.map((v) => formatConsoleValue(v))].filter(
			(part) => part !== ''
		);
		const value = parts.join(' ').slice(0, 2000) || 'console.error';
		return stack ? { value, stack } : { value };
	} catch {
		return { value: 'console.error' };
	}
}

/** Normalize anything throwable into { type, value, stack }. */
export function describeError(error: unknown): { type: string; value: string; stack?: string } {
	if (error instanceof Error) {
		return {
			type: error.name || 'Error',
			value: error.message || String(error),
			stack: error.stack
		};
	}
	if (typeof error === 'string') return { type: 'Error', value: error };
	try {
		return { type: 'Error', value: JSON.stringify(error)?.slice(0, 2000) ?? String(error) };
	} catch {
		return { type: 'Error', value: String(error) };
	}
}

// ── Handled-5xx reporting policy (shared by server + client) ─────────────
// Hot-polling endpoints (presence, jobs) can 5xx every second — without a
// throttle one outage floods the Sentry quota. One report per key per window.

export const SENTRY_DEDUPE_WINDOW_MS = 60_000;
const SENTRY_DEDUPE_MAX_KEYS = 500;

const reportMarks = new Map<string, number>();

/** True when this key may be reported now (and records the mark). */
export function shouldReportDeduped(key: string, now: number = Date.now()): boolean {
	const last = reportMarks.get(key);
	if (last !== undefined && now - last < SENTRY_DEDUPE_WINDOW_MS) return false;
	if (reportMarks.size >= SENTRY_DEDUPE_MAX_KEYS && !reportMarks.has(key)) {
		let oldestKey: string | null = null;
		let oldestTime = Infinity;
		for (const [k, t] of reportMarks) {
			if (t < oldestTime) {
				oldestTime = t;
				oldestKey = k;
			}
		}
		if (oldestKey !== null) reportMarks.delete(oldestKey);
	}
	reportMarks.set(key, now);
	return true;
}

/** Test-only: reset the dedupe cache. */
export function clearReportDedupCache(): void {
	reportMarks.clear();
}

/** Dedupe key for a failed API response. */
export function apiErrorDedupeKey(
	source: string,
	method: string,
	pathname: string,
	status: number
): string {
	return `${source} ${method} ${pathname} ${status}`;
}

/**
 * Decide whether a response counts as a reportable API error.
 * Every 4xx/5xx on /api/* is reported — including health checks (a failing
 * health endpoint IS the issue) — because the app surfaces failures as
 * status codes, not throws. Event streams are excluded (buffering a stream
 * to read its body would be worse than the error). Throttling happens
 * separately via shouldReportDeduped.
 */
export function isReportableApiResponse(
	pathname: string,
	status: number,
	contentType: string | null
): boolean {
	if (status < 400) return false;
	if (!pathname.startsWith('/api/')) return false;
	if ((contentType ?? '').includes('text/event-stream')) return false;
	return true;
}

/** Pull the `{error}` (or SvelteKit `{message}`) text out of a JSON error body. */
export function extractApiErrorMessage(text: string, maxLength: number = 500): string {
	try {
		const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
		for (const field of [parsed.error, parsed.message]) {
			if (typeof field === 'string' && field.trim()) {
				return field.trim().slice(0, maxLength);
			}
		}
	} catch {
		// Not JSON — fall through to raw text.
	}
	return text.trim().slice(0, maxLength);
}
