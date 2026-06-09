import { test, expect, type Page } from '@playwright/test';
import path from 'path';

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
const OLLAMA_MODEL = 'qwen3:4b';

const CSV_REAL_ESTATE = path.resolve('/Users/niconico/Downloads/real_estate_leases.csv');
const CSV_MANUFACTURING = path.resolve('/Users/niconico/Downloads/manufacturing_batches.csv');

/** Pre-set LLM config in localStorage so the app is ready to generate */
async function gotoWithLLMConfig(page: Page) {
	await page.addInitScript(({ baseUrl, model }) => {
		const existing = localStorage.getItem('lunapad_notebook');
		const data = existing ? JSON.parse(existing) : {};
		data.llmConfig = { provider: 'ollama', baseUrl, model };
		localStorage.setItem('lunapad_notebook', JSON.stringify(data));
	}, { baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL });
	await page.goto('/');
	await page.waitForSelector('.notebook-cell', { timeout: 15_000 });
}

/** Upload a CSV file and wait for the table to appear in the sidebar */
async function uploadCSV(page: Page, csvPath: string, expectedTableName: string) {
	const fileInput = page.locator('input[type="file"][accept=".csv"]').first();
	await fileInput.setInputFiles(csvPath);
	// Wait for the table to appear in the sidebar tree
	await page.waitForSelector(`text=${expectedTableName}`, { timeout: 15_000 });
}

/** Switch the first cell to GUI mode */
async function switchToGUI(page: Page) {
	const btn = page.locator('.notebook-cell').first().getByRole('button', { name: /Switch to GUI mode/i }).first();
	await btn.click({ force: true });
	await page.waitForSelector('[data-testid="stage-card"]', { timeout: 10_000 });
}

/** Type a query, click AI generate, wait for result, apply it, return stage count */
async function runAIQuery(page: Page, query: string): Promise<{ stageCount: number; hasRaw: boolean }> {
	// Open stage picker
	await page.keyboard.press('a');
	const searchInput = page.getByPlaceholder(/Prompt or search stages/i);
	await expect(searchInput).toBeVisible({ timeout: 5_000 });

	await searchInput.fill(query);
	await page.getByRole('button', { name: /AI generate \(slower\)/i }).click();

	// Wait for LLM — up to 90s
	await expect(page.getByRole('button', { name: /Apply/i }).first()).toBeVisible({ timeout: 90_000 });
	await page.getByRole('button', { name: /Apply/i }).first().click();

	const stageCards = page.locator('[data-testid="stage-card"]');
	await page.waitForTimeout(400);
	const count = await stageCards.count();
	const rawCards = await stageCards.filter({ hasText: 'raw' }).count();
	return { stageCount: count, hasRaw: rawCards > 0 };
}

// ── Real Estate Leases ─────────────────────────────────────────────────────────

test.describe('AI generation — real_estate_leases', () => {
	test.setTimeout(300_000);

	test.beforeEach(async ({ page }) => {
		await gotoWithLLMConfig(page);
		await uploadCSV(page, CSV_REAL_ESTATE, 'real_estate_leases');
		// Click the table to start a query on it
		await page.locator(`text=real_estate_leases`).first().click();
		await page.waitForTimeout(600);
		await switchToGUI(page);
		// Focus the stage list so keyboard shortcuts work
		await page.locator('[data-testid="stage-card"]').first().focus();
	});

	test('avg rent per sqm by city → group + derive stages', async ({ page }) => {
		const { stageCount, hasRaw } = await runAIQuery(page, 'average rent per square meter by city');
		await page.screenshot({ path: 'test-results/ai-leases-rent-per-sqm.png', fullPage: false });
		expect(stageCount).toBeGreaterThan(1);
		expect(hasRaw).toBe(false);
	});

	test('occupied leases only sorted by rent → filter + sort stages', async ({ page }) => {
		const { stageCount, hasRaw } = await runAIQuery(page, 'only occupied leases sorted by rent descending');
		await page.screenshot({ path: 'test-results/ai-leases-occupied-sorted.png', fullPage: false });
		expect(stageCount).toBeGreaterThan(1);
		expect(hasRaw).toBe(false);
	});

	test('total revenue by property type → group stage', async ({ page }) => {
		const { stageCount, hasRaw } = await runAIQuery(page, 'total rent revenue by property type');
		await page.screenshot({ path: 'test-results/ai-leases-revenue-by-type.png', fullPage: false });
		expect(stageCount).toBeGreaterThan(1);
		expect(hasRaw).toBe(false);
	});

	test('pets allowed apartments by city → filter + group stages', async ({ page }) => {
		const { stageCount, hasRaw } = await runAIQuery(page, 'pets-allowed apartments count by city');
		await page.screenshot({ path: 'test-results/ai-leases-pets-by-city.png', fullPage: false });
		expect(stageCount).toBeGreaterThan(1);
		expect(hasRaw).toBe(false);
	});
});

// ── Manufacturing Batches ──────────────────────────────────────────────────────

test.describe('AI generation — manufacturing_batches', () => {
	test.setTimeout(300_000);

	test.beforeEach(async ({ page }) => {
		await gotoWithLLMConfig(page);
		await uploadCSV(page, CSV_MANUFACTURING, 'manufacturing_batches');
		await page.locator(`text=manufacturing_batches`).first().click();
		await page.waitForTimeout(600);
		await switchToGUI(page);
		await page.locator('[data-testid="stage-card"]').first().focus();
	});

	test('avg defect rate by plant → group stage', async ({ page }) => {
		const { stageCount, hasRaw } = await runAIQuery(page, 'average defect rate by plant');
		await page.screenshot({ path: 'test-results/ai-batches-defect-by-plant.png', fullPage: false });
		expect(stageCount).toBeGreaterThan(1);
		expect(hasRaw).toBe(false);
	});

	test('QA pass rate by shift → derive + group stages', async ({ page }) => {
		const { stageCount, hasRaw } = await runAIQuery(page, 'QA pass rate by operator shift');
		await page.screenshot({ path: 'test-results/ai-batches-qa-by-shift.png', fullPage: false });
		expect(stageCount).toBeGreaterThan(1);
		expect(hasRaw).toBe(false);
	});

	test('energy efficiency units per kwh by product line → derive + group', async ({ page }) => {
		const { stageCount, hasRaw } = await runAIQuery(page, 'energy efficiency: units produced per kwh by product line');
		await page.screenshot({ path: 'test-results/ai-batches-efficiency.png', fullPage: false });
		expect(stageCount).toBeGreaterThan(1);
		expect(hasRaw).toBe(false);
	});

	test('worst defect batches → filter + sort + take', async ({ page }) => {
		const { stageCount, hasRaw } = await runAIQuery(page, 'top 5 batches with highest defect rate');
		await page.screenshot({ path: 'test-results/ai-batches-worst-defect.png', fullPage: false });
		expect(stageCount).toBeGreaterThan(1);
		expect(hasRaw).toBe(false);
	});

	test('plants with most total downtime → group + sort', async ({ page }) => {
		const { stageCount, hasRaw } = await runAIQuery(page, 'plants with most total downtime minutes');
		await page.screenshot({ path: 'test-results/ai-batches-downtime.png', fullPage: false });
		expect(stageCount).toBeGreaterThan(1);
		expect(hasRaw).toBe(false);
	});
});
