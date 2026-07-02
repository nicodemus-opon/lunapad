import { test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import {
	ARTIFACTS_DIR,
	changeRegionFilter,
	clickMenuItem,
	editCellCode,
	ensureUploadFixture,
	exportVideo,
	pause,
	prepareDemoPage,
	runAllCells,
	runCellByName,
	scrollToCell,
	setReportView,
	showCaption,
	showFeatureCard,
	showPythonBeat,
	showTitleCard,
	switchResultView,
	waitForAppReady
} from './helpers';
import { installFullWalkthroughMocks } from './mocks';

test.describe.configure({ mode: 'serial' });

test('record full walkthrough video', async ({ page, browserName }, testInfo) => {
	test.skip(browserName !== 'chromium', 'Demo videos are recorded in Chromium only');
	test.setTimeout(900_000);

	fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
	await installFullWalkthroughMocks(page);
	await prepareDemoPage(page, { fresh: true });
	await waitForAppReady(page);

	await showTitleCard(
		page,
		'Full product walkthrough',
		'Notebooks, dashboards, AI, sharing, and more'
	);

	// 1 — orientation
	await showCaption(page, 'App shell: notebooks, data, dbt, and results');
	await page.getByRole('button', { name: 'View' }).click();
	await pause(page, 800);
	await page.keyboard.press('Escape');
	await clickMenuItem(page, 'View', /Toggle sidebar/);
	await pause(page, 1200);
	await clickMenuItem(page, 'View', /Toggle sidebar/);
	await pause(page, 800);

	// 2 — core notebook loop (SQL-led)
	await showCaption(page, 'Run the full notebook');
	await runAllCells(page);

	await showCaption(page, 'SQL cells reference upstream models by name');
	await scrollToCell(page, 'growth_analysis');
	await pause(page, 1200);
	await editCellCode(
		page,
		'growth_analysis',
		`SELECT
  month,
  ROUND(total_revenue, 0) AS total_revenue,
  total_revenue - LAG(total_revenue) OVER (ORDER BY month) AS mom_delta
FROM monthly_revenue
ORDER BY month`
	);
	await runCellByName(page, 'growth_analysis');
	await pause(page, 1200);

	await showCaption(page, 'Chart variety across models');
	for (const [name, label] of [
		['monthly_revenue', 'Area chart'],
		['order_value_distribution', 'Histogram'],
		['top_products', 'Horizontal bar']
	] as const) {
		await showCaption(page, label);
		await scrollToCell(page, name);
		await pause(page, 1200);
	}

	await switchResultView(page, 'orders', 'stats');
	await switchResultView(page, 'orders', 'table');
	await pause(page, 800);

	await showCaption(page, 'Visual pipeline builder (optional)');
	const regionCellId = await scrollToCell(page, 'region_performance');
	const regionCell = page.locator(`[data-cell-id="${regionCellId}"]`);
	await regionCell.getByRole('button', { name: 'PRQL' }).click();
	await pause(page, 1200);
	await regionCell.getByRole('button', { name: 'Visual' }).click();
	await pause(page, 1200);

	// 3 — command palette + upload
	await showCaption(page, 'Command palette');
	await page.keyboard.press('Meta+k');
	await pause(page, 1500);
	await page.keyboard.press('Escape');

	await showCaption(page, 'Upload CSV data');
	await page.getByRole('button', { name: 'Upload file' }).click();
	await pause(page, 800);
	const csvPath = await ensureUploadFixture();
	await page.locator('input[type="file"]').setInputFiles(csvPath);
	await pause(page, 1500);
	await page.getByRole('button', { name: /^Upload$/ }).click();
	await pause(page, 2000);
	await page.keyboard.press('Escape');

	// 4 — Python cells
	await showPythonBeat(page);

	// 4 — external connections (settings UI)
	await showCaption(page, 'Connect external databases');
	await clickMenuItem(page, 'View', /Settings/);
	await pause(page, 1200);
	await page
		.getByRole('tab', { name: /Connections/i })
		.click()
		.catch(() => {});
	await showFeatureCard(page, 'External sources', [
		'Postgres, ClickHouse, and warehouse connections live here',
		'Queries stay read-only on server-backed connections',
		'Use real credentials in a full deployment'
	]);
	await pause(page, 1800);
	await page.keyboard.press('Escape');

	// 5 — AI assistant
	await showCaption(page, 'AI assistant — build and fix models');
	await page.getByTestId('ai-toggle').click();
	await pause(page, 1200);
	await page
		.getByTestId('ai-input')
		.fill('Add a WHERE clause to growth_analysis so we only show positive revenue months');
	await pause(page, 800);
	await page.getByTestId('ai-send').click();
	await pause(page, 3000);

	// 6 — dbt workflow (panel visible when project open; show promote UI on a cell)
	await showCaption(page, 'Promote cells to dbt models');
	await showFeatureCard(page, 'dbt project mode', [
		'Open a dbt project folder to unlock the dbt panel',
		'Promote cells into model files',
		'Compile, run, test, schedule, and inspect lineage'
	]);
	await scrollToCell(page, 'orders');
	await page
		.getByRole('button', { name: /cell menu/i })
		.first()
		.click()
		.catch(async () => {
			await page.locator('[data-cell-id]').first().click({ button: 'right' });
		});
	await pause(page, 1200);
	await page.keyboard.press('Escape');

	// 7 — collaboration
	await showCaption(page, 'Comments and review');
	await page.getByRole('button', { name: 'Open review inbox' }).click();
	await pause(page, 1500);
	await page.keyboard.press('Escape');

	// 8 — share + sites
	await showCaption(page, 'Publish a shareable report');
	await clickMenuItem(page, 'View', /Share/);
	await pause(page, 2000);
	await page
		.getByRole('button', { name: /Publish/i })
		.click()
		.catch(() => {});
	await pause(page, 2000);
	await page.keyboard.press('Escape');

	await showCaption(page, 'Group reports into multi-page sites');
	await clickMenuItem(page, 'View', /Sites/);
	await pause(page, 2000);
	await page.keyboard.press('Escape');

	// 9 — dashboard + filter drill
	await showCaption(page, 'Interactive dashboard filters');
	await setReportView(page, false);
	await scrollToCell(page, 'region_filtered_orders');
	await page
		.locator('text=Explore by region')
		.first()
		.scrollIntoViewIfNeeded()
		.catch(() => {});
	await changeRegionFilter(page, 'West');
	await page.getByRole('tab', { name: 'Products' }).click();
	await pause(page, 1500);

	// 10 — close
	await showCaption(page, 'Report view for stakeholders');
	await setReportView(page, true);
	await pause(page, 2500);
	await showTitleCard(page, 'Lunapad', 'SQL notebooks → live dashboards → shared reports');

	const video = page.video();
	await page.close();
	if (!video) throw new Error('No video recorded');
	const webmPath = path.join(ARTIFACTS_DIR, 'full-walkthrough.webm');
	const mp4Path = path.join(ARTIFACTS_DIR, 'full-walkthrough.mp4');
	await video.saveAs(webmPath);
	await exportVideo(webmPath, mp4Path);
	await testInfo.attach('full-walkthrough.mp4', { path: mp4Path, contentType: 'video/mp4' });
});
