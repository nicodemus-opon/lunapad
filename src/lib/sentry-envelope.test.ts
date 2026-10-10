import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	apiErrorDedupeKey,
	buildEnvelope,
	clearReportDedupCache,
	clearSentryTestState,
	describeConsoleArgs,
	describeError,
	extractApiErrorMessage,
	isReportableApiResponse,
	newEventId,
	parseDsn,
	parseStack,
	postEnvelope,
	setSentryDebug,
	shouldReportDeduped,
	SENTRY_DEDUPE_WINDOW_MS
} from './sentry-envelope.js';

describe('parseDsn', () => {
	it('parses a standard cloud DSN', () => {
		const parsed = parseDsn('https://abc123@o999.ingest.sentry.io/42');
		expect(parsed).not.toBeNull();
		expect(parsed?.envelopeUrl).toBe('https://o999.ingest.sentry.io/api/42/envelope/');
		expect(parsed?.projectId).toBe('42');
	});
	it('supports ports and self-hosted path prefixes', () => {
		const parsed = parseDsn('http://key@sentry.internal:9000/prefix/7');
		expect(parsed?.envelopeUrl).toBe('http://sentry.internal:9000/prefix/api/7/envelope/');
	});
	it('rejects empty and malformed input', () => {
		expect(parseDsn('')).toBeNull();
		expect(parseDsn(undefined)).toBeNull();
		expect(parseDsn('not-a-url')).toBeNull();
		expect(parseDsn('https://nokey@host/')).toBeNull();
		expect(parseDsn('https://key@host/notanumber')).toBeNull();
	});
});

describe('newEventId', () => {
	it('is 32 lowercase hex chars', () => {
		expect(newEventId()).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe('parseStack', () => {
	it('parses V8 frames oldest-first with in_app flags', () => {
		const stack = [
			'Error: boom',
			'    at handleRequest (/app/build/handler.js:10:15)',
			'    at async Module.job (node:internal/modules/cjs/loader:1200:11)',
			'    at run (/app/src/lib/server/db.ts:5:3)'
		].join('\n');
		const frames = parseStack(stack);
		expect(frames).toHaveLength(3);
		// Oldest call first.
		expect(frames[0].filename).toBe('/app/src/lib/server/db.ts');
		expect(frames[0].in_app).toBe(true);
		expect(frames[2].filename).toBe('/app/build/handler.js');
		expect(frames[1].in_app).toBe(false);
		expect(frames[0].lineno).toBe(5);
		expect(frames[0].colno).toBe(3);
	});
	it('strips file:// URLs and skips native frames', () => {
		const stack = ['Error: x', '    at load (file:///app/src/a.ts:1:1)', '    at native'].join(
			'\n'
		);
		const frames = parseStack(stack);
		expect(frames).toHaveLength(1);
		expect(frames[0].filename).toBe('/app/src/a.ts');
	});
	it('returns no frames without a stack', () => {
		expect(parseStack(undefined)).toEqual([]);
	});
});

describe('buildEnvelope', () => {
	const dsn = parseDsn('https://key@o1.ingest.sentry.io/9')!;
	it('emits a 3-line envelope with matching byte length', () => {
		const body = buildEnvelope({
			dsn,
			type: 'Error',
			value: 'boom',
			stack: 'Error: boom\n    at f (/a.ts:1:2)'
		});
		const [header, item, payload] = body.split('\n');
		expect(JSON.parse(header).dsn).toBe('https://key@o1.ingest.sentry.io/9');
		expect(JSON.parse(header).event_id).toMatch(/^[0-9a-f]{32}$/);
		const itemHeader = JSON.parse(item);
		expect(itemHeader.type).toBe('event');
		expect(itemHeader.length).toBe(new TextEncoder().encode(payload).length);
		const event = JSON.parse(payload);
		expect(event.exception.values[0].type).toBe('Error');
		expect(event.exception.values[0].stacktrace.frames).toHaveLength(1);
	});
	it('attaches safe request context only', () => {
		const body = buildEnvelope({
			dsn,
			type: 'Error',
			value: 'x',
			context: { url: '/api/jobs', method: 'POST', userId: 'u1', requestId: 'r1', status: 503 }
		});
		const event = JSON.parse(body.split('\n')[2]);
		expect(event.request).toEqual({ url: '/api/jobs', method: 'POST' });
		expect(event.user).toEqual({ id: 'u1' });
		expect(event.tags).toEqual({ request_id: 'r1', status_code: '503' });
		expect(JSON.stringify(event)).not.toContain('cookie');
	});
});

describe('api error policy', () => {
	it('reports every 4xx/5xx on /api/*, including health checks', () => {
		expect(isReportableApiResponse('/api/presence', 503, 'application/json')).toBe(true);
		expect(isReportableApiResponse('/api/presence', 500, null)).toBe(true);
		expect(isReportableApiResponse('/api/presence', 404, 'application/json')).toBe(true);
		expect(isReportableApiResponse('/api/jobs', 401, 'application/json')).toBe(true);
		expect(isReportableApiResponse('/api/health/live', 500, 'application/json')).toBe(true);
		expect(isReportableApiResponse('/api/jobs', 200, 'application/json')).toBe(false);
		expect(isReportableApiResponse('/r/report', 500, 'text/html')).toBe(false);
		expect(isReportableApiResponse('/api/report', 500, 'text/html')).toBe(true);
		expect(isReportableApiResponse('/api/stream', 500, 'text/event-stream')).toBe(false);
	});

	it('extracts the {error} message with a length bound', () => {
		expect(extractApiErrorMessage(JSON.stringify({ error: '  Failed badly. ' }))).toBe(
			'Failed badly.'
		);
		expect(extractApiErrorMessage(JSON.stringify({ message: 'thrown probe' }))).toBe(
			'thrown probe'
		);
		expect(extractApiErrorMessage('plain text failure')).toBe('plain text failure');
		expect(extractApiErrorMessage('x'.repeat(1000)).length).toBeLessThanOrEqual(500);
		expect(extractApiErrorMessage('not json {{{')).toBe('not json {{{'.slice(0, 500));
	});
});

describe('shouldReportDeduped', () => {
	it('throttles repeats inside the window, allows new keys and expiry', () => {
		clearReportDedupCache();
		const key = apiErrorDedupeKey('server', 'GET', '/api/presence', 503);
		expect(shouldReportDeduped(key, 1000)).toBe(true);
		expect(shouldReportDeduped(key, 1001)).toBe(false);
		expect(
			shouldReportDeduped(apiErrorDedupeKey('server', 'POST', '/api/presence', 503), 1001)
		).toBe(true);
		expect(shouldReportDeduped(key, 1000 + SENTRY_DEDUPE_WINDOW_MS)).toBe(true);
		clearReportDedupCache();
	});
});

describe('describeConsoleArgs', () => {
	it('formats tagged messages with printf substitution', () => {
		expect(describeConsoleArgs(['[presence GET] failed:', new TypeError('bad')]).value).toBe(
			'[presence GET] failed: TypeError: bad'
		);
		const withStack = describeConsoleArgs(['oops %s %d', 'x', 3]);
		expect(withStack.value).toBe('oops x 3');
		expect(withStack.stack).toBeUndefined();
	});

	it('lifts the first Error stack and stringifies objects', () => {
		const err = new Error('boom');
		const described = describeConsoleArgs(['ctx', err, { code: 7 }]);
		expect(described.value).toBe('ctx Error: boom {"code":7}');
		expect(described.stack).toContain('Error: boom');
	});

	it('never throws and always returns a value', () => {
		expect(describeConsoleArgs([]).value).toBe('console.error');
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(describeConsoleArgs([circular]).value).toBeDefined();
	});
});

describe('describeError', () => {
	it('normalizes Error, string, and exotic values', () => {
		const err = new TypeError('bad');
		expect(describeError(err)).toMatchObject({ type: 'TypeError', value: 'bad' });
		expect(describeError(err).stack).toContain('TypeError');
		expect(describeError('plain')).toMatchObject({ type: 'Error', value: 'plain' });
		expect(describeError(undefined).value).toBeDefined();
	});
});

describe('postEnvelope', () => {
	let server: Server;
	let received: { url: string; contentType: string; body: string }[];
	let port: number;

	beforeAll(async () => {
		received = [];
		server = createServer((req, res) => {
			let data = '';
			req.on('data', (chunk) => (data += chunk));
			req.on('end', () => {
				received.push({
					url: req.url ?? '',
					contentType: String(req.headers['content-type']),
					body: data
				});
				if ((req.url ?? '').includes('/forbidden/')) {
					res.writeHead(403).end('{"detail":"forbidden"}');
					return;
				}
				res.writeHead(200).end('{}');
			});
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		port = (server.address() as { port: number }).port;
	});

	afterAll(async () => {
		await new Promise((resolve) => server.close(resolve));
	});

	it('POSTs the envelope to a DSN-derived URL', async () => {
		const dsn = parseDsn(`http://key@127.0.0.1:${port}/sentry/5`)!;
		expect(dsn.envelopeUrl).toBe(`http://127.0.0.1:${port}/sentry/api/5/envelope/`);
		await postEnvelope(dsn.envelopeUrl, 'test-body');
		expect(received).toHaveLength(1);
		expect(received[0].url).toBe('/sentry/api/5/envelope/');
		expect(received[0].contentType).toBe('application/x-sentry-envelope');
		expect(received[0].body).toBe('test-body');
	});

	it('never throws when the endpoint is unreachable', async () => {
		await expect(postEnvelope('http://127.0.0.1:1/api/1/envelope/', 'x')).resolves.toBeUndefined();
	});

	it('warns once about rejected sends only when debug is on', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			clearSentryTestState();
			const dsn = parseDsn(`http://key@127.0.0.1:${port}/forbidden/6`)!;
			await postEnvelope(dsn.envelopeUrl, 'x');
			expect(warn).not.toHaveBeenCalled();
			setSentryDebug(true);
			await postEnvelope(dsn.envelopeUrl, 'x');
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0][0]).toContain('403');
			// Throttled: repeat rejection stays silent.
			await postEnvelope(dsn.envelopeUrl, 'x');
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
			clearSentryTestState();
		}
	});
});
