import type { Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ARTIFACTS_DIR = path.resolve(__dirname, '../../artifacts/demo-videos');
export const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

const SPEED = Number(process.env.DEMO_VIDEO_SPEED ?? '1');

export async function pause(page: Page, ms: number): Promise<void> {
	await page.waitForTimeout(Math.round(ms * SPEED));
}

export async function showCaption(page: Page, text: string, duration = 2200): Promise<void> {
	await page.evaluate((caption) => {
		document.getElementById('demo-caption-overlay')?.remove();
		const el = document.createElement('div');
		el.id = 'demo-caption-overlay';
		el.style.cssText = [
			'position:fixed',
			'bottom:56px',
			'left:50%',
			'transform:translateX(-50%)',
			'background:rgba(15,23,42,0.88)',
			'color:#f8fafc',
			'padding:14px 28px',
			'border-radius:10px',
			'font:600 20px/1.35 system-ui,-apple-system,sans-serif',
			'letter-spacing:-0.01em',
			'z-index:99999',
			'pointer-events:none',
			'box-shadow:0 12px 40px rgba(0,0,0,0.35)'
		].join(';');
		el.textContent = caption;
		document.body.appendChild(el);
	}, text);
	await pause(page, duration);
	await page.evaluate(() => document.getElementById('demo-caption-overlay')?.remove());
}

export async function showTitleCard(page: Page, title: string, subtitle?: string): Promise<void> {
	await page.evaluate(
		({ title, subtitle }) => {
			document.getElementById('demo-title-overlay')?.remove();
			const el = document.createElement('div');
			el.id = 'demo-title-overlay';
			el.style.cssText = [
				'position:fixed',
				'inset:0',
				'display:flex',
				'flex-direction:column',
				'align-items:center',
				'justify-content:center',
				'background:linear-gradient(160deg,#0f172a 0%,#1e293b 55%,#0f172a 100%)',
				'color:#f8fafc',
				'z-index:100000',
				'pointer-events:none',
				'font-family:system-ui,-apple-system,sans-serif'
			].join(';');
			el.innerHTML = `<div style="font-size:52px;font-weight:700;letter-spacing:-0.03em">Lunapad</div>
        <div style="margin-top:12px;font-size:24px;font-weight:500;opacity:0.9">${title}</div>
        ${subtitle ? `<div style="margin-top:10px;font-size:16px;opacity:0.65">${subtitle}</div>` : ''}`;
			document.body.appendChild(el);
		},
		{ title, subtitle }
	);
	await pause(page, 2800);
	await page.evaluate(() => document.getElementById('demo-title-overlay')?.remove());
}

type TestHelpers = {
	getCells: () => Array<{
		id: string;
		outputName: string;
		status: string;
		result?: { rows: unknown[] } | null;
	}>;
	getCellByOutputName: (name: string) => { id: string } | null;
	getActiveTabId: () => string | null;
	updateCellCode: (cellId: string, code: string) => void;
	runCell: (cellId: string) => Promise<void>;
	runAll: () => Promise<void>;
	setNotebookReportView: (enabled: boolean) => void;
	setCellResultViewMode: (cellId: string, mode: 'table' | 'chart' | 'stats') => void;
	setNotebookFilterValue: (notebookId: string, param: string, value: string) => void;
	canAddPythonCell: () => boolean;
	addPythonCell: () => string | null;
	bootstrapDemoNotebook: (opts?: {
		runCells?: boolean;
		replaceIfExists?: boolean;
	}) => Promise<void>;
	tick: () => Promise<void>;
};

async function helpers(page: Page): Promise<TestHelpers> {
	return page.evaluate(() => (window as unknown as { __testHelpers: TestHelpers }).__testHelpers);
}

export async function waitForAppReady(page: Page): Promise<void> {
	await page.waitForFunction(
		() => Boolean((window as unknown as { __testHelpers?: unknown }).__testHelpers),
		undefined,
		{ timeout: 60_000 }
	);
	await page.waitForSelector('text=Sales Analytics Demo', { timeout: 60_000 });
}

export async function waitForCellSuccess(
	page: Page,
	outputName: string,
	timeout = 90_000
): Promise<string> {
	const cellId = await page.waitForFunction(
		(name) => {
			const h = (window as unknown as { __testHelpers: TestHelpers }).__testHelpers;
			const cell = h.getCellByOutputName(name);
			return cell?.id ?? null;
		},
		outputName,
		{ timeout }
	);
	const id = (await cellId.jsonValue()) as string;
	await page.waitForFunction(
		({ name, id }) => {
			const h = (window as unknown as { __testHelpers: TestHelpers }).__testHelpers;
			const cell = h.getCells().find((c) => c.id === id || c.outputName === name);
			return cell?.status === 'success' && (cell.result?.rows?.length ?? 0) > 0;
		},
		{ name: outputName, id },
		{ timeout }
	);
	return id;
}

export async function scrollToCell(page: Page, outputName: string): Promise<string> {
	const cellId = await page.evaluate((name) => {
		const h = (window as unknown as { __testHelpers: TestHelpers }).__testHelpers;
		return h.getCellByOutputName(name)?.id ?? null;
	}, outputName);
	if (!cellId) throw new Error(`Cell not found: ${outputName}`);
	const locator = page.locator(`[data-cell-id="${cellId}"]`).last();
	await locator.scrollIntoViewIfNeeded();
	await pause(page, 400);
	return cellId;
}

export async function clickMenuItem(
	page: Page,
	menu: string,
	item: string | RegExp
): Promise<void> {
	await page.getByRole('button', { name: menu, exact: true }).click();
	await page.getByRole('menuitem', { name: item }).click();
}

export async function runAllCells(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Run', exact: true }).click();
	await pause(page, 450);
	await page.getByRole('menuitem', { name: /Run all cells/ }).click();
	await waitForCellSuccess(page, 'orders', 45_000);
	await waitForCellSuccess(page, 'growth_analysis', 45_000).catch(() => {});
	await waitForCellSuccess(page, 'region_performance', 45_000).catch(() => {});
	await pause(page, 1500);
}

export async function editCellCode(page: Page, outputName: string, code: string): Promise<void> {
	const cellId = await scrollToCell(page, outputName);
	await page.evaluate(
		({ id, nextCode }) => {
			const h = (window as unknown as { __testHelpers: TestHelpers }).__testHelpers;
			h.updateCellCode(id, nextCode);
		},
		{ id: cellId, nextCode: code }
	);
	await pause(page, 500);
}

export async function runCellByName(page: Page, outputName: string): Promise<void> {
	const cellId = await scrollToCell(page, outputName);
	await page.evaluate(async (id) => {
		const h = (window as unknown as { __testHelpers: TestHelpers }).__testHelpers;
		await h.runCell(id);
	}, cellId);
	await waitForCellSuccess(page, outputName);
}

export async function switchResultView(
	page: Page,
	outputName: string,
	mode: 'table' | 'chart' | 'stats'
) {
	const cellId = await scrollToCell(page, outputName);
	const cell = page.locator(`[data-cell-id="${cellId}"]`).last();
	await cell
		.getByRole('tab', { name: mode === 'table' ? 'Table' : mode === 'chart' ? 'Chart' : 'Stats' })
		.click();
	await pause(page, 1200);
}

export async function setReportView(page: Page, enabled: boolean): Promise<void> {
	await page.evaluate((on) => {
		const h = (window as unknown as { __testHelpers: TestHelpers }).__testHelpers;
		h.setNotebookReportView(on);
	}, enabled);
	await pause(page, 1200);
}

export async function changeRegionFilter(page: Page, region: string): Promise<void> {
	const select = page
		.locator('.md-filter')
		.filter({ hasText: 'Region' })
		.locator('select.md-filter-control');
	await select.scrollIntoViewIfNeeded();
	await select.selectOption(region);
	await pause(page, 1800);
}

export async function showFeatureCard(
	page: Page,
	title: string,
	lines: string[],
	duration = 2600
): Promise<void> {
	await page.evaluate(
		({ title, lines }) => {
			document.getElementById('demo-feature-card')?.remove();
			const el = document.createElement('div');
			el.id = 'demo-feature-card';
			el.style.cssText = [
				'position:fixed',
				'right:48px',
				'top:96px',
				'width:430px',
				'background:rgba(248,250,252,0.96)',
				'color:#0f172a',
				'border:1px solid rgba(15,23,42,0.12)',
				'border-radius:18px',
				'box-shadow:0 22px 70px rgba(15,23,42,0.28)',
				'padding:24px',
				'z-index:99998',
				'font-family:system-ui,-apple-system,sans-serif',
				'pointer-events:none'
			].join(';');
			el.innerHTML = `<div style="font-size:22px;font-weight:750;letter-spacing:-0.02em;margin-bottom:12px">${title}</div>
				<ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.55">
					${lines.map((line) => `<li>${line}</li>`).join('')}
				</ul>`;
			document.body.appendChild(el);
		},
		{ title, lines }
	);
	await pause(page, duration);
	await page.evaluate(() => document.getElementById('demo-feature-card')?.remove());
}

export async function showPythonBeat(page: Page): Promise<void> {
	await showCaption(page, 'Python cells for richer analysis');
	const pythonCellId = await page.evaluate(() => {
		const h = (window as unknown as { __testHelpers: TestHelpers }).__testHelpers;
		if (!h.canAddPythonCell()) return null;
		return h.addPythonCell();
	});

	if (pythonCellId) {
		await page.locator(`[data-cell-id="${pythonCellId}"]`).last().scrollIntoViewIfNeeded();
		await pause(page, 1800);
		await showFeatureCard(page, 'Python cell ready', [
			'Server-side Python worker is available',
			'Use pandas / Plotly against notebook results',
			'Promote derived data to dbt seeds'
		]);
		return;
	}

	await showFeatureCard(page, 'Python cells are gated intentionally', [
		'Requires a real project folder on disk',
		'Requires the server-side Python worker to be ready',
		'The add option unlocks automatically in full project mode'
	]);
}

export async function prepareDemoPage(page: Page, opts: { fresh?: boolean } = {}): Promise<void> {
	if (opts.fresh) {
		await page.addInitScript(() => {
			localStorage.clear();
			localStorage.setItem('lunapad_welcome_seen', '1');
		});
	}
	await page.goto('/?demo=1');
	await waitForAppReady(page);
}

export async function exportVideo(webmPath: string, mp4Path: string): Promise<void> {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const exec = promisify(execFile);
	await exec('ffmpeg', [
		'-y',
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
	]);
}

export async function captureFrame(page: Page, framePath: string): Promise<string> {
	await page.screenshot({ path: framePath, fullPage: false });
	return framePath;
}

export async function exportFrameVideo(
	frames: { path: string; duration: number }[],
	mp4Path: string
): Promise<void> {
	const fs = await import('node:fs');
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const exec = promisify(execFile);
	const listPath = `${mp4Path}.concat.txt`;
	const escapePath = (p: string) => p.replaceAll("'", "'\\''");
	const body = frames
		.flatMap((frame) => [
			`file '${escapePath(frame.path)}'`,
			`duration ${Math.max(frame.duration, 0.1).toFixed(3)}`
		])
		.concat(frames.length ? [`file '${escapePath(frames[frames.length - 1].path)}'`] : [])
		.join('\n');
	fs.writeFileSync(listPath, body);
	await exec('ffmpeg', [
		'-y',
		'-f',
		'concat',
		'-safe',
		'0',
		'-i',
		listPath,
		'-vf',
		'fps=30,format=yuv420p',
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-crf',
		'20',
		mp4Path
	]);
}

export async function ensureUploadFixture(): Promise<string> {
	const fs = await import('node:fs');
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

export { helpers };
