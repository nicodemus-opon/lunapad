import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5174';
const browser = await chromium.launch({ headless: false, slowMo: 200 });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('console', (msg) => {
	if (msg.type() === 'error') errors.push(msg.text());
});

// 1. LSP WebSocket check
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
const lspWs = await page.evaluate(
	() =>
		new Promise((resolve) => {
			const ws = new WebSocket('ws://localhost:5174/api/lsp');
			const t = setTimeout(() => resolve('timeout'), 3000);
			ws.onopen = () => {
				clearTimeout(t);
				ws.close();
				resolve('connected');
			};
			ws.onerror = () => {
				clearTimeout(t);
				resolve('error');
			};
		})
);
console.log(`LSP WebSocket: ${lspWs}`);

// 2. Setup if needed
if (page.url().includes('/setup')) {
	console.log('Completing first-run setup...');
	const inputs = page.locator('input');
	await inputs.nth(0).fill('Test User');
	await inputs.nth(1).fill('test@test.com');
	await inputs.nth(2).fill('password123');
	await inputs.nth(3).fill('password123');
	await page.locator('button:has-text("Create admin account")').click();
	await page.waitForURL('**/!(setup)', { timeout: 10000 }).catch(() => {});
	console.log(`  redirected to: ${page.url()}`);
}

await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/lsp-01-app.png' });
const editorCount = await page.locator('.monaco-editor').count();
console.log(`Monaco editors: ${editorCount}`);

if (editorCount > 0) {
	const editor = page.locator('.monaco-editor').first();
	await editor.locator('.view-lines').click();
	await page.keyboard.press('Meta+a');
	await page.keyboard.type('SELECT abs(');
	await page.waitForTimeout(1500);
	await page.screenshot({ path: '/tmp/lsp-02-sighelp.png' });
	const sigHelp = await page
		.locator('.parameter-hints-widget')
		.isVisible()
		.catch(() => false);
	console.log(`Signature help: ${sigHelp}`);

	await page.keyboard.press('Escape');
	await page.keyboard.press('Meta+a');
	await page.keyboard.type('SELECT app');
	await page.keyboard.press('Control+Space');
	await page.waitForTimeout(2000);
	await page.screenshot({ path: '/tmp/lsp-03-completions.png' });
	const suggestVisible = await page
		.locator('.suggest-widget')
		.isVisible()
		.catch(() => false);
	const approxRows = await page.locator('.monaco-list-row').filter({ hasText: 'approx' }).count();
	console.log(`Suggestions widget: ${suggestVisible}, approx_* rows: ${approxRows}`);

	await page.keyboard.press('Escape');
	await page.keyboard.press('Meta+a');
	await page.keyboard.type('SELECT approx_distinct(x) FROM t');
	await page.waitForTimeout(500);
	const line = editor.locator('.view-line').filter({ hasText: 'approx_distinct' }).first();
	const box = await line.boundingBox().catch(() => null);
	if (box) {
		await page.mouse.move(box.x + 70, box.y + 4);
		await page.waitForTimeout(2000);
		await page.screenshot({ path: '/tmp/lsp-04-hover.png' });
		const hoverText = (
			await page
				.locator('.monaco-hover-content')
				.allTextContents()
				.catch(() => [])
		).join(' ');
		console.log(`Hover: ${hoverText.slice(0, 150)}`);
	}
} else {
	await page.screenshot({ path: '/tmp/lsp-01b-noeditor.png' });
	console.log('No editor — check /tmp/lsp-01-app.png');
}

console.log(`Console errors: ${errors.length}`);
errors.slice(0, 3).forEach((e) => console.log(`  ✗ ${e.slice(0, 100)}`));
await browser.close();
