const { chromium } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:4216/';
const DATASET = '/Users/niconico/Documents/projects/my_proj/finances/since23.csv';
const QUERIES = [
	'who did i pay the most in january',
	'show where money leaks each month',
	'which vendors are becoming expensive lately'
];

async function switchToGuiMode(page) {
	const btn = page.locator('.notebook-cell').first().getByRole('button', { name: /Switch to GUI mode/i }).first();
	if (await btn.count()) await btn.click({ force: true });
	await page.waitForSelector('[data-testid="stage-card"]', { timeout: 15000 });
}

async function setFromTable(page, table) {
	const fromCard = page.locator('[data-testid="stage-card"][data-stage-type="from"]').first();
	await fromCard.locator('[data-testid="stage-header"]').click();
	await fromCard.getByRole('button').first().click();
	const sourceInput = page.getByPlaceholder('schema.table or cell_output').first();
	await sourceInput.fill(table);
	await sourceInput.press('Tab');
	await page.keyboard.press('Escape');
}

async function openPalette(page) {
	await page.locator('[data-testid="stage-card"]').first().focus();
	await page.keyboard.press('a');
	await page.getByPlaceholder('Prompt or search stages, templates, and columns...').waitFor({ timeout: 10000 });
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const records = [];
	try {
		await page.goto(APP_URL);
		await page.waitForSelector('.notebook-cell', { timeout: 20000 });
		await switchToGuiMode(page);
		await page.setInputFiles('input[type="file"][accept=".csv"]', DATASET);
		await page.waitForTimeout(1200);
		await setFromTable(page, 'since23');

		for (const query of QUERIES) {
			await openPalette(page);
			const input = page.getByPlaceholder('Prompt or search stages, templates, and columns...');
			await input.fill(query);
			await page.waitForTimeout(300);
			await page.getByRole('button', { name: 'Generate fast' }).first().click();
			await page.waitForTimeout(1000);

			const lanes = (await page.locator('.chip-lane-heading').allTextContents()).map((s) => s.trim());
			const topResult = (await page.locator('section button').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
			const generated = (await page.locator('text=/Generated block:/').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
			const draftMsg = (await page.locator('text=/Generated draft needs edits before apply|draft generated|No prompt plan/').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

			records.push({ query, lanes, topResult, generated, draftMsg });
			await page.keyboard.press('Escape');
			await page.waitForTimeout(150);
		}

		console.log(JSON.stringify(records, null, 2));
	} catch (err) {
		console.error('PROBE_ERROR', String(err));
		process.exitCode = 1;
	} finally {
		await browser.close();
	}
})();
