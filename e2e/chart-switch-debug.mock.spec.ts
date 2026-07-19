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

test('chart tab works after worksheet-created cell', async ({ page }) => {
	await openFreshWorkspace(page);

	// Create the cell through the worksheet like the full recreation flow does.
	const block = page.locator('.query-block-view').first();
	await block.hover();
	await block.locator('button[aria-label="Open in worksheet"]').click();
	await expect(page.getByLabel('Exit worksheet view')).toBeVisible();
	const nameInput = page.getByRole('textbox', { name: /model name/ });
	await nameInput.fill('monthly');
	await nameInput.press('Enter');
	await page.getByRole('tab', { name: 'SQL', exact: true }).click();
	const wsLines = page.locator('[data-worksheet="true"] .monaco-editor .view-lines').first();
	await wsLines.click({ position: { x: 30, y: 10 } });
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Delete');
	await page.keyboard.type("SELECT 'a' AS label, 1 AS v UNION ALL SELECT 'b', 3", { delay: 5 });
	await page.getByLabel('Run cell').click();
	await expect(page.getByTestId('result-view-table')).toBeVisible({ timeout: 30_000 });
	await page.getByLabel('Exit worksheet view').click();
	await expect(page.getByLabel('Exit worksheet view')).toBeHidden();

	// Now switch the inline result to Chart.
	const inline = page.locator('.query-block-view').last();
	await inline.hover();
	const chartButton = inline.getByTestId('result-view-chart');
	await expect(chartButton).toBeVisible();
	await chartButton.click();
	await page.waitForTimeout(500);
	await expect(chartButton).toHaveAttribute('aria-pressed', 'true');
	await expect(inline.locator('.js-plotly-plot, .chart-view').first()).toBeVisible({
		timeout: 15_000
	});
});

test('inline result Chart tab switches the view', async ({ page }) => {
	await openFreshWorkspace(page);

	const block = page.locator('.query-block-view').first();
	const lines = block.locator('.monaco-editor .view-lines').first();
	await lines.click({ position: { x: 30, y: 10 } });
	await page.keyboard.type("SELECT 'a' AS label, 1 AS v UNION ALL SELECT 'b', 3", { delay: 5 });
	await block.hover();
	await block.getByRole('button', { name: 'Run block' }).click();
	await expect(block.getByText('Export CSV')).toBeVisible({ timeout: 30_000 });

	await block.hover();
	const chartButton = block.getByTestId('result-view-chart');
	await expect(chartButton).toBeVisible();
	await chartButton.click();

	await page.waitForTimeout(500);

	await expect(chartButton).toHaveAttribute('aria-pressed', 'true');
	await expect(block.locator('.js-plotly-plot, .chart-view').first()).toBeVisible({
		timeout: 15_000
	});
});
