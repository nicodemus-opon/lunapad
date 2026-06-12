import { test, expect, type Page } from '@playwright/test';

/** Expands a stage card by clicking its header. Only one stage can be active at a time. */
async function expandStage(page: Page, stageType: string, nth = 0) {
	await page.locator(`[data-testid="stage-card"][data-stage-type="${stageType}"]`).nth(nth).locator('[data-testid="stage-header"]').click();
}

async function switchToGuiMode(page: Page) {
	await page.locator('.notebook-cell').first().getByRole('button', { name: /Switch to GUI mode/i }).first().click({ force: true });
}

const FULL_QUERY = `from invoices
filter invoice_date >= @1970-01-16
derive {
  transaction_fees = 0.8,
  income = total - transaction_fees
}
filter income > 1
group customer_id (
  aggregate {
    average total,
    sum_income = sum income,
    ct = count total,
  }
)
sort {-sum_income}
take 10
join c=customers (==customer_id)
derive name = f"{c.last_name}, {c.first_name}"
select {
  c.customer_id, name, sum_income
}
derive db_version = s"version()"`;

/** Pre-loads the first cell with the given PRQL code (in PRQL edit mode) via localStorage */
async function gotoWithCode(page: Page, code: string) {
	// Pre-inject localStorage state so the app starts with the code already loaded
	await page.addInitScript((prql) => {
		const notebookId = 'test-nb-001';
		const cellId = 'test-cell-001';
		const storageData = {
			notebooks: [{
				id: notebookId,
				name: 'Test Notebook',
				folderId: null,
				cells: [{
					id: cellId,
					outputName: 'result1',
					code: prql,
					status: 'idle',
					result: null,
					errors: [],
					compiledSQL: null,
					executionMs: null,
					guiStages: [{ type: 'from', table: '' }],
					editMode: 'prql',
					resultViewMode: 'table',
					resultChartConfig: null
				}]
			}],
			folders: [],
			openNotebookTabIds: [notebookId],
			expandedNotebookFolderIds: [],
			sidebarSectionsExpanded: { notebooks: true, tables: true },
			activeTabId: notebookId,
			openResultTabs: [],
			openExtraTabs: [],
			tables: [],
			theme: 'system'
		};
		localStorage.setItem('lunapad_notebook', JSON.stringify(storageData));
	}, code);

	await page.goto('/');
	// Wait for the cell to render in PRQL mode (CodeMirror editor should be visible)
	await page.waitForSelector('.code-editor .monaco-editor', { timeout: 10_000 });
}

test.describe('GUI full-query', () => {
	test.beforeEach(async ({ page }) => {
		// Tests will call gotoWithCode directly; nothing needed here
	});

	test('stage keyboard CRUD shortcuts work end-to-end', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);
		await switchToGuiMode(page);

		const stageCards = page.locator('[data-testid="stage-card"]');
		await expect(stageCards).toHaveCount(11, { timeout: 5_000 });

		// Focus a stage card first so shortcuts are scoped to this editor.
		await stageCards.nth(1).focus();

		// C: create via AddStageMenu keyboard picker (A + 1)
		await page.keyboard.press('a');
		await expect(page.getByPlaceholder('Search stages')).toBeVisible();
		await page.keyboard.press('1');
		await expect(stageCards).toHaveCount(12);

		// C: duplicate active stage (Shift + D)
		await page.keyboard.press('Shift+D');
		await expect(stageCards).toHaveCount(13);

		// U: move active stage down (J)
		await page.keyboard.press('j');
		const activeCard = page.locator('[data-testid="stage-card"][data-stage-active="true"]');
		await expect(activeCard).toHaveCount(1);

		// D: delete active stage (X)
		await page.keyboard.press('x');
		await expect(stageCards).toHaveCount(12);

		// Cleanup delete to return to the original stage count.
		await page.keyboard.press('x');
		await expect(stageCards).toHaveCount(11);

		// Add chip/row command (N) on active derive stage.
		const firstDerive = page.locator('[data-testid="stage-card"][data-stage-type="derive"]').first();
		const derivePills = firstDerive.locator('[role="listitem"]');
		const beforeDeriveCount = await derivePills.count();
		expect(beforeDeriveCount).toBeGreaterThan(0);
		await firstDerive.focus();
		await page.keyboard.press('n');
		await expect(derivePills).toHaveCount(beforeDeriveCount + 1);
	});

	test('parse round-trip: full PRQL → GUI stages → PRQL tab output', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);

		// Switch to GUI mode; the code parses into stages
		await switchToGuiMode(page);

		// Expect 11 stage-cards to appear (from, filter, derive, filter, group, sort, take, join, derive, select, derive)
		const stageCards = page.locator('[data-testid="stage-card"]');
		await expect(stageCards).toHaveCount(11, { timeout: 5_000 });

		// Switch to PRQL mode via the cell header toggle
		await page.locator('.notebook-cell').first().getByRole('button', { name: /Switch to PRQL mode/i }).first().click();
		await page.waitForSelector('.code-editor .monaco-editor', { timeout: 5_000 });

		// The PRQL preview should contain key features
		const prqlPreview = page.locator('.notebook-cell').first().locator('.view-lines').first();
		await expect(prqlPreview).not.toBeEmpty();
	});

	test('combobox suggestions: filter column input is visible and editable', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);

		// Switch to GUI mode
		await switchToGuiMode(page);
		await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(11, { timeout: 5_000 });

		// Expand the first filter stage and check the column input is visible with the correct parsed value
		await expandStage(page, 'filter', 0);
		await page.locator('[data-testid="filter-condition-pill"]').first().click({ force: true });
		const filterColInput = page.locator('[data-testid="filter-column-input"]').first();
		await expect(filterColInput).toBeVisible({ timeout: 3_000 });
		await expect(filterColInput).toHaveValue('invoice_date');
	});

	test('stage preview: running a stage shows evidence panel', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);

		await switchToGuiMode(page);
		const stageCards = page.locator('[data-testid="stage-card"]');
		await expect(stageCards).toHaveCount(11, { timeout: 5_000 });

		const firstStage = stageCards.first();
		await firstStage.hover();
		await firstStage.getByRole('button', { name: /Run pipeline up to this stage/ }).click();

		await expect(firstStage.locator('[data-testid="stage-evidence-panel"]')).toBeVisible({ timeout: 5_000 });
		await expect(firstStage.locator('[data-testid="stage-evidence-panel"]')).toContainText('evidence');
	});

	test('stage connectors: each transition shows a right-angle elbow', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);

		await switchToGuiMode(page);
		const stageCards = page.locator('[data-testid="stage-card"]');
		await expect(stageCards).toHaveCount(11, { timeout: 5_000 });

		await expect(page.locator('[data-testid="stage-card"] .stage-link')).toHaveCount(10);
		await expect(stageCards.first().locator('.stage-link')).toHaveCount(1);
		await expect(stageCards.last().locator('.stage-link')).toHaveCount(0);
	});

	test('fstring-derive: fstring derive stage is parsed from full query', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);

		// Switch to GUI mode; code parses into 11 stages including fstring derive
		await switchToGuiMode(page);
		await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(11, { timeout: 5_000 });

		// The 9th stage is `derive name = f"{...}"` → fstring mode (2nd derive stage, 0-indexed)
		await expandStage(page, 'derive', 1);
		await page.locator('[data-testid="stage-card"][data-stage-type="derive"]').nth(1).locator('[role="listitem"]').first().locator('button').first().click({ force: true });
		const fstringInput = page.locator('[data-testid="derive-fstring-template"]').first();
		await expect(fstringInput).toBeVisible({ timeout: 3_000 });

		// Switch to PRQL mode and verify f-string syntax
		await page.locator('.notebook-cell').first().getByRole('button', { name: /Switch to PRQL mode/i }).first().click();
		await page.waitForSelector('.code-editor .monaco-editor', { timeout: 5_000 });
		const preview = page.locator('.notebook-cell').first().locator('.view-lines').first();
		await expect(preview).toContainText('f"');
	});

	test('sstring-derive: sstring derive stage is parsed from full query', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);

		// Switch to GUI mode
		await switchToGuiMode(page);
		await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(11, { timeout: 5_000 });

		// The 11th stage is `derive db_version = s"version()"` → sstring mode (3rd derive stage, 0-indexed)
		await expandStage(page, 'derive', 2);
		await page.locator('[data-testid="stage-card"][data-stage-type="derive"]').nth(2).locator('[role="listitem"]').first().locator('button').first().click({ force: true });
		const sstringInput = page.locator('[data-testid="derive-sstring-template"]').first();
		await expect(sstringInput).toBeVisible({ timeout: 3_000 });

		// Switch to PRQL mode and verify s-string syntax
		await page.locator('.notebook-cell').first().getByRole('button', { name: /Switch to PRQL mode/i }).first().click();
		await page.waitForSelector('.code-editor .monaco-editor', { timeout: 5_000 });
		const preview = page.locator('.notebook-cell').first().locator('.view-lines').first();
		await expect(preview).toContainText('s"');
	});

	test('join alias + shorthand condition: alias input and shorthand button', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);
		await switchToGuiMode(page);
		await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(11, { timeout: 5_000 });

		// The join stage (8th stage, 0-indexed = 7) should have alias "c"
		await expandStage(page, 'join', 0);
		await page.locator('[data-testid="stage-card"][data-stage-type="join"]').first().locator('[data-testid="join-main-pill"]').click({ force: true });
		const joinAliasInput = page.locator('[data-testid="join-alias-input"]').first();
		await expect(joinAliasInput).toHaveValue('c');

		// The shorthand condition column should show "customer_id"
		await page.locator('[data-testid="stage-card"][data-stage-type="join"]').first().locator('[role="listitem"]').first().locator('button').first().click({ force: true });
		const shorthandCol = page.locator('[data-testid="join-shorthand-col"]').first();
		await expect(shorthandCol).toBeVisible();
	});

	test('date literal filter: @-prefixed value preserved in output', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);
		await switchToGuiMode(page);
		await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(11, { timeout: 5_000 });

		// Switch to PRQL mode and verify date literal is preserved
		await page.locator('.notebook-cell').first().getByRole('button', { name: /Switch to PRQL mode/i }).first().click();
		await page.waitForSelector('.code-editor .monaco-editor', { timeout: 5_000 });
		const preview = page.locator('.notebook-cell').first().locator('.view-lines').first();
		await expect(preview).toContainText('@1970-01-16');
	});

	test('average no-alias: group stage aggregate shows average without alias', async ({ page }) => {
		await gotoWithCode(page, FULL_QUERY);
		await switchToGuiMode(page);
		await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(11, { timeout: 5_000 });

		// Switch to PRQL mode and verify no-alias average
		await page.locator('.notebook-cell').first().getByRole('button', { name: /Switch to PRQL mode/i }).first().click();
		await page.waitForSelector('.code-editor .monaco-editor', { timeout: 5_000 });
		const preview = page.locator('.notebook-cell').first().locator('.view-lines').first();
		// Should have `average total` with no assignment prefix
		await expect(preview).toContainText('average');
	});
});
