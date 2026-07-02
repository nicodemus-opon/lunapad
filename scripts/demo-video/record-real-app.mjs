import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('artifacts/demo-videos');
const PORT = process.env.DEMO_VIDEO_PORT ?? '5897';
const BASE = `http://localhost:${PORT}`;
const MODE = process.argv[2] === 'full' ? 'full' : 'fast';

fs.mkdirSync(OUT, { recursive: true });

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(proc) {
	const started = Date.now();
	while (Date.now() - started < 120_000) {
		if (proc.exitCode !== null) throw new Error(`dev server exited with ${proc.exitCode}`);
		try {
			const res = await fetch(BASE);
			if (res.status < 500) return;
		} catch {
			// keep waiting
		}
		await sleep(500);
	}
	throw new Error('Timed out waiting for dev server');
}

async function caption(page, text, ms = 1800) {
	await page.evaluate((value) => {
		document.getElementById('real-demo-caption')?.remove();
		const el = document.createElement('div');
		el.id = 'real-demo-caption';
		el.textContent = value;
		el.style.cssText = [
			'position:fixed',
			'left:50%',
			'bottom:42px',
			'transform:translateX(-50%)',
			'z-index:999999',
			'padding:12px 22px',
			'border-radius:12px',
			'background:rgba(2,6,23,0.88)',
			'color:white',
			'font:600 18px/1.35 system-ui,-apple-system,sans-serif',
			'box-shadow:0 16px 42px rgba(0,0,0,0.28)',
			'pointer-events:none'
		].join(';');
		document.body.appendChild(el);
	}, text);
	await sleep(ms);
	await page.evaluate(() => document.getElementById('real-demo-caption')?.remove());
}

async function helpers(page) {
	await page.waitForFunction(() => Boolean(window.__testHelpers), undefined, { timeout: 90_000 });
	return page.evaluateHandle(() => window.__testHelpers);
}

async function scrollToCell(page, outputName) {
	const cellId = await page.evaluate((name) => {
		const h = window.__testHelpers;
		return h.getCellByOutputName(name)?.id ?? null;
	}, outputName);
	if (!cellId) throw new Error(`Missing cell ${outputName}`);
	await page.locator(`[data-cell-id="${cellId}"]`).last().scrollIntoViewIfNeeded();
	await sleep(800);
	return cellId;
}

async function runAll(page) {
	// Drive Run-all through the app helper instead of opening the Run menu, so no
	// dropdown overlay is left hanging over the rest of the recording.
	await page.evaluate(async () => {
		await window.__testHelpers.runAll();
	});
	await sleep(4000);
}

async function dismissOverlays(page) {
	// Close any menu/dropdown/dialog that a prior interaction may have left open,
	// then move the pointer to a neutral spot so nothing hovers open on camera.
	await page.keyboard.press('Escape').catch(() => {});
	await page.mouse.click(12, 12).catch(() => {});
	await page.mouse.move(720, 460).catch(() => {});
	await sleep(300);
}

async function updateGrowthSql(page) {
	const cellId = await scrollToCell(page, 'growth_analysis');
	const code = `SELECT
  month,
  total_revenue,
  total_revenue - LAG(total_revenue) OVER (ORDER BY month) AS mom_delta,
  ROUND(100.0 * (total_revenue - LAG(total_revenue) OVER (ORDER BY month))
        / NULLIF(LAG(total_revenue) OVER (ORDER BY month), 0), 1) AS mom_pct
FROM monthly_revenue
WHERE total_revenue > 0
ORDER BY month`;
	await page.evaluate(
		async ({ cellId, code }) => {
			const h = window.__testHelpers;
			h.updateCellCode(cellId, code);
			await h.runCell(cellId);
		},
		{ cellId, code }
	);
	await sleep(1800);
}

async function switchResult(page, outputName, mode) {
	const cellId = await scrollToCell(page, outputName);
	await page.evaluate(
		({ cellId, mode }) => window.__testHelpers.setCellResultViewMode(cellId, mode.toLowerCase()),
		{ cellId, mode }
	);
	await sleep(1400);
}

async function setReportView(page, enabled) {
	await page.evaluate((value) => window.__testHelpers.setNotebookReportView(value), enabled);
	await sleep(1600);
}

async function convertVideo(webmPath, mp4Path, startOffset = 0) {
	const args = ['-y'];
	// Seek past the app startup / loading screen before decoding.
	if (startOffset > 0.1) args.push('-ss', startOffset.toFixed(2));
	args.push(
		'-i',
		webmPath,
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-crf',
		'20',
		'-pix_fmt',
		'yuv420p',
		mp4Path
	);
	execFileSync('ffmpeg', args, { stdio: 'inherit' });
}

async function recordFast() {
	const server = spawn('pnpm', ['exec', 'vite', 'dev', '--host', 'localhost', '--port', PORT], {
		env:
			MODE === 'full'
				? { ...process.env, DISABLE_AUTH: '1' }
				: { ...process.env, DEMO_MODE: '1', DISABLE_AUTH: '1' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	server.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
	server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));

	try {
		await waitForServer(server);
		const browser = await chromium.launch();
		const context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			recordVideo: { dir: OUT, size: { width: 1440, height: 900 } }
		});
		const page = await context.newPage();
		// Video recording begins ~when the page is created; mark that instant so we
		// can trim the loading screen off the front of the final file.
		const videoStart = Date.now();
		await page.goto(`${BASE}/?demo=1`, { waitUntil: 'domcontentloaded' });
		await helpers(page);
		await page.waitForSelector('text=Sales Analytics Demo', { timeout: 90_000 });
		// Wait until the demo notebook has actually rendered cells, not just a spinner.
		await page
			.waitForFunction(() => (window.__testHelpers.getCells?.() ?? []).length > 0, undefined, {
				timeout: 90_000
			})
			.catch(() => {});
		await sleep(2500);
		// Everything before this point is startup/loading — trim it from the output.
		const loadingTrimSec = Math.max(0, (Date.now() - videoStart) / 1000 - 0.4);

		await caption(page, 'Actual Lunapad app: Sales Analytics Demo', 2200);
		await page.locator('text=Sales Analytics Demo').first().scrollIntoViewIfNeeded();
		await sleep(1800);

		await caption(page, 'Run all cells: tables, charts, stats, dashboard widgets', 2200);
		await runAll(page);

		await caption(page, 'SQL-first: growth_analysis reads monthly_revenue', 2200);
		await updateGrowthSql(page);

		await caption(page, 'Same result, different lenses: Stats → Table → Chart', 2200);
		await switchResult(page, 'orders', 'Stats');
		await switchResult(page, 'orders', 'Table');
		await switchResult(page, 'orders', 'Chart');

		await caption(page, 'Optional visual pipeline on region_performance', 2200);
		const regionId = await scrollToCell(page, 'region_performance');
		await page.evaluate((cellId) => window.__testHelpers.setEditMode(cellId, 'prql'), regionId);
		await sleep(1600);
		await page.evaluate((cellId) => window.__testHelpers.setEditMode(cellId, 'gui'), regionId);
		await sleep(1800);

		await caption(page, 'Dashboard widgets backed by live cell results', 2200);
		await scrollToCell(page, 'region_filtered_orders');
		await page.locator('text=Explore by region').first().scrollIntoViewIfNeeded().catch(() => {});
		await sleep(1200);
		const select = page.locator('.md-filter').filter({ hasText: 'Region' }).locator('select').first();
		await select.selectOption('West').catch(() => {});
		await select.evaluate((el) => el.blur()).catch(() => {});
		await sleep(2000);
		await page.getByRole('tab', { name: 'By region' }).click().catch(() => {});
		await dismissOverlays(page);
		await sleep(1500);

		if (MODE === 'full') {
			await caption(page, 'Full app mode: command palette and workspace chrome', 3200);
			await page.keyboard.press('Meta+k').catch(() => {});
			await sleep(2600);
			await page.keyboard.press('Escape').catch(() => {});
			await sleep(1000);

			await caption(page, 'Upload data: actual app upload dialog', 3200);
			await page.getByRole('button', { name: 'Upload file' }).click().catch(() => {});
			await sleep(4500);
			await page.keyboard.press('Escape').catch(() => {});
			await sleep(1000);

			await caption(page, 'Settings and external database connections', 3400);
			await page.getByRole('button', { name: 'View', exact: true }).click().catch(() => {});
			await sleep(700);
			await page.getByRole('menuitem', { name: /Settings/ }).click().catch(() => {});
			await sleep(4500);
			await page.getByRole('tab', { name: /Connections/i }).click().catch(() => {});
			await sleep(4200);
			await page.keyboard.press('Escape').catch(() => {});
			await sleep(1000);

			await caption(page, 'Python cells are real, but project/runtime gated', 3400);
			await page
				.evaluate(() => ({
					canAddPython: window.__testHelpers.canAddPythonCell?.() ?? false
				}))
				.catch(() => ({ canAddPython: false }));
			await scrollToCell(page, 'orders');
			await sleep(5200);

			await caption(page, 'AI assistant panel in the actual app', 3400);
			await page.getByTestId('ai-toggle').click().catch(() => {});
			await sleep(5200);
			await page.getByTestId('ai-input').fill('Improve the growth analysis SQL').catch(() => {});
			await sleep(3200);

			await caption(page, 'Review inbox and collaboration surface', 3400);
			await page.getByRole('button', { name: 'Open review inbox' }).click().catch(() => {});
			await sleep(5200);
			await page.keyboard.press('Escape').catch(() => {});

			await caption(page, 'Share dialog: publish report links from this notebook', 3400);
			await page.getByRole('button', { name: 'View', exact: true }).click().catch(() => {});
			await sleep(700);
			await page.getByRole('menuitem', { name: /Share/ }).click().catch(() => {});
			await sleep(6000);
			await page.keyboard.press('Escape').catch(() => {});

			await caption(page, 'Sites: group multiple reports into a navigable app', 3400);
			await page.getByRole('button', { name: 'View', exact: true }).click().catch(() => {});
			await sleep(700);
			await page.getByRole('menuitem', { name: /Sites/ }).click().catch(() => {});
			await sleep(6000);
			await page.keyboard.press('Escape').catch(() => {});

			await caption(page, 'dbt appears when a project folder is open', 3600);
			await sleep(5000);
		}

		await caption(page, 'Report view: same notebook, stakeholder-ready', MODE === 'full' ? 3600 : 2200);
		await setReportView(page, true);
		await sleep(MODE === 'full' ? 9000 : 2600);

		const video = page.video();
		if (!video) throw new Error('No video produced');
		const webm = path.join(OUT, MODE === 'full' ? 'full-walkthrough-real.webm' : 'fast-demo-real.webm');
		const mp4 = path.join(OUT, MODE === 'full' ? 'full-walkthrough.mp4' : 'fast-demo.mp4');
		await page.close();
		await video.saveAs(webm);
		await context.close();
		await browser.close();
		await convertVideo(webm, mp4, loadingTrimSec);
		console.log(`Wrote ${mp4} (trimmed ${loadingTrimSec.toFixed(2)}s of startup)`);
	} finally {
		server.kill('SIGTERM');
	}
}

await recordFast();
