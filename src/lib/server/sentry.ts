/**
 * Server-side Sentry error reporting (via $lib/sentry-envelope.ts, no SDK).
 *
 * Reads SENTRY_DSN at call time from process.env so Docker/Coolify runtime env
 * works without a rebuild. Empty DSN -> every function below is a no-op.
 */
import {
	buildEnvelope,
	describeError,
	parseDsn,
	postEnvelope,
	type SentryEventContext
} from '../sentry-envelope.js';

function serverMeta(): { environment: string; release?: string } {
	return {
		environment:
			process.env.SENTRY_ENVIRONMENT ??
			process.env.DEPLOYMENT_MODE ??
			process.env.NODE_ENV ??
			'production',
		release: process.env.SENTRY_RELEASE || undefined
	};
}

export function isServerSentryEnabled(): boolean {
	return parseDsn(process.env.SENTRY_DSN) !== null;
}

export interface ServerCaptureContext extends SentryEventContext {
	platform?: string;
}

/** Capture an exception. Returns a promise; call sites fire-and-forget. */
export function captureServerException(
	error: unknown,
	context: ServerCaptureContext = {}
): Promise<void> {
	try {
		const dsn = parseDsn(process.env.SENTRY_DSN);
		if (!dsn) return Promise.resolve();
		const { type, value, stack } = describeError(error);
		const { environment, release } = serverMeta();
		const body = buildEnvelope({
			dsn,
			type,
			value,
			stack,
			context: {
				platform: 'node',
				runtimeName: 'node',
				runtimeVersion: process.version,
				...context
			},
			environment,
			release
		});
		return postEnvelope(dsn.envelopeUrl, body);
	} catch {
		return Promise.resolve();
	}
}

let processHandlersInstalled = false;

/**
 * Report uncaught exceptions / unhandled rejections to Sentry. Safe to call
 * multiple times and during builds (registers process handlers only live).
 */
export function initServerSentry(): void {
	if (processHandlersInstalled) return;
	processHandlersInstalled = true;
	if (!process.env.SENTRY_DSN?.trim()) return;
	process.on('uncaughtException', (err) => {
		void captureServerException(err, { requestId: 'process:uncaughtException' });
	});
	process.on('unhandledRejection', (reason) => {
		void captureServerException(reason, { requestId: 'process:unhandledRejection' });
	});
}
