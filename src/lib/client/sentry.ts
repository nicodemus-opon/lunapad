/**
 * Browser-side Sentry error reporting (via $lib/sentry-envelope.ts, no SDK).
 *
 * DSN comes from $env/dynamic/public (PUBLIC_SENTRY_DSN), which SvelteKit
 * injects at request time — so setting it in Docker/Coolify runtime env needs
 * no rebuild. Empty DSN -> no-op. No tracing, no replay, no PII.
 */
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import {
	apiErrorDedupeKey,
	buildEnvelope,
	describeConsoleArgs,
	describeError,
	extractApiErrorMessage,
	isReportableApiResponse,
	parseDsn,
	postEnvelope,
	setSentryDebug,
	shouldReportDeduped,
	type SentryEventContext
} from '../sentry-envelope.js';

function clientDebugEnabled(): boolean {
	try {
		if (new URLSearchParams(location.search).has('sentryDebug')) return true;
	} catch {
		// ignore
	}
	return (env as Record<string, string | undefined>).PUBLIC_SENTRY_DEBUG === '1';
}

function clientDsn(): string {
	return env.PUBLIC_SENTRY_DSN ?? '';
}

export function isClientSentryEnabled(): boolean {
	return browser && parseDsn(clientDsn()) !== null;
}

/** Capture an exception from browser code. Fire-and-forget at call sites. */
export function captureClientException(
	error: unknown,
	context: SentryEventContext = {}
): Promise<void> {
	try {
		if (!browser) return Promise.resolve();
		setSentryDebug(clientDebugEnabled());
		const dsn = parseDsn(clientDsn());
		if (!dsn) return Promise.resolve();
		const { type, value, stack } = describeError(error);
		const body = buildEnvelope({
			dsn,
			type,
			value,
			stack,
			context: { platform: 'javascript', runtimeName: 'browser', ...context },
			environment: 'client'
		});
		return postEnvelope(dsn.envelopeUrl, body);
	} catch {
		return Promise.resolve();
	}
}

let listenersInstalled = false;
let fetchWrapped = false;

/**
 * Report same-origin /api/* error responses. The app's fetch calls catch
 * failures and surface toasts, so window.onerror never sees them — without
 * this, client-visible breakage is invisible to Sentry. Throttled per
 * endpoint; network-level rejections (offline) are ignored to avoid noise.
 */
function wrapFetchForApiErrors(): void {
	if (fetchWrapped) return;
	fetchWrapped = true;
	const originalFetch = window.fetch.bind(window);
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const response = await originalFetch(input, init);
		try {
			reportFetchResponse(input, init?.method, response);
		} catch {
			// ignore
		}
		return response;
	}) as typeof window.fetch;
}

function reportFetchResponse(
	input: RequestInfo | URL,
	initMethod: string | undefined,
	response: Response
): void {
	const rawUrl =
		typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
	let pathname: string;
	try {
		const parsed = new URL(rawUrl, location.origin);
		if (parsed.origin !== location.origin) return;
		pathname = parsed.pathname;
	} catch {
		return;
	}
	if (!isReportableApiResponse(pathname, response.status, response.headers.get('content-type'))) {
		return;
	}
	const method = (initMethod ?? requestInputMethod(input) ?? 'GET').toUpperCase();
	if (!shouldReportDeduped(apiErrorDedupeKey('client', method, pathname, response.status))) return;
	void response
		.clone()
		.text()
		.then((text) => {
			const detail = extractApiErrorMessage(text);
			void captureClientException(
				new Error(
					`API ${method} ${pathname} failed (${response.status})${detail ? `: ${detail}` : ''}`
				),
				{ url: pathname, method, status: response.status }
			);
		})
		.catch(() => {});
}

function requestInputMethod(input: RequestInfo | URL): string | null {
	if (typeof input !== 'object' || input instanceof URL) return null;
	return (input as Request).method ?? null;
}

/** Mirror every console.error into Sentry (pass-through, throttled, no recursion). */
function hookConsoleError(): void {
	const original = console.error.bind(console);
	console.error = (...args: unknown[]) => {
		original(...args);
		try {
			const { value, stack } = describeConsoleArgs(args);
			if (!shouldReportDeduped(`console ${value.slice(0, 120)}`)) return;
			void captureClientException(stack ? Object.assign(new Error(value), { stack }) : value, {
				url: location.pathname
			});
		} catch {
			// ignore
		}
	};
}

/** Attach window error/rejection listeners. Safe to call repeatedly. */
export function initClientSentry(): void {
	if (!browser || listenersInstalled) return;
	listenersInstalled = true;
	hookConsoleError();
	const dsn = parseDsn(clientDsn());
	console.log(`[sentry] client reporting ${dsn ? 'enabled' : 'disabled (no PUBLIC_SENTRY_DSN)'}`);
	if (!dsn) return;
	if (location.protocol === 'https:' && dsn.envelopeUrl.startsWith('http://')) {
		console.warn(
			'[sentry] DSN uses http while this page is https — browsers block the report requests as mixed content. Serve the Sentry endpoint over https.'
		);
	}
	window.addEventListener('error', (event) => {
		void captureClientException(event.error ?? event.message, { url: location.pathname });
	});
	window.addEventListener('unhandledrejection', (event) => {
		void captureClientException(event.reason, { url: location.pathname });
	});
	wrapFetchForApiErrors();
}
