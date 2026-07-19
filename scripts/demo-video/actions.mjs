// Real app-driving helpers, built on window.__testHelpers (the dev-only test bridge
// exposed by src/routes/+page.svelte) and the app's actual selectors/testids. No
// screenshot/stills capture lives here — see record.mjs / zoom.mjs for how the
// continuous video is produced and post-processed.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pause } from './overlay.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ARTIFACTS_DIR = path.resolve(__dirname, '../../artifacts/demo-videos');
export const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

// Generous timeout: cold DuckDB WASM init (worker spin-up + wasm compile) is the long
// pole here and its cost is genuinely variable under load — observed anywhere from ~2s to
// ~115s across otherwise-identical runs in this environment. Vite's first-time dependency
// pre-bundle (monaco-editor, duckdb-wasm, plotly.js, prqlc wasm) adds to the same budget
// on the very first navigation of a run. Later navigations are consistently fast.
const APP_READY_TIMEOUT = 300_000;

export async function waitForAppReady(page, timeoutMs = APP_READY_TIMEOUT) {
	await page.waitForFunction(() => Boolean(window.__testHelpers), undefined, {
		timeout: timeoutMs
	});
	// The app shell (File/View menus) only mounts once DuckDB WASM finishes initializing
	// (`{#if !dbReady}` in +page.svelte) — __testHelpers can exist slightly before that.
	await page.getByRole('button', { name: 'File', exact: true }).waitFor({ timeout: timeoutMs });
}

export async function waitForDemoNotebook(page, timeoutMs = APP_READY_TIMEOUT) {
	// Bootstrapping the demo notebook is often the first real DuckDB WASM use of a given
	// dev server process (worker init + wasm compile), so this can be slow once even after
	// the app shell itself is warm — same generous budget as APP_READY_TIMEOUT.
	await page.waitForSelector('text=Sales Analytics Demo', { timeout: timeoutMs });
}

// Silently pre-accepts/declines the analytics consent prompt (AnalyticsConsent.svelte)
// before the app ever mounts, so the "Help improve Lunapad" banner never appears on
// camera — every chapter is a fresh browser context/profile, so it would otherwise pop
// up at the start of every single chapter's recording.
function skipAnalyticsConsent(page) {
	return page.addInitScript(() => {
		localStorage.setItem('lunapad.analytics.consent', 'declined');
	});
}

// Retries a flaky first navigation: cold DuckDB-WASM init in this environment has been
// observed to occasionally stall well past what a slow-but-healthy load ever takes, with
// no error or console output — a dead wait rather than a crash. A plain reload (not a full
// re-navigation) is enough to recover, so retry a few times at a shorter timeout before
// spending the full generous budget on a last attempt.
async function retryNavigation(fn, { attempts = 3, timeouts = [45_000, 90_000, APP_READY_TIMEOUT] } = {}) {
	let lastErr;
	for (let i = 0; i < attempts; i++) {
		try {
			return await fn(timeouts[Math.min(i, timeouts.length - 1)], i > 0);
		} catch (err) {
			lastErr = err;
			console.warn(`  [retry ${i + 1}/${attempts}] navigation stalled, retrying: ${err.message}`);
		}
	}
	throw lastErr;
}

// Fresh load, no ?demo=1 — lands on whatever the app shows a first-time visitor, so the
// intro chapter can show the *real* template gallery entry point instead of silently
// teleporting straight into the demo notebook.
export async function loadFresh(page) {
	await page.addInitScript(() => {
		localStorage.clear();
		localStorage.setItem('lunapad_welcome_seen', '1');
	});
	await skipAnalyticsConsent(page);
	await retryNavigation(async (timeoutMs, isRetry) => {
		if (isRetry) await page.reload({ waitUntil: 'domcontentloaded' });
		else await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForAppReady(page, timeoutMs);
	});
}

// Skip the gallery click-through and land directly on the demo notebook — used by every
// chapter after `intro`, since each chapter is its own browser context/recording and
// doesn't need to re-perform a beat that's already been shown once.
export async function loadDemoDirect(page) {
	await skipAnalyticsConsent(page);
	await retryNavigation(async (timeoutMs, isRetry) => {
		if (isRetry) await page.reload({ waitUntil: 'domcontentloaded' });
		else await page.goto('/?demo=1', { waitUntil: 'domcontentloaded' });
		await waitForAppReady(page, timeoutMs);
		await waitForDemoNotebook(page, timeoutMs);
	});
}

export async function openTemplateGalleryAndPick(page, templateName = 'Sales Analytics Demo') {
	await page.getByRole('button', { name: 'File', exact: true }).click();
	await pause(page, 300);
	await page.getByRole('menuitem', { name: /Browse templates/ }).click();
	await pause(page, 500);
	// Scope to the open dialog — a same-named element can otherwise already exist behind
	// it (e.g. a notebook tab from a prior bootstrap), which a page-wide role query would
	// happily match and then fail to click since the dialog overlay intercepts it.
	await page
		.getByRole('dialog')
		.getByRole('button', { name: new RegExp(templateName) })
		.first()
		.click();
	await waitForDemoNotebook(page);
}

export async function getCellId(page, outputName) {
	const id = await page.evaluate(
		(name) => window.__testHelpers.getCellByOutputName(name)?.id ?? null,
		outputName
	);
	if (!id) throw new Error(`Cell not found: ${outputName}`);
	return id;
}

export function cellLocator(page, cellId) {
	return page.locator(`[data-cell-id="${cellId}"]`).last();
}

export async function scrollToCell(page, outputName) {
	const cellId = await getCellId(page, outputName);
	await cellLocator(page, cellId).scrollIntoViewIfNeeded();
	await pause(page, 350);
	return cellId;
}

export async function waitForCellSuccess(page, outputName, timeout = 90_000) {
	await page.waitForFunction(
		(name) => {
			const cell = window.__testHelpers.getCellByOutputName(name);
			return cell?.status === 'success' && (cell.result?.rows?.length ?? 0) > 0;
		},
		outputName,
		{ timeout }
	);
}

export async function runAllCells(page) {
	await page.evaluate(async () => {
		await window.__testHelpers.runAll();
	});
	await waitForCellSuccess(page, 'orders', 45_000);
	await waitForCellSuccess(page, 'growth_analysis', 45_000).catch(() => {});
	await waitForCellSuccess(page, 'region_performance', 45_000).catch(() => {});
}

export async function editCellCode(page, outputName, code) {
	const cellId = await scrollToCell(page, outputName);
	await page.evaluate(
		({ id, code }) => window.__testHelpers.updateCellCode(id, code),
		{ id: cellId, code }
	);
}

export async function runCellByName(page, outputName) {
	const cellId = await getCellId(page, outputName);
	await page.evaluate(async (id) => {
		await window.__testHelpers.runCell(id);
	}, cellId);
	await waitForCellSuccess(page, outputName);
}

export async function switchResultView(page, outputName, mode) {
	const cellId = await scrollToCell(page, outputName);
	const cell = cellLocator(page, cellId);
	// The Table/Chart/Stats switcher is hover-revealed (NotebookCell.svelte's `revealed`
	// derived + aria-hidden while not hovered/focused) — role-based queries skip
	// aria-hidden subtrees entirely, so the tab doesn't exist to Playwright until the
	// cell is actually hovered first.
	await cell.hover();
	// ResultViewModeSwitcher.svelte's wrapper is role="toolbar" and its buttons carry no
	// ARIA role at all (just aria-label) — getByRole('tab', ...) can never match them, which
	// is a real, deterministic selector bug (not a load-related flake): it was guaranteed to
	// time out regardless of how fast the render settles. data-testid is the switcher's actual
	// intended test hook (`result-view-table` / `result-view-chart` / `result-view-stats`).
	await cell.getByTestId(`result-view-${mode}`).click();
}

export async function setReportView(page, enabled) {
	await page.evaluate((on) => window.__testHelpers.setNotebookReportView(on), enabled);
}

export async function changeRegionFilter(page, region) {
	const select = page
		.locator('.md-filter')
		.filter({ hasText: 'Region' })
		.locator('select.md-filter-control');
	await select.scrollIntoViewIfNeeded();
	await select.selectOption(region);
}

export async function clickMenuItem(page, menu, item) {
	await page.getByRole('button', { name: menu, exact: true }).click();
	await pause(page, 300);
	await page.getByRole('menuitem', { name: item }).click();
}

// Every chapter is a fresh browser profile, so the sidebar always starts expanded — collapse
// it before any beat's caption appears. The real dev workspace behind it is a single
// Postgres-backed row shared by every recording run this session (and everyone else's local
// testing), so it accumulates stray notebooks/folders over time; rather than reaching into
// that shared store, simplest and most robust is to just never show the sidebar on camera.
export async function collapseSidebar(page) {
	await page.keyboard.press('Meta+b').catch(() => {});
}

// Same root cause as collapseSidebar, different UI element: the shared workspace's
// `openNotebookTabIds` has accumulated every notebook ever opened across every local test
// run, so the tab strip renders a long row of stray tabs ("Notebook 2", "Fixed Model 2", …)
// above the actual content. There's a dedicated show/hide toggle for the whole strip
// (independent of closing any individual tab, which would mutate the shared workspace) —
// use that instead of touching tab state.
export async function hideNotebookTabs(page) {
	await page
		.getByRole('button', { name: 'Hide notebook tabs' })
		.click()
		.catch(() => {});
}

export async function dismissOverlays(page) {
	await page.keyboard.press('Escape').catch(() => {});
	await page.mouse.move(720, 460).catch(() => {});
	await pause(page, 200);
}

export async function canAddPythonCell(page) {
	return page.evaluate(() => window.__testHelpers.canAddPythonCell?.() ?? false);
}

export async function addPythonCell(page) {
	return page.evaluate(() => window.__testHelpers.addPythonCell?.() ?? null);
}

export async function openAiPanel(page) {
	await page.getByTestId('ai-toggle').click();
}

export async function sendAiPrompt(page, text) {
	await page.getByTestId('ai-input').fill(text);
	await pause(page, 400);
	await page.getByTestId('ai-send').click();
}

export async function ensureUploadFixture() {
	fs.mkdirSync(FIXTURES_DIR, { recursive: true });
	const csvPath = path.join(FIXTURES_DIR, 'sample-upload.csv');
	if (!fs.existsSync(csvPath)) {
		fs.writeFileSync(
			csvPath,
			`region,product,revenue,units
North,Laptop,24000,20
South,Phone,15980,20
East,Tablet,8980,20
West,Monitor,6980,20
Central,Keyboard,1580,20
`
		);
	}
	return csvPath;
}

// Bounding box in *viewport* pixels — the coordinate space zoom.mjs needs, since the
// recorded video frame is the viewport at the size passed to context.recordVideo.
export async function focusRect(page, locator) {
	const box = await locator.boundingBox();
	if (!box) return null;
	return {
		x: Math.round(box.x),
		y: Math.round(box.y),
		width: Math.round(box.width),
		height: Math.round(box.height)
	};
}

export async function cellFocusRect(page, outputName) {
	const cellId = await getCellId(page, outputName);
	return focusRect(page, cellLocator(page, cellId));
}
