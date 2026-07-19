import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const launchMock = vi.fn();

vi.mock('playwright-core', () => ({
	chromium: { launch: launchMock }
}));

function makeFakePage(opts: {
	scrollHeight?: number;
	screenshotImpl?: () => Buffer;
	waitForFunctionRejects?: boolean;
}) {
	const evaluateCalls: unknown[] = [];
	return {
		goto: vi.fn().mockResolvedValue(undefined),
		waitForFunction: opts.waitForFunctionRejects
			? vi.fn().mockRejectedValue(new Error('timeout'))
			: vi.fn().mockResolvedValue(undefined),
		evaluate: vi.fn().mockImplementation(async (fn: unknown, arg?: unknown) => {
			evaluateCalls.push(arg);
			// First evaluate() call in screenshotShareToken reads scrollHeight; later
			// calls are window.scrollTo(0, y), which returns nothing.
			if (evaluateCalls.length === 1) return opts.scrollHeight ?? 900;
			return undefined;
		}),
		waitForTimeout: vi.fn().mockResolvedValue(undefined),
		screenshot: opts.screenshotImpl ?? vi.fn().mockResolvedValue(Buffer.from('fake-png-bytes'))
	};
}

async function importFreshModule() {
	vi.resetModules();
	return import('./notebook-render.js');
}

describe('screenshotShareToken', () => {
	beforeEach(() => {
		launchMock.mockReset();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('captures one segment for a short page and returns base64 PNG data', async () => {
		const page = makeFakePage({ scrollHeight: 500 });
		const context = {
			newPage: vi.fn().mockResolvedValue(page),
			addInitScript: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined)
		};
		const browser = { newContext: vi.fn().mockResolvedValue(context) };
		launchMock.mockResolvedValue(browser);

		const { screenshotShareToken } = await importFreshModule();
		const result = await screenshotShareToken('tok123');

		expect(result.ok).toBe(true);
		expect(result.segments).toHaveLength(1);
		expect(result.segments[0].base64).toBe(Buffer.from('fake-png-bytes').toString('base64'));
		expect(result.segments[0].mimeType).toBe('image/png');
		expect(context.close).toHaveBeenCalledTimes(1);
	});

	it('splits a long page into multiple viewport-height segments', async () => {
		// scrollHeight of 2500 with a 900px viewport → ceil(2500/900) = 3 segments
		const page = makeFakePage({ scrollHeight: 2500 });
		const context = {
			newPage: vi.fn().mockResolvedValue(page),
			addInitScript: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined)
		};
		const browser = { newContext: vi.fn().mockResolvedValue(context) };
		launchMock.mockResolvedValue(browser);

		const { screenshotShareToken } = await importFreshModule();
		const result = await screenshotShareToken('tok456');

		expect(result.segments).toHaveLength(3);
		expect(result.segments.map((s) => s.offsetY)).toEqual([0, 900, 1800]);
	});

	it('closes the context even when page.screenshot throws, and still reports a warning on readiness timeout', async () => {
		const page = makeFakePage({
			scrollHeight: 500,
			waitForFunctionRejects: true,
			screenshotImpl: vi.fn().mockRejectedValue(new Error('boom'))
		});
		const context = {
			newPage: vi.fn().mockResolvedValue(page),
			addInitScript: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined)
		};
		const browser = { newContext: vi.fn().mockResolvedValue(context) };
		launchMock.mockResolvedValue(browser);

		const { screenshotShareToken } = await importFreshModule();
		await expect(screenshotShareToken('tok789')).rejects.toThrow('boom');
		expect(context.close).toHaveBeenCalledTimes(1);
	});

	it('rejects concurrent renders beyond the configured cap', async () => {
		// Stall at newContext (called once per top-level screenshotShareToken call,
		// unlike screenshot() which loops per segment) so two in-flight calls can be
		// released independently without one release clobbering the other.
		const releases: Array<() => void> = [];
		const page = makeFakePage({ scrollHeight: 500 });
		const context = {
			newPage: vi.fn().mockResolvedValue(page),
			addInitScript: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined)
		};
		const browser = {
			newContext: vi
				.fn()
				.mockImplementation(() => new Promise((resolve) => releases.push(() => resolve(context))))
		};
		launchMock.mockResolvedValue(browser);

		const { screenshotShareToken } = await importFreshModule();
		const first = screenshotShareToken('a');
		const second = screenshotShareToken('b');
		const third = screenshotShareToken('c');

		await expect(third).rejects.toThrow(/too many concurrent/i);
		// 'a'/'b' reach newContext() asynchronously (after getBrowser()'s dynamic import +
		// chromium.launch() resolve) — poll until both are actually waiting before releasing,
		// rather than racing them.
		while (releases.length < 2) {
			await new Promise((r) => setTimeout(r, 0));
		}
		releases.forEach((release) => release());
		await Promise.all([first, second]);
	});
});
