import { expect, test, type Page } from '@playwright/test';
import { installMockBrowserDefaults } from './mock-browser-defaults';

async function openFreshWorkspace(page: Page) {
	await page.route('**/api/setup', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ needsSetup: false })
		});
	});
	await page.route('**/api/workspace/load', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ data: null, updatedAt: null, updatedBy: null })
		});
	});
	await page.route('**/api/workspace/save', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ updatedAt: new Date().toISOString(), updatedBy: null })
		});
	});
	await installMockBrowserDefaults(page);
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'New notebook' }).first()).toBeVisible({
		timeout: 60_000
	});
}

test.describe('inline document editing repro', () => {
	test('can type into the inline SQL query block Monaco editor', async ({ page }) => {
		await openFreshWorkspace(page);

		const block = page.locator('.query-block-view').first();
		const lines = block.locator('.monaco-editor .view-lines').first();
		await expect(lines).toBeVisible();
		await lines.click({ position: { x: 30, y: 10 } });
		await page.keyboard.type('SELECT 42 AS answer', { delay: 15 });

		await expect(lines).toContainText('SELECT', { timeout: 5_000 });
		await expect(lines).toContainText('answer');
	});

	test('document query block exposes inline AI from the Sparkles action', async ({ page }) => {
		await openFreshWorkspace(page);

		const block = page.locator('.query-block-view').first();
		await block.hover();
		const inlineAiButton = block.getByRole('button', {
			name: 'Tell AI what to do with this cell'
		});
		await expect(inlineAiButton).toBeVisible();
		await inlineAiButton.click();

		await expect(page.getByTestId('inline-prompt-input')).toBeVisible();
	});

	test('document query block opens inline AI from Cmd+Shift+K', async ({ page }) => {
		await openFreshWorkspace(page);

		const block = page.locator('.query-block-view').first();
		const lines = block.locator('.monaco-editor .view-lines').first();
		await lines.click({ position: { x: 30, y: 10 } });
		await page.keyboard.press('Meta+Shift+K');

		await expect(page.getByTestId('inline-prompt-input')).toBeVisible();
	});

	test('can type into the inline editor after first editing prose', async ({ page }) => {
		await openFreshWorkspace(page);

		// Focus the prose surface first (like a human writing a title), THEN click
		// into the code cell — this exercises the ProseMirror blur -> reconcile path.
		const prose = page.locator('.notebook-document-surface').first();
		await prose.click({ position: { x: 200, y: 10 } });
		await page.keyboard.type('Intro text', { delay: 10 });

		const block = page.locator('.query-block-view').first();
		const lines = block.locator('.monaco-editor .view-lines').first();
		await lines.click({ position: { x: 30, y: 10 } });
		await page.keyboard.type('SELECT 7 AS lucky', { delay: 15 });

		await expect(lines).toContainText('SELECT', { timeout: 5_000 });
		await expect(lines).toContainText('lucky');
	});

	test('can insert a python block via slash menu and type into it', async ({ page }) => {
		await openFreshWorkspace(page);

		// Land on the trailing prose line and open the slash menu.
		const prose = page.locator('.notebook-document-surface').first();
		await prose.click({ position: { x: 200, y: 10 } });
		await page.keyboard.press('End');
		await page.keyboard.type('/python', { delay: 30 });
		await page.getByRole('option', { name: /Python block/i }).click();

		const blocks = page.locator('.query-block-view');
		await expect(blocks).toHaveCount(2);
		const pyBlock = blocks.first();
		await expect(pyBlock.getByRole('textbox', { name: 'Cell output name' })).toHaveValue(
			'py_result'
		);
		const pyLines = pyBlock.locator('.monaco-editor .view-lines').first();
		await expect(pyLines).toBeVisible();
		await pyBlock.locator('.monaco-editor').click({ position: { x: 64, y: 18 } });
		await page.waitForTimeout(60);
		await page.keyboard.type('print("hello")', { delay: 15 });
		await expect(pyLines).toContainText('print', { timeout: 5_000 });
		await expect(pyLines).toContainText('hello');
	});

	test('worksheet reopen shows code after a cell has results', async ({ page }) => {
		await openFreshWorkspace(page);

		const block = page.locator('.query-block-view').first();
		await block.hover();
		await block.locator('button[aria-label="Open in worksheet"]').click();
		await expect(page.getByLabel('Exit worksheet view')).toBeVisible();

		await page.getByRole('textbox', { name: /model name/ }).fill('orders');
		await page.getByRole('textbox', { name: /model name/ }).press('Enter');
		await page.getByRole('tab', { name: 'SQL' }).click();
		const worksheetLines = page.locator('[data-worksheet="true"] .monaco-editor .view-lines');
		await worksheetLines.click({ position: { x: 30, y: 10 } });
		await page.keyboard.type('SELECT 1 AS order_id, 2 AS quantity', { delay: 10 });
		await page.getByLabel('Run cell').click();
		await expect(page.getByRole('tab', { name: 'Table' })).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'order_id', exact: true })).toBeVisible();

		await page.getByLabel('Exit worksheet view').click();
		await expect(page.getByLabel('Exit worksheet view')).toBeHidden();

		const reopenedBlock = page.locator('.query-block-view').first();
		await reopenedBlock.hover();
		await reopenedBlock.locator('button[aria-label="Open in worksheet"]').click();
		await expect(page.getByLabel('Exit worksheet view')).toBeVisible();

		const reopenedLines = page.locator('[data-worksheet="true"] .monaco-editor .view-lines');
		await expect(reopenedLines).toContainText('SELECT', { timeout: 5_000 });
		await expect(reopenedLines).toContainText('order_id');
	});

	test('header dropdowns open (connection picker)', async ({ page }) => {
		await openFreshWorkspace(page);

		await page.getByRole('button', { name: /DuckDB \(built-in\)/ }).click();
		const option = page.getByRole('option', { name: /DuckDB \(built-in\)/ });
		await expect(option).toBeVisible({ timeout: 5_000 });
		// The popup must actually be on-screen (not portaled to 0,0 / clipped).
		const box = await option.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.y).toBeGreaterThan(40);
		expect(box!.width).toBeGreaterThan(50);
	});

	test('cell column-options dropdown opens on the inline result', async ({ page }) => {
		await openFreshWorkspace(page);

		// Type + run a query so the inline result (with its column menus) exists.
		const block = page.locator('.query-block-view').first();
		const lines = block.locator('.monaco-editor .view-lines').first();
		await lines.click({ position: { x: 30, y: 10 } });
		await page.keyboard.type('SELECT 1 AS a, 2 AS b', { delay: 15 });
		await block.hover();
		await block.getByRole('button', { name: 'Run block' }).click();
		await expect(block.getByText('Export CSV')).toBeVisible({ timeout: 30_000 });

		// Regression: the code block must render ABOVE the result table.
		const codeBox = await block.locator('.qb-code').boundingBox();
		const resultBox = await block.locator('.qb-result').boundingBox();
		expect(codeBox).not.toBeNull();
		expect(resultBox).not.toBeNull();
		expect(codeBox!.y).toBeLessThan(resultBox!.y);
		await block.screenshot({ path: 'test-results/code-above-result.png' });

		// Open the per-column "⋯" options dropdown — the user-reported "cell option".
		await block.hover();
		const colMenuBtn = block.getByRole('button', { name: 'Column actions for a' });
		await colMenuBtn.click();
		const sortItem = page.getByRole('button', { name: 'Asc', exact: true });
		await expect(sortItem).toBeVisible({ timeout: 5_000 });
		const box = await sortItem.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.y).toBeGreaterThan(40);

		// And it must act: sorting closes the menu without errors.
		await sortItem.click();
		await expect(sortItem).toBeHidden();
	});
});
