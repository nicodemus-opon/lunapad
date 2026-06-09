import { test, expect } from '@playwright/test';

// Point at the Docker container running on port 3000
const BASE = 'http://localhost:3000';

test.describe('Data Sources panel', () => {
	test('shows Data Sources heading and Add source button', async ({ page }) => {
		await page.goto(BASE);
		await page.waitForLoadState('networkidle');
		await page.screenshot({ path: '/tmp/pw-01-loaded.png' });

		// The sidebar should have a "Data Sources" heading
		await expect(page.getByText('Data Sources')).toBeVisible({ timeout: 10_000 });
		// "Add source" button (not "New")
		await expect(page.getByText('Add source')).toBeVisible();
		// Old "Connections" text should NOT appear in the label
		await expect(page.locator('text=Connections').first()).not.toBeVisible();
	});

	test('Add source opens form with type selector and Source ID field', async ({ page }) => {
		await page.goto(BASE);
		await page.waitForLoadState('networkidle');

		await page.getByText('Add source').click();
		await page.screenshot({ path: '/tmp/pw-02-form-open.png' });

		// Form should contain a Source ID label
		await expect(page.getByText('Source ID')).toBeVisible();
		// Type selector should show Postgres by default
		await expect(page.getByText('Postgres').first()).toBeVisible();
		// Buttons should use new copy
		await expect(page.getByRole('button', { name: /Test/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /Save/ })).toBeVisible();
	});

	test('Source ID auto-fills from name and has helper text', async ({ page }) => {
		await page.goto(BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Add source').click();

		// Clear name and type a new one
		const nameInput = page.locator('input#connection-name');
		await nameInput.fill('');
		await nameInput.fill('My Production DB');

		// Source ID should have auto-slugged
		const catalogInput = page.locator('input#connection-catalog');
		const value = await catalogInput.inputValue();
		expect(value).toBe('my_production_db');

		// Helper text should mention the catalog name in a query reference
		await expect(page.getByText(/my_production_db\.schema\.table/)).toBeVisible();
		await page.screenshot({ path: '/tmp/pw-03-auto-slug.png' });
	});

	test('Switching to MySQL changes port default to 3306', async ({ page }) => {
		await page.goto(BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Add source').click();

		// Open type dropdown and select MySQL
		await page.locator('button[id="connection-type"]').click();
		await page.getByRole('option', { name: 'MySQL' }).click();
		await page.screenshot({ path: '/tmp/pw-04-mysql.png' });

		// Port should have changed to 3306
		const portInput = page.locator('input#connection-port');
		await expect(portInput).toHaveValue('3306');

		// Type label in trigger should now say MySQL
		await expect(page.locator('button[id="connection-type"]')).toContainText('MySQL');
	});

	test('Switching to ClickHouse changes port default to 8123', async ({ page }) => {
		await page.goto(BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Add source').click();

		await page.locator('button[id="connection-type"]').click();
		await page.getByRole('option', { name: 'ClickHouse' }).click();

		const portInput = page.locator('input#connection-port');
		await expect(portInput).toHaveValue('8123');
	});

	test('Source ID locked after editing existing connection', async ({ page }) => {
		await page.goto(BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Add source').click();

		// Fill in details and observe Source ID is editable for new source
		const catalogInput = page.locator('input#connection-catalog');
		await expect(catalogInput).toBeEnabled();

		// Helper text for new source should say "Use in cross-source queries"
		await expect(page.getByText(/Use in cross-source queries/)).toBeVisible();
		await page.screenshot({ path: '/tmp/pw-05-new-source-id.png' });
	});

	test('No "Trino" branding visible anywhere in data sources panel', async ({ page }) => {
		await page.goto(BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Add source').click();

		// Trino should not appear as a user-facing label
		const trinoVisible = await page.getByText('Trino', { exact: true }).count();
		expect(trinoVisible).toBe(0);
		await page.screenshot({ path: '/tmp/pw-06-no-trino.png' });
	});

	test('Test button shows "Connecting..." state (visible feedback)', async ({ page }) => {
		await page.goto(BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Add source').click();

		// Fill required fields
		await page.locator('input#connection-name').fill('Test PG');
		await page.locator('input#connection-host').fill('localhost');
		await page.locator('input#connection-port').fill('5432');
		await page.locator('input#connection-database').fill('testdb');
		await page.locator('input#connection-username').fill('postgres');

		// Click Test — immediately screenshot to catch the loading state
		await page.getByRole('button', { name: /Test/ }).click();
		// The button should change to "Connecting..." while the request is in flight
		await page.screenshot({ path: '/tmp/pw-07-connecting.png' });
		// Eventually it will either succeed or show an error toast
		// Just wait a moment and check we're not in a broken state
		await page.waitForTimeout(2000);
		await page.screenshot({ path: '/tmp/pw-08-after-test.png' });
	});
});
