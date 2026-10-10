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
		...(context.requestId ? { tags: { request_id: context.requestId } } : {})
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

/**
 * POST an envelope. Never throws — error reporting must not break the app.
 * Fire-and-forget at call sites (`void postEnvelope(...)`); awaited in tests.
 */
export async function postEnvelope(envelopeUrl: string, body: string): Promise<void> {
	try {
		const response = await fetch(envelopeUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-sentry-envelope' },
			body,
			signal: AbortSignal.timeout(5000)
		});
		// 429/4xx: drop silently — retrying error reports risks feedback loops.
		if (!response.ok) await response.body?.cancel().catch(() => {});
	} catch {
		// Offline / DNS / timeout — never surface.
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
