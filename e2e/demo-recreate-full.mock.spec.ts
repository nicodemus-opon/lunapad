import { expect, test, type Locator, type Page } from '@playwright/test';
import { installMockBrowserDefaults } from './mock-browser-defaults';

/**
 * Full human-style recreation of the Sales Analytics demo notebook.
 * Everything is done through the UI exactly like a user would:
 * typing prose, slash commands, Monaco typing, run buttons, view switchers,
 * chart config panel — no store shortcuts.
 */

test.describe.configure({ mode: 'serial' });

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

/** Click into a Monaco editor inside `scope`, clear it, and enter code.
 * Multi-line code is inserted paste-style (humans paste SQL; typing it
 * char-by-char trips Monaco auto-closing brackets, which is not what we're
 * testing here). */
async function typeIntoMonaco(scope: Locator, page: Page, text: string) {
	const lines = scope.locator('.monaco-editor .view-lines').first();
	await expect(lines).toBeVisible();
	await lines.click({ position: { x: 30, y: 10 } });
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Delete');
	if (text.includes('\n')) {
		await page.keyboard.insertText(text);
	} else {
		await page.keyboard.type(text, { delay: 2 });
	}
}

/** Read back what Monaco actually contains (joined without whitespace quirks). */
async function monacoText(scope: Locator): Promise<string> {
	const lines = scope.locator('.monaco-editor .view-lines').first();
	return (await lines.innerText()).replace(/\u00a0/g, ' ');
}

async function openLastBlockInWorksheet(page: Page) {
	const block = page.getByTestId('query-block').last();
	await block.hover();
	await block.getByTestId('open-worksheet').click();
	await expect(page.getByLabel('Exit worksheet view')).toBeVisible();
}

async function exitWorksheet(page: Page) {
	await page.getByLabel('Exit worksheet view').click();
	await expect(page.getByLabel('Exit worksheet view')).toBeHidden();
}

async function renameCellInWorksheet(page: Page, name: string) {
	const nameInput = page.getByRole('textbox', { name: /model name/ });
	await nameInput.fill(name);
	await nameInput.press('Enter');
}

const worksheetScope = (page: Page) => page.locator('[data-worksheet="true"]');

/** Run the worksheet cell and wait for the result toolbar to confirm success. */
async function runWorksheetCell(page: Page) {
	await page.getByLabel('Run cell').click();
	await expect(page.getByTestId('result-view-table')).toBeVisible({ timeout: 45_000 });
}

/** Place the caret on the empty trailing prose line of the document. */
async function focusTrailingProse(page: Page) {
	const host = page.locator('.notebook-document-host').first();
	const box = await host.boundingBox();
	if (!box) throw new Error('document host not visible');
	// Click below the content — the container handler focuses the last line.
	await page.locator('.notebook-document-editor').click({
		position: { x: Math.min(300, box.width / 2), y: box.height - 8 }
	});
}

/** Open the slash menu on a fresh line and pick an entry by its visible label. */
async function slashInsert(page: Page, query: string, optionLabel: RegExp) {
	await page.keyboard.type(`/${query}`, { delay: 25 });
	const option = page.getByRole('option', { name: optionLabel });
	await expect(option).toBeVisible({ timeout: 5_000 });
	await option.click();
}

/** Create a new query block at the end of the doc, open it in the worksheet,
 * rename it, switch language mode, type code, run, and verify. */
async function createCellViaWorksheet(
	page: Page,
	opts: {
		slash: 'sql' | 'prql';
		optionLabel: RegExp;
		name: string;
		mode?: 'SQL' | 'PRQL' | 'Visual';
		code: string;
		expectText: string | RegExp;
	}
) {
	await focusTrailingProse(page);
	await slashInsert(page, opts.slash, opts.optionLabel);
	await openLastBlockInWorksheet(page);
	await renameCellInWorksheet(page, opts.name);
	if (opts.mode) {
		await page.getByRole('tab', { name: opts.mode, exact: true }).click();
	}
	await typeIntoMonaco(worksheetScope(page), page, opts.code);
	await runWorksheetCell(page);
	await expect(worksheetScope(page).getByText(opts.expectText).first()).toBeVisible({
		timeout: 30_000
	});
	await exitWorksheet(page);
}

// ---------------------------------------------------------------------------

// Compact seed data — same shape as the demo, smaller so typing stays fast.
const seedSQL = `SELECT
  range + 1 AS order_id,
  DATE '2023-01-01' + CAST((range * 13 % 730) AS INTEGER) * INTERVAL '1 day' AS order_date,
  (['Laptop','Phone','Tablet','Monitor'])[(range % 4) + 1] AS product,
  (['Electronics','Electronics','Peripherals','Peripherals'])[(range % 4) + 1] AS category,
  (['Enterprise','SMB','Consumer'])[(range % 3) + 1] AS customer_segment,
  1 + (range * 7 % 4) AS quantity,
  ([1200.0, 799.0, 449.0, 349.0])[(range % 4) + 1] AS unit_price,
  (['North','South','East','West','Central'])[(range % 5) + 1] AS region
FROM range(400)`;

const regionTargetsSQL = `SELECT * FROM (VALUES
  ('North', 150000.0),
  ('South', 120000.0),
  ('East', 130000.0),
  ('West', 140000.0),
  ('Central', 100000.0)
) AS t(target_region, quota)`;

const monthlyRevenuePRQL = `from orders
derive {
  month = s"date_trunc('month', order_date)",
  revenue = quantity * unit_price
}
group month (
  aggregate {
    total_revenue = sum revenue,
    order_count = count this
  }
)
sort month`;

test('recreate demo part 1: intro prose, orders, region_targets, monthly_revenue + chart', async ({
	page
}) => {
	test.setTimeout(300_000);
	await openFreshWorkspace(page);

	await page.getByRole('textbox', { name: 'Untitled notebook' }).fill('Sales Analytics Demo');

	// --- Intro prose ABOVE the first query block ------------------------------
	const prose = page.locator('.notebook-document-surface').first();
	await prose.click({ position: { x: 200, y: 10 } });
	await page.keyboard.type('# Sales Analytics Demo', { delay: 15 });
	await expect(prose.getByRole('heading', { level: 1 })).toContainText('Sales Analytics Demo');
	await page.keyboard.press('Enter');
	await page.keyboard.type(
		'This notebook walks through the core workflow on synthetic order data.',
		{ delay: 5 }
	);

	// Callout via slash menu
	await page.keyboard.press('Enter');
	await slashInsert(page, 'callout', /Callout/i);
	await page.keyboard.type('Run all cells to populate every chart below.', { delay: 5 });
	await expect(prose.getByText('Run all cells to populate')).toBeVisible();

	// --- orders cell (the initial query block) --------------------------------
	const firstBlock = page.getByTestId('query-block').first();
	await firstBlock.hover();
	await firstBlock.getByTestId('open-worksheet').click();
	await expect(page.getByLabel('Exit worksheet view')).toBeVisible();
	await renameCellInWorksheet(page, 'orders');
	await page.getByRole('tab', { name: 'SQL', exact: true }).click();
	await typeIntoMonaco(worksheetScope(page), page, seedSQL);
	await runWorksheetCell(page);
	await expect(worksheetScope(page).getByText('order_id').first()).toBeVisible();

	// Stats view like the demo
	await page.getByTestId('result-view-stats').click();
	await expect(page.getByText('orders profile')).toBeVisible();
	await exitWorksheet(page);

	// --- region_targets --------------------------------------------------------
	await createCellViaWorksheet(page, {
		slash: 'sql',
		optionLabel: /SQL query/i,
		name: 'region_targets',
		code: regionTargetsSQL,
		expectText: 'target_region'
	});

	// --- monthly_revenue (PRQL) + area chart -----------------------------------
	await createCellViaWorksheet(page, {
		slash: 'prql',
		optionLabel: /PRQL query/i,
		name: 'monthly_revenue',
		mode: 'PRQL',
		code: monthlyRevenuePRQL,
		expectText: 'total_revenue'
	});

	// Configure the area chart from the INLINE result toolbar, like a human.
	const mrBlock = page.getByTestId('query-block').last();
	await mrBlock.hover();
	await mrBlock.getByTestId('result-view-chart').click();
	await mrBlock.getByTestId('chart-settings').click();
	const configPanel = page.getByTestId('chart-settings-panel');
	await expect(configPanel.getByText(/Chart type/i)).toBeVisible({ timeout: 10_000 });
	await configPanel.locator('button[aria-label="Area"][aria-pressed]').click();
	await configPanel.getByPlaceholder('Chart title').fill('Monthly Revenue');
	// A plotly chart should now be rendered
	await expect(mrBlock.locator('.js-plotly-plot, .chart-view').first()).toBeVisible({
		timeout: 15_000
	});

	// Nothing got corrupted: the three cells + heading are still there
	await expect(page.getByTestId('query-block')).toHaveCount(3);
	await expect(prose.getByRole('heading', { level: 1 })).toContainText('Sales Analytics Demo');
});
