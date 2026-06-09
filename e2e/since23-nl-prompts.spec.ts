import { expect, test } from '@playwright/test';

const DATASET_PATH = '/Users/niconico/Documents/projects/my_proj/finances/since23.csv';
const PROMPTS = [
	'who did i pay the most in january',
	'show where money leaks each month',
	'which vendors are becoming expensive lately'
] as const;

async function switchToGuiMode(page: import('@playwright/test').Page) {
	const guiButton = page
		.locator('.notebook-cell')
		.first()
		.getByRole('button', { name: /Switch to GUI mode/i })
		.first();
	if (await guiButton.count()) {
		await guiButton.click({ force: true });
	}
	await page.waitForSelector('[data-testid="stage-card"]', { timeout: 15000 });
}

async function setFromTable(page: import('@playwright/test').Page, tableName: string) {
	const fromCard = page.locator('[data-testid="stage-card"][data-stage-type="from"]').first();
	await fromCard.locator('[data-testid="stage-header"]').click();
	await fromCard.getByRole('button').first().click();
	const sourceInput = page.getByPlaceholder('schema.table or cell_output').first();
	await sourceInput.fill(tableName);
	await sourceInput.press('Tab');
	await page.keyboard.press('Escape');
}

async function openPalette(page: import('@playwright/test').Page) {
	await page.locator('[data-testid="stage-card"]').first().focus();
	await page.keyboard.press('a');
	await page
		.getByPlaceholder('Prompt or search stages, templates, and columns...')
		.waitFor({ timeout: 10000 });
}

test('since23 natural-language prompts produce generated plans', async ({ page }) => {
	test.setTimeout(120000);

	await page.goto('/');
	await page.waitForSelector('.notebook-cell', { timeout: 20000 });
	await switchToGuiMode(page);

	await page.setInputFiles('input[type="file"][accept=".csv"]', DATASET_PATH);
	await page.waitForTimeout(1200);
	await setFromTable(page, 'since23');
	await page.waitForTimeout(500);

	for (const prompt of PROMPTS) {
		await openPalette(page);
		const input = page.getByPlaceholder('Prompt or search stages, templates, and columns...');
		await input.fill(prompt);
		await page.waitForTimeout(300);

		await page.getByRole('button', { name: 'Generate fast' }).first().click();
		await page.waitForTimeout(900);

		const topResult = (await page.locator('section button').first().innerText().catch(() => ''))
			.replace(/\s+/g, ' ')
			.trim();
		const generatedLabel = (await page.locator('text=/Generated block:/').first().innerText().catch(() => ''))
			.replace(/\s+/g, ' ')
			.trim();
		const draftMessage = (await page
			.locator('text=/Generated draft needs edits before apply|draft generated|No prompt plan/')
			.first()
			.innerText()
			.catch(() => ''))
			.replace(/\s+/g, ' ')
			.trim();

		expect(topResult.length, `Expected top command result for prompt: ${prompt}`).toBeGreaterThan(0);
		expect(
			generatedLabel.length > 0 || draftMessage.length > 0,
			`Expected generated plan signal for prompt: ${prompt}`
		).toBe(true);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(120);
	}
});
