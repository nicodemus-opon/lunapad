/**
 * Server-side Sentry error reporting (via $lib/sentry-envelope.ts, no SDK).
 *
 * Reads SENTRY_DSN at call time from process.env so Docker/Coolify runtime env
 * works without a rebuild. Empty DSN -> every function below is a no-op.
 */
import {
	buildEnvelope,
	describeConsoleArgs,
	describeError,
	parseDsn,
	postEnvelope,
	setSentryDebug,
	shouldReportDeduped,
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
		setSentryDebug(process.env.SENTRY_DEBUG === '1');
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
		return postEnvelope(dsn.envelopeUrl, body, dsn.key);
	} catch {
		return Promise.resolve();
	}
}

let processHandlersInstalled = false;
let consoleHookInstalled = false;

/**
 * Mirror every console.error into Sentry. The app logs caught failures via
 * console.error instead of throwing, so without this those issues are
 * invisible. Pass-through: original behavior is fully preserved, and the
 * reporting path never calls console.error itself (no recursion).
 * Throttled per message prefix so a hot failing poller can't flood quota.
 */
function hookConsoleError(): void {
	if (consoleHookInstalled) return;
	consoleHookInstalled = true;
	const original = console.error.bind(console);
	console.error = (...args: unknown[]) => {
		original(...args);
		try {
			const { value, stack } = describeConsoleArgs(args);
			if (!shouldReportDeduped(`console ${value.slice(0, 120)}`)) return;
			void captureServerException(stack ? Object.assign(new Error(value), { stack }) : value);
		} catch {
			// ignore
		}
	};
}

/**
 * Report uncaught exceptions / unhandled rejections to Sentry. Safe to call
 * multiple times and during builds (registers process handlers only live).
 */
export function initServerSentry(): void {
	if (processHandlersInstalled) return;
	processHandlersInstalled = true;
	// Installed regardless of DSN: capture no-ops without one, and wrapping
	// late would miss early boot errors. Overhead per call is one format pass.
	hookConsoleError();
	if (!process.env.SENTRY_DSN?.trim()) return;
	process.on('uncaughtException', (err) => {
		void captureServerException(err, { requestId: 'process:uncaughtException' });
	});
	process.on('unhandledRejection', (reason) => {
		void captureServerException(reason, { requestId: 'process:unhandledRejection' });
	});
}
