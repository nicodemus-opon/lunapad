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

test('opening a fresh PRQL block shows a writable PRQL editor', async ({ page }) => {
	await openFreshWorkspace(page);

	// Insert a PRQL block via slash on the trailing prose line.
	const prose = page.locator('.notebook-document-surface').first();
	await prose.click({ position: { x: 200, y: 10 } });
	await page.keyboard.press('End');
	await page.keyboard.type('/prql', { delay: 25 });
	await page.getByRole('option', { name: /PRQL query/i }).click();
	await expect(page.locator('.query-block-view')).toHaveCount(2);

	// Open the new block in the worksheet
	const block = page.locator('.query-block-view').last();
	await block.hover();
	await block.locator('button[aria-label="Open in worksheet"]').click();
	await expect(page.getByLabel('Exit worksheet view')).toBeVisible();

	// The regression is that PRQL mode must render a real editor, regardless of
	// whether the worksheet initially opened in Visual or PRQL mode.
	await page.getByRole('tab', { name: 'PRQL', exact: true }).click();
	await expect(page.getByRole('tab', { name: 'PRQL', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);

	const ws = page.locator('[data-worksheet="true"]');
	const lines = ws.locator('.monaco-editor .view-lines').first();
	await expect(lines).toBeVisible({ timeout: 5_000 });
	await lines.click({ position: { x: 30, y: 10 } });
	await page.keyboard.type('from orders', { delay: 10 });
	await expect(lines).toContainText('from orders');
});
