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
	buildEnvelope,
	describeError,
	parseDsn,
	postEnvelope,
	type SentryEventContext
} from '../sentry-envelope.js';

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

/** Attach window error/rejection listeners. Safe to call repeatedly. */
export function initClientSentry(): void {
	if (!browser || listenersInstalled) return;
	listenersInstalled = true;
	if (!parseDsn(clientDsn())) return;
	window.addEventListener('error', (event) => {
		void captureClientException(event.error ?? event.message, { url: location.pathname });
	});
	window.addEventListener('unhandledrejection', (event) => {
		void captureClientException(event.reason, { url: location.pathname });
	});
}
