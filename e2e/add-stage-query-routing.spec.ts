import { test, expect, type Page } from '@playwright/test';

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

async function gotoWithCode(page: Page, code: string) {
	await page.addInitScript((prql) => {
		const notebookId = 'test-nb-stage-routing';
		const cellId = 'test-cell-stage-routing';
		const storageData = {
			notebooks: [{
				id: notebookId,
				name: 'Stage Routing Notebook',
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
	await page.waitForSelector('.code-editor .monaco-editor', { timeout: 10_000 });
}

async function switchToGuiMode(page: Page, expectedStages = 11) {
	await page.locator('.notebook-cell').first().getByRole('button', { name: 'Visual', exact: true }).first().click({ force: true });
	await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(expectedStages, { timeout: 5_000 });
}

test('add-stage menu prioritizes stage primitives for broad natural-language stage intents', async ({ page }) => {
	await gotoWithCode(page, FULL_QUERY);
	await switchToGuiMode(page);

	const firstStageCard = page.locator('[data-testid="stage-card"]').first();
	await firstStageCard.focus();
	await page.keyboard.press('a');

	const queryInput = page.getByPlaceholder(/Prompt or search stages/i);
	await expect(queryInput).toBeVisible();

	const patterns: Array<{ query: string; expectedStageKeyword: string }> = [
		{ query: 'filter status = active', expectedStageKeyword: 'filter' },
		{ query: 'please group by region', expectedStageKeyword: 'group' },
		{ query: 'show me order by created_at desc', expectedStageKeyword: 'sort' },
		{ query: 'can you derive revenue_per_user', expectedStageKeyword: 'derive' },
		{ query: 'limit 10', expectedStageKeyword: 'take' },
		{ query: 'merge customers on customer_id', expectedStageKeyword: 'join' },
		{ query: 'rolling 7 day average', expectedStageKeyword: 'window' },
		{ query: 'from invoices', expectedStageKeyword: 'from' }
	];

	for (const pattern of patterns) {
		await queryInput.fill(pattern.query);
		const stageHeading = page.locator('.chip-lane-heading', { hasText: 'Stage primitives' }).first();
		await expect(stageHeading).toBeVisible();
		await expect(page.getByText('Function results', { exact: true })).toHaveCount(0);
		const stageSection = stageHeading.locator('xpath=ancestor::section[1]');
		const firstStageButton = stageSection.locator('button').first();
		await expect(firstStageButton).toBeVisible();
		await expect(firstStageButton).toContainText(new RegExp(pattern.expectedStageKeyword, 'i'));
	}
});

test('add-stage menu prioritizes analysis lane for natural-language analytical queries', async ({ page }) => {
	await gotoWithCode(page, FULL_QUERY);
	await switchToGuiMode(page);

	const firstStageCard = page.locator('[data-testid="stage-card"]').first();
	await firstStageCard.focus();
	await page.keyboard.press('a');

	const queryInput = page.getByPlaceholder(/Prompt or search stages/i);
	await expect(queryInput).toBeVisible();
	await queryInput.fill('source platform by month');

	await expect(page.locator('.chip-lane-heading').first()).toHaveText('Analysis prompts');
	const firstLaneSection = page.locator('.chip-lane-heading').first().locator('xpath=ancestor::section[1]');
	await expect(firstLaneSection.locator('button').first()).toContainText(/Query/i);
});

test('add-stage prompt Enter flow applies generated block and updates PRQL editor text', async ({ page }) => {
	await gotoWithCode(page, FULL_QUERY);
	await switchToGuiMode(page);

	const stageCards = page.locator('[data-testid="stage-card"]');
	await expect(stageCards).toHaveCount(11);

	const firstStageCard = stageCards.first();
	await firstStageCard.focus();
	await page.keyboard.press('a');

	const queryInput = page.getByPlaceholder(/Prompt or search stages/i);
	await expect(queryInput).toBeVisible();
	await queryInput.fill('group customer_id and show top total');
	await queryInput.press('Enter');

	// If Enter generated a preview (instead of auto-apply), apply it explicitly.
	const applyButton = page.getByRole('button', { name: /Apply block/i });
	if (await applyButton.count()) {
		if (await applyButton.first().isVisible()) {
			await applyButton.first().click();
		}
	}

	const totalStages = await stageCards.count();
	expect(totalStages).toBeGreaterThan(11);

	await page.locator('.notebook-cell').first().getByRole('button', { name: 'PRQL', exact: true }).first().click();
	await page.waitForSelector('.code-editor .monaco-editor', { timeout: 5_000 });

	const prqlText = (await page.locator('.notebook-cell').first().locator('.view-lines').first().innerText()).replace(/\u00a0/g, ' ');
	const groupCount = prqlText.match(/\bgroup\b/gi)?.length ?? 0;

	expect(groupCount).toBeGreaterThan(1);
	expect(prqlText.toLowerCase()).toContain('customer_id');
	expect(prqlText.toLowerCase()).toMatch(/sum_[a-z_]+\s*=\s*sum\s+[a-z_]+|avg_[a-z_]+\s*=\s*average\s+[a-z_]+/);
	expect(prqlText.toLowerCase()).toMatch(/take\s+\d+/);
	expect(prqlText.toLowerCase()).not.toContain('# add sort keys');
});

test('add-stage prompt Shift+Enter force-applies block and updates stage card types before PRQL switch', async ({ page }) => {
	await gotoWithCode(page, FULL_QUERY);
	await switchToGuiMode(page);

	const stageCards = page.locator('[data-testid="stage-card"]');
	await expect(stageCards).toHaveCount(11);

	const baselineGroupCount = await page.locator('[data-testid="stage-card"][data-stage-type="group"]').count();
	const baselineTakeCount = await page.locator('[data-testid="stage-card"][data-stage-type="take"]').count();

	const firstStageCard = stageCards.first();
	await firstStageCard.focus();
	await page.keyboard.press('a');

	const queryInput = page.getByPlaceholder(/Prompt or search stages/i);
	await expect(queryInput).toBeVisible();
	await queryInput.fill('group customer_id and show top total');
	await queryInput.press('Shift+Enter');

	const totalStages = await stageCards.count();
	expect(totalStages).toBeGreaterThan(11);

	const groupCount = await page.locator('[data-testid="stage-card"][data-stage-type="group"]').count();
	const takeCount = await page.locator('[data-testid="stage-card"][data-stage-type="take"]').count();
	expect(groupCount).toBeGreaterThan(baselineGroupCount);
	expect(takeCount).toBeGreaterThanOrEqual(baselineTakeCount);

	await page.locator('.notebook-cell').first().getByRole('button', { name: 'PRQL', exact: true }).first().click();
	await page.waitForSelector('.code-editor .monaco-editor', { timeout: 5_000 });

	const prqlText = (await page.locator('.notebook-cell').first().locator('.view-lines').first().innerText()).replace(/\u00a0/g, ' ');
	expect(prqlText.toLowerCase()).toContain('group customer_id');
	expect(prqlText.toLowerCase()).toMatch(/sum_[a-z_]+\s*=\s*sum\s+[a-z_]+|avg_[a-z_]+\s*=\s*average\s+[a-z_]+/);
	expect(prqlText.toLowerCase()).toMatch(/take\s+\d+/);
	expect(prqlText.toLowerCase()).not.toContain('# add sort keys');
});
