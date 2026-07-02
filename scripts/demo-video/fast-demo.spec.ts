import { test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import {
	ARTIFACTS_DIR,
	captureFrame,
	changeRegionFilter,
	editCellCode,
	exportFrameVideo,
	pause,
	prepareDemoPage,
	runCellByName,
	scrollToCell,
	setReportView,
	showCaption,
	showTitleCard,
	switchResultView,
	waitForAppReady
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('record fast demo video', async ({ page, browserName }, testInfo) => {
	test.skip(browserName !== 'chromium', 'Demo videos are recorded in Chromium only');
	test.setTimeout(600_000);

	fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
	const framesDir = path.join(ARTIFACTS_DIR, 'fast-demo-frames');
	fs.rmSync(framesDir, { recursive: true, force: true });
	fs.mkdirSync(framesDir, { recursive: true });
	const frames: { path: string; duration: number }[] = [];
	const snap = async (name: string, duration: number) => {
		frames.push({
			path: await captureFrame(
				page,
				path.join(framesDir, `${String(frames.length + 1).padStart(2, '0')}-${name}.png`)
			),
			duration
		});
	};

	await prepareDemoPage(page, { fresh: true });
	await waitForAppReady(page);
	await page.waitForLoadState('networkidle').catch(() => {});

	await showTitleCard(page, 'Notebook analytics', 'From raw SQL to shareable dashboards');
	await snap('title', 8);

	// Beat 1 — dependency DAG
	await showCaption(page, 'Every cell is a named SQL model');
	await page.locator('text=Sales Analytics Demo').first().scrollIntoViewIfNeeded();
	await pause(page, 1200);
	await page
		.locator('.mermaid, svg')
		.first()
		.scrollIntoViewIfNeeded()
		.catch(() => {});
	await snap('dependency-dag', 22);

	// Beat 2 — run all
	await showCaption(page, 'Run all cells');
	await page.getByRole('button', { name: 'Run', exact: true }).click();
	await pause(page, 450);
	await page.getByRole('menuitem', { name: /Run all cells/ }).click();
	await pause(page, 4000);
	await snap('run-all', 22);

	// Beat 3 — SQL cell references, live edit
	await showCaption(page, 'Standard SQL — cells reference each other by name');
	await scrollToCell(page, 'growth_analysis');
	await pause(page, 1000);
	await snap('sql-cell-before-edit', 24);
	const growthCode = `SELECT
  month,
  total_revenue,
  total_revenue - LAG(total_revenue) OVER (ORDER BY month) AS mom_delta,
  ROUND(100.0 * (total_revenue - LAG(total_revenue) OVER (ORDER BY month))
        / NULLIF(LAG(total_revenue) OVER (ORDER BY month), 0), 1) AS mom_pct
FROM monthly_revenue
WHERE total_revenue > 0
ORDER BY month`;
	await editCellCode(page, 'growth_analysis', growthCode);
	await showCaption(page, 'Live edit + run');
	await runCellByName(page, 'growth_analysis');
	await snap('sql-cell-after-run', 22);

	// Beat 4 — table / chart / stats
	await showCaption(page, 'Table, chart, and stats on any result');
	await scrollToCell(page, 'orders');
	await switchResultView(page, 'orders', 'stats');
	await snap('stats-view', 18);
	await switchResultView(page, 'orders', 'table');
	await snap('table-view', 16);
	await switchResultView(page, 'orders', 'chart');
	await snap('chart-view', 16);

	// Beat 5 — GUI pipeline power-up (tight)
	await showCaption(page, 'Optional visual pipeline builder');
	const regionCellId = await scrollToCell(page, 'region_performance');
	const regionCell = page.locator(`[data-cell-id="${regionCellId}"]`).last();
	await regionCell.getByRole('button', { name: 'PRQL' }).click();
	await snap('prql-text', 14);
	await regionCell.getByRole('button', { name: 'Visual' }).click();
	await snap('visual-pipeline', 18);

	// Beat 6 — interactive dashboard
	await showCaption(page, 'Live dashboard with interactive filters');
	await scrollToCell(page, 'region_filtered_orders');
	await page
		.locator('text=Explore by region')
		.first()
		.scrollIntoViewIfNeeded()
		.catch(() => {});
	await snap('dashboard-before-filter', 18);
	await changeRegionFilter(page, 'West');
	await snap('dashboard-filter-west', 18);
	await page.getByRole('tab', { name: 'By region' }).click();
	await snap('dashboard-by-region', 18);

	// Beat 7 — report view + close
	await showCaption(page, 'Report view — hide code, share the dashboard');
	await setReportView(page, true);
	await snap('report-view', 22);
	await showTitleCard(page, 'Lunapad', 'SQL notebooks → live dashboards');
	await snap('close', 8);

	await page.close();
	const mp4Path = path.join(ARTIFACTS_DIR, 'fast-demo.mp4');
	await exportFrameVideo(frames, mp4Path);
	await testInfo.attach('fast-demo.mp4', { path: mp4Path, contentType: 'video/mp4' });
});
