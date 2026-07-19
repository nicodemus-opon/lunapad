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

async function typeIntoVisibleMonaco(page: Page, text: string) {
	const editorLines = page.locator('[data-worksheet="true"] .monaco-editor .view-lines').last();
	await expect(editorLines).toBeVisible();
	await editorLines.click({ position: { x: 24, y: 10 } });
	await page.keyboard.type(text, { delay: 2 });
}

async function openQueryBlockInWorksheet(page: Page, nameHint?: string | RegExp) {
	const blocks = page.getByTestId('query-block');
	const block =
		typeof nameHint === 'string'
			? page.locator(`[data-testid="query-block"][data-output-name="${nameHint}"]`).first()
			: nameHint
				? blocks
						.filter({
							has: page.getByRole('textbox', { name: /model name/ }).filter({ hasText: nameHint })
						})
						.first()
				: blocks.last();
	await block.hover();
	await block.getByTestId('open-worksheet').click();
	await expect(page.getByLabel('Exit worksheet view')).toBeVisible();
}

async function addSqlBlockBelow(page: Page) {
	await page.getByLabel('Exit worksheet view').click();
	await expect(page.getByLabel('Exit worksheet view')).toBeHidden();
	await page.getByRole('button', { name: 'Add block' }).last().click();
	await expect(page.getByRole('listbox')).toBeVisible();
	await page.keyboard.type('sql', { delay: 20 });
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('query-block')).toHaveCount(2);
	await openQueryBlockInWorksheet(page, 'query');
}

test.describe('manual demo recreation workflow', () => {
	test('can create and run the first orders SQL cell from scratch', async ({ page }) => {
		await openFreshWorkspace(page);

		await page.getByRole('textbox', { name: 'Untitled notebook' }).fill('Manual Demo Recreation');

		const firstQueryBlock = page.getByTestId('query-block').first();
		await firstQueryBlock.hover();
		await firstQueryBlock.getByTestId('open-worksheet').click();
		await expect(page.getByLabel('Exit worksheet view')).toBeVisible();
		const nameInput = page.getByRole('textbox', { name: /model name/ });
		await nameInput.fill('orders');
		await nameInput.press('Enter');

		await page.getByRole('tab', { name: 'SQL' }).click();
		await typeIntoVisibleMonaco(
			page,
			`SELECT
  1 AS order_id,
  'North' AS region,
  'Laptop' AS product,
  2 AS quantity,
  1200.0 AS unit_price`
		);

		await page.getByLabel('Run cell').click();
		await expect(page.getByTestId('result-view-table')).toBeVisible({ timeout: 30_000 });
		const resultTable = page.locator('[data-worksheet="true"] table');
		await expect(resultTable.getByRole('button', { name: 'order_id', exact: true })).toBeVisible();
		await expect(resultTable.getByText('North', { exact: true })).toBeVisible();

		await page.getByTestId('result-view-stats').click();
		await expect(page.getByText('orders profile')).toBeVisible();
		await expect(page.getByText('Rows', { exact: true })).toBeVisible();
		await expect(page.getByText('Columns', { exact: true })).toBeVisible();

		await addSqlBlockBelow(page);
		await page.getByRole('textbox', { name: /model name/ }).fill('region_targets');
		await page.getByRole('textbox', { name: /model name/ }).press('Enter');
		await page.getByRole('tab', { name: 'SQL' }).click();
		await typeIntoVisibleMonaco(page, `SELECT 'North' AS target_region, 150000.0 AS quota`);
		await page.getByLabel('Run cell').click();
		await expect(page.getByTestId('result-view-table')).toBeVisible({ timeout: 30_000 });
		await expect(
			page
				.locator('[data-worksheet="true"] table')
				.getByRole('button', { name: 'target_region', exact: true })
		).toBeVisible();
		await expect(
			page.locator('[data-worksheet="true"] table').getByText('North', { exact: true })
		).toBeVisible();
	});
});
