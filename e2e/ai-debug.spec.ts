import { test, expect } from '@playwright/test';

test.setTimeout(300_000);

async function uploadAndSetSource(page: any, csvPath: string, tableName: string) {
	const csvInput = page.locator('input[type="file"][accept=".csv"]');
	await csvInput.setInputFiles(csvPath);
	await expect(page.getByText(new RegExp(`Loaded "${tableName}"`, 'i'))).toBeVisible({ timeout: 15_000 });

	// Click "select source…" and fill in the table name
	await page.getByText('select source…').click();
	await page.waitForTimeout(300);
	const sourceInput = page.getByPlaceholder('schema.table or cell_output');
	await sourceInput.fill(tableName);
	await sourceInput.press('Enter');
	await page.waitForTimeout(400);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(300);
}

test('leases: average rent per sqm by city', async ({ page }) => {
	await page.addInitScript(() => {
		const d = JSON.parse(localStorage.getItem('lunapad_notebook') ?? '{}');
		d.llmConfig = { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:1.7b' };
		localStorage.setItem('lunapad_notebook', JSON.stringify(d));
	});
	await page.goto('/');
	await page.waitForSelector('[data-testid="stage-card"]', { timeout: 15_000 });

	await uploadAndSetSource(page, '/Users/niconico/Downloads/real_estate_leases.csv', 'real_estate_leases');
	await page.screenshot({ path: 'test-results/q1-01-source-set.png' });

	// Open stage picker and trigger AI
	await page.locator('[data-testid="stage-card"]').first().focus();
	await page.keyboard.press('a');
	await expect(page.getByPlaceholder(/Prompt or search stages/i)).toBeVisible({ timeout: 5_000 });
	await page.getByPlaceholder(/Prompt or search stages/i).fill('average rent per square meter by city');
	await page.getByRole('button', { name: /AI generate \(slower\)/i }).click();

	// Wait for AI to finish (button returns to normal text or error/result appears)
	await expect(page.getByRole('button', { name: /AI generate \(slower\)/i })).toBeVisible({ timeout: 180_000 });
	await page.screenshot({ path: 'test-results/q1-02-ai-done.png' });

	// Log any status message
	const msg = await page.locator('[data-testid="stage-card"], .text-violet-400, .text-muted-foreground').first().textContent().catch(() => '');
	console.log('Status:', msg);

	// Check for AI error
	const aiError = await page.locator('text=AI error').count();
	if (aiError > 0) {
		const errText = await page.locator('text=AI error').textContent();
		console.log('AI ERROR:', errText);
	}

	// Check for AI result card - try multiple selectors
	const resultCard = page.locator('text=AI full query').first();
	const hasResult = await resultCard.isVisible().catch(() => false);
	console.log('Has result card:', hasResult);

	if (hasResult) {
		const prqlText = await page.locator('pre').first().textContent().catch(() => '');
		console.log('PRQL:\n', prqlText);

		await page.getByRole('button', { name: 'Apply' }).first().click();
		await page.waitForTimeout(800);
		await page.screenshot({ path: 'test-results/q1-03-applied.png' });

		const types = await page.locator('[data-testid="stage-card"]').evaluateAll((els: Element[]) =>
			els.map((el) => el.getAttribute('data-stage-type'))
		);
		console.log('Stages after apply:', types);
		console.log('Has raw:', types.includes('raw'));
	}
});

test('batches: QA pass rate by shift', async ({ page }) => {
	await page.addInitScript(() => {
		const d = JSON.parse(localStorage.getItem('lunapad_notebook') ?? '{}');
		d.llmConfig = { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:1.7b' };
		localStorage.setItem('lunapad_notebook', JSON.stringify(d));
	});
	await page.goto('/');
	await page.waitForSelector('[data-testid="stage-card"]', { timeout: 15_000 });

	await uploadAndSetSource(page, '/Users/niconico/Downloads/manufacturing_batches.csv', 'manufacturing_batches');
	await page.screenshot({ path: 'test-results/q2-01-source-set.png' });

	await page.locator('[data-testid="stage-card"]').first().focus();
	await page.keyboard.press('a');
	await expect(page.getByPlaceholder(/Prompt or search stages/i)).toBeVisible({ timeout: 5_000 });
	await page.getByPlaceholder(/Prompt or search stages/i).fill('QA pass rate by operator shift');
	await page.getByRole('button', { name: /AI generate \(slower\)/i }).click();

	await expect(page.getByRole('button', { name: /AI generate \(slower\)/i })).toBeVisible({ timeout: 180_000 });
	await page.screenshot({ path: 'test-results/q2-02-ai-done.png' });

	const hasResult = await page.locator('text=AI full query').isVisible().catch(() => false);
	console.log('Has result:', hasResult);

	if (hasResult) {
		const prqlText = await page.locator('pre').first().textContent().catch(() => '');
		console.log('PRQL:\n', prqlText);
		await page.getByRole('button', { name: 'Apply' }).first().click();
		await page.waitForTimeout(800);
		await page.screenshot({ path: 'test-results/q2-03-applied.png' });
		const types = await page.locator('[data-testid="stage-card"]').evaluateAll((els: Element[]) =>
			els.map((el) => el.getAttribute('data-stage-type'))
		);
		console.log('Stages after apply:', types);
	}
});

test('batches: average defect rate by plant and product line', async ({ page }) => {
	await page.addInitScript(() => {
		const d = JSON.parse(localStorage.getItem('lunapad_notebook') ?? '{}');
		d.llmConfig = { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:1.7b' };
		localStorage.setItem('lunapad_notebook', JSON.stringify(d));
	});
	await page.goto('/');
	await page.waitForSelector('[data-testid="stage-card"]', { timeout: 15_000 });

	await uploadAndSetSource(page, '/Users/niconico/Downloads/manufacturing_batches.csv', 'manufacturing_batches');

	await page.locator('[data-testid="stage-card"]').first().focus();
	await page.keyboard.press('a');
	await expect(page.getByPlaceholder(/Prompt or search stages/i)).toBeVisible({ timeout: 5_000 });
	await page.getByPlaceholder(/Prompt or search stages/i).fill('average defect rate by plant and product line');
	await page.getByRole('button', { name: /AI generate \(slower\)/i }).click();

	await expect(page.getByRole('button', { name: /AI generate \(slower\)/i })).toBeVisible({ timeout: 180_000 });
	await page.screenshot({ path: 'test-results/q3-02-ai-done.png' });

	const hasResult = await page.locator('text=AI full query').isVisible().catch(() => false);
	console.log('Has result:', hasResult);

	if (hasResult) {
		const prqlText = await page.locator('pre').first().textContent().catch(() => '');
		console.log('PRQL:\n', prqlText);
		await page.getByRole('button', { name: 'Apply' }).first().click();
		await page.waitForTimeout(800);
		await page.screenshot({ path: 'test-results/q3-03-applied.png' });
		const types = await page.locator('[data-testid="stage-card"]').evaluateAll((els: Element[]) =>
			els.map((el) => el.getAttribute('data-stage-type'))
		);
		console.log('Stages after apply:', types);
	}
});
