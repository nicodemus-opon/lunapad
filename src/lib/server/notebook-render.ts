import { publicOrigin } from './cloud-config.js';

export interface ScreenshotSegment {
	index: number;
	offsetY: number;
	base64: string;
	mimeType: 'image/png';
}

export interface ScreenshotResult {
	ok: boolean;
	segments: ScreenshotSegment[];
	warning?: string;
}

const VIEWPORT = { width: 1280, height: 900 };
// Hard cap so a pathologically long notebook can't produce hundreds of images in one call.
const MAX_SEGMENTS = 12;
const READINESS_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 20_000;

// Lazily imported so `playwright-core` (and its Chromium binary) is only ever touched by
// code paths that actually render a screenshot — avoids paying import cost / failing to
// load on deployments (e.g. Vercel) where headless Chromium isn't available at all.
type PlaywrightModule = typeof import('playwright-core');
let playwrightModule: Promise<PlaywrightModule> | null = null;
function loadPlaywright(): Promise<PlaywrightModule> {
	if (!playwrightModule) playwrightModule = import('playwright-core');
	return playwrightModule;
}

type Browser = import('playwright-core').Browser;
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
	if (!browserPromise) {
		browserPromise = loadPlaywright()
			.then(({ chromium }) => chromium.launch({ headless: true }))
			.catch((err) => {
				browserPromise = null;
				throw err;
			});
	}
	return browserPromise;
}

/**
 * Navigates a headless Chromium instance to an (ephemeral) share-report token and captures
 * the rendered notebook as a sequence of fixed-size viewport screenshots, scrolling top to
 * bottom, rather than one `fullPage` screenshot — a very long notebook would otherwise
 * produce a single arbitrarily tall PNG that a vision model downsamples, losing detail on
 * cells further down the page. Capped at MAX_SEGMENTS regardless of notebook length.
 */
const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;

export async function screenshotShareToken(token: string): Promise<ScreenshotResult> {
	if (activeRenders >= MAX_CONCURRENT_RENDERS) {
		throw new Error('Too many concurrent screenshot renders in progress. Try again shortly.');
	}
	activeRenders++;
	try {
		return await captureShareToken(token);
	} finally {
		activeRenders--;
	}
}

async function captureShareToken(token: string): Promise<ScreenshotResult> {
	const browser = await getBrowser();
	const context = await browser.newContext({ viewport: VIEWPORT });
	// Pre-empt the analytics-consent banner (AnalyticsConsent.svelte, mounted globally in
	// +layout.svelte) — a fresh headless profile has no prior consent choice, so it always
	// pops up and covers part of the page. "declined" is deliberate: a bot render should
	// never opt this workspace into analytics tracking.
	await context.addInitScript(() => {
		window.localStorage.setItem('lunapad.analytics.consent', 'declined');
	});
	const page = await context.newPage();
	try {
		// 'domcontentloaded', not 'networkidle': this app (like most real SPAs with
		// analytics/polling) never truly goes network-idle, so networkidle would just
		// burn the full timeout on every call. The explicit waitForFunction below is the
		// real readiness signal — confirmed via manual testing against a live dev server.
		await page.goto(`${publicOrigin()}/r/${token}?embed=1`, {
			waitUntil: 'domcontentloaded',
			timeout: NAVIGATION_TIMEOUT_MS
		});

		let warning: string | undefined;
		await page
			.waitForFunction(
				() => {
					if (document.querySelectorAll('.is-loading').length > 0) return false;
					const plots = document.querySelectorAll('[data-plot]');
					const readyPlots = document.querySelectorAll('[data-plot-ready]');
					return plots.length === readyPlots.length;
				},
				{ timeout: READINESS_TIMEOUT_MS }
			)
			.catch(() => {
				warning =
					'Timed out waiting for cells/charts to finish rendering; screenshot may be incomplete.';
			});

		const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
		const segmentCount = Math.min(
			MAX_SEGMENTS,
			Math.max(1, Math.ceil(fullHeight / VIEWPORT.height))
		);
		const segments: ScreenshotSegment[] = [];
		for (let i = 0; i < segmentCount; i++) {
			const offsetY = i * VIEWPORT.height;
			await page.evaluate((y) => window.scrollTo(0, y), offsetY);
			await page.waitForTimeout(50); // let sticky/lazy content settle after scroll
			const buffer = await page.screenshot({ type: 'png' }); // viewport-only, not fullPage
			segments.push({
				index: i,
				offsetY,
				base64: buffer.toString('base64'),
				mimeType: 'image/png'
			});
		}
		if (segmentCount === MAX_SEGMENTS && fullHeight > segmentCount * VIEWPORT.height) {
			warning = `${warning ? warning + ' ' : ''}Notebook exceeds ${MAX_SEGMENTS} screens; only the first ${MAX_SEGMENTS} segments were captured.`;
		}

		return { ok: true, segments, warning };
	} finally {
		await context.close();
	}
}

/** Best-effort feature check so callers can fail with a clear diagnostic instead of an
 *  opaque crash on deployments (e.g. Vercel serverless) where headless Chromium can't run. */
export async function isScreenshotRenderingAvailable(): Promise<boolean> {
	if (process.env.SCREENSHOT_RENDER_DISABLED === '1') return false;
	try {
		await getBrowser();
		return true;
	} catch {
		return false;
	}
}
