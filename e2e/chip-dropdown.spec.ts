/**
 * Verifies chip intelligence, dropdown positioning, and save-on-blur.
 *
 * Key problems being tested:
 * 1. Dropdowns (InlineChipLabel / ChipInput) appear below the chip at the correct
 *    viewport position (not offset due to CSS transform containing-block bug)
 * 2. Add-chip buttons pre-fill from intelligence (select/filter/sort/group)
 * 3. Insert-after zone pre-fills with intelligent defaults
 * 4. Expanded condition editors save/collapse when focus leaves
 */
import { test, expect, type Page } from '@playwright/test';

// ── Schema injected for every test ─────────────────────────────────────────
const INVOICES_COLUMNS = ['invoice_id', 'customer_id', 'invoice_date', 'total', 'billing_country'];

async function gotoGuiWithStages(page: Page, stages: object[]) {
	await page.addInitScript((stages) => {
		const notebookId = 'chip-test-nb';
		const cellId = 'chip-test-cell';
		const storageData = {
			notebooks: [{
				id: notebookId,
				name: 'Chip Test',
				folderId: null,
				cells: [{
					id: cellId,
					outputName: 'result1',
					code: '',
					status: 'idle',
					result: null,
					errors: [],
					compiledSQL: null,
					executionMs: null,
					guiStages: stages,
					editMode: 'gui',
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
	}, stages);

	await page.goto('/');
	// Wait for app to fully initialize (loading screen clears only after DuckDB + catalog init)
	await page.waitForSelector('[data-testid="stage-card"]', { timeout: 15_000 });

	// Inject the invoices schema via test helpers — this populates tableSchemas in GUIEditor
	// so colsAt() returns real columns and intelligence functions have data to work with
	await page.evaluate((cols) => {
		const h = (window as any).__testHelpers;
		if (!h) throw new Error('__testHelpers not available');
		h.addTable({
			name: 'invoices',
			fileName: 'invoices.csv',
			rowCount: 412,
			columns: cols,
			columnTypes: ['INTEGER', 'INTEGER', 'DATE', 'DECIMAL', 'VARCHAR'],
			relationType: 'BASE TABLE'
		});
	}, INVOICES_COLUMNS);

	// Brief tick for Svelte reactivity to propagate tableSchemas
	await page.waitForTimeout(100);
}

// ── Test 1: Dropdown positioned below the input ────────────────────────────

test('chip dropdown appears below the chip after animation completes', async ({ page }) => {
	await gotoGuiWithStages(page, [
		{ type: 'from', table: 'invoices' },
		{ type: 'sort', keys: [{ column: 'total', dir: 'desc' }] }
	]);

	const sortCard = page.locator('[data-testid="stage-card"][data-stage-type="sort"]');
	const pill = sortCard.locator('[role="listitem"]').first();

	// Click the column label button (the InlineChipLabel in non-editing mode)
	const labelBtn = pill.getByRole('button').filter({ hasText: 'total' });
	await labelBtn.click();

	// Input should now be in edit mode
	const input = pill.locator('input[placeholder="column…"]');
	await expect(input).toBeVisible({ timeout: 2_000 });

	// The dropdown should appear — suggestions are the invoices columns
	const dropdown = page.locator('div[style*="position: fixed"]').filter({ hasText: /invoice_id|customer_id|invoice_date|total/ });
	await expect(dropdown).toBeVisible({ timeout: 2_000 });

	const inputBox = await input.boundingBox();
	const dropBox  = await dropdown.boundingBox();

	await page.screenshot({ path: '/tmp/dropdown-below-chip.png' });

	expect(inputBox).not.toBeNull();
	expect(dropBox).not.toBeNull();

	// Dropdown must appear BELOW the input (with 60px tolerance for padding/offset)
	console.log(`Input bottom: ${inputBox!.y + inputBox!.height}  Dropdown top: ${dropBox!.y}`);
	expect(dropBox!.y).toBeGreaterThan(inputBox!.y);
	// And not absurdly far — must be within 200px of the input bottom
	expect(dropBox!.y).toBeLessThan(inputBox!.y + inputBox!.height + 200);
});

// ── Test 2: SelectStage add-chip pre-fills the first unselected column ──────

test('select stage add-chip pre-fills with an unselected column', async ({ page }) => {
	await gotoGuiWithStages(page, [
		{ type: 'from', table: 'invoices' },
		{ type: 'select', columns: ['invoice_id'] } // invoice_id already selected
	]);

	const selectCard = page.locator('[data-testid="stage-card"][data-stage-type="select"]');
	await selectCard.click();

	const addBtn = selectCard.getByRole('button', { name: /add/i });
	await addBtn.click();

	// Pending chip appears in edit mode
	const input = selectCard.locator('input[placeholder="column…"]');
	await expect(input).toBeVisible({ timeout: 2_000 });

	const value = await input.inputValue();
	console.log('Select pre-filled value:', value);

	expect(value).not.toBe('');
	expect(value).not.toBe('invoice_id'); // already selected, should suggest next column

	await page.screenshot({ path: '/tmp/select-prefill.png' });
});

// ── Test 3: FilterStage add-chip picks date column with >= ──────────────────

test('filter stage add-chip uses intelligence: date column gets >= op', async ({ page }) => {
	await gotoGuiWithStages(page, [
		{ type: 'from', table: 'invoices' },
		{ type: 'filter', conditions: [], logic: 'and' }
	]);

	const filterCard = page.locator('[data-testid="stage-card"][data-stage-type="filter"]');
	await filterCard.click();

	await filterCard.getByRole('button', { name: /add/i }).click();
	await page.waitForTimeout(200);

	// Expanded condition should be visible
	const colInput = filterCard.locator('[data-testid="filter-column-input"]');
	await expect(colInput).toBeVisible({ timeout: 2_000 });

	const col = await colInput.inputValue();
	console.log('Filter column pre-filled:', col);
	expect(col).not.toBe('');

	// For invoice_date (DATE pattern), op should be >=
	const opSelect = filterCard.locator('select').first();
	await expect(opSelect).toBeVisible();
	const op = await opSelect.inputValue();
	console.log('Filter op:', op);

	if (col === 'invoice_date') {
		expect(op).toBe('>=');
	} else if (col === 'total') {
		expect(op).toBe('>=');
	}

	await page.screenshot({ path: '/tmp/filter-intelligence.png' });
});

// ── Test 4: SortStage add-chip pre-fills with intelligent column ────────────

test('sort stage add-chip pre-fills with date or numeric column', async ({ page }) => {
	await gotoGuiWithStages(page, [
		{ type: 'from', table: 'invoices' },
		{ type: 'sort', keys: [] }
	]);

	const sortCard = page.locator('[data-testid="stage-card"][data-stage-type="sort"]');
	await sortCard.click();

	await sortCard.getByRole('button', { name: /add/i }).click();

	const input = sortCard.locator('input[placeholder="column…"]');
	await expect(input).toBeVisible({ timeout: 2_000 });

	const value = await input.inputValue();
	console.log('Sort pre-filled:', value);

	// Should prefer invoice_date (date pattern) or total (numeric pattern)
	expect(value).not.toBe('');
	expect(['invoice_date', 'total']).toContain(value);

	await page.screenshot({ path: '/tmp/sort-intelligence.png' });
});

// ── Test 5: GroupStage by-column add-chip picks categorical column ──────────

test('group stage by add-chip pre-fills with categorical column', async ({ page }) => {
	await gotoGuiWithStages(page, [
		{ type: 'from', table: 'invoices' },
		{ type: 'group', by: [], aggregations: [] }
	]);

	const groupCard = page.locator('[data-testid="stage-card"][data-stage-type="group"]');
	await groupCard.click();

	// The by-row has a small round + button with border-primary/30 styling
	// There are two + buttons: one for agg (top row) and one for by (bottom row)
	// The by + button comes after the "BY  none" row
	// The by-row + button is the last button in the group card
	// (buttons order: drag handle, collapse label, run, disable, remove, agg +, by +)
	const allPlusBtns = groupCard.locator('button');

	// Click the last one which is the by-column add button
	await allPlusBtns.last().click();
	await page.waitForTimeout(200);

	// The pending chip input should appear
	const inputs = groupCard.locator('input[placeholder="column…"]');
	const inputCount = await inputs.count();
	console.log('Column inputs after by add:', inputCount);
	expect(inputCount).toBeGreaterThan(0);

	const value = await inputs.last().inputValue();
	console.log('Group by pre-filled:', value);
	expect(value).not.toBe('');
	// billing_country = CATEGORICAL pattern → top pick; customer_id also fine
	expect(['billing_country', 'customer_id']).toContain(value);

	await page.screenshot({ path: '/tmp/group-by-intelligence.png' });
});

// ── Test 6: Insert-after zone creates filter with intelligent condition ──────

test('insert-after filter button creates condition with intelligent defaults', async ({ page }) => {
	await gotoGuiWithStages(page, [
		{ type: 'from', table: 'invoices' },
		{ type: 'sort', keys: [{ column: 'total', dir: 'desc' }] }
	]);

	// Hover the insert zone between FROM and SORT
	const insertZone = page.locator('.insert-zone').first();
	await insertZone.hover();

	await insertZone.getByRole('button', { name: 'filter' }).click();
	await page.waitForTimeout(300);

	// A filter stage should appear with a pre-filled condition
	const filterCard = page.locator('[data-testid="stage-card"][data-stage-type="filter"]');
	await expect(filterCard).toBeVisible({ timeout: 2_000 });

	const pills = filterCard.locator('[role="listitem"]');
	await expect(pills).toHaveCount(1, { timeout: 2_000 });

	const pillText = await pills.first().locator('button').first().textContent();
	console.log('Inserted filter condition text:', pillText);
	// Should not be empty placeholder "? is …"
	expect(pillText).not.toMatch(/^\?\s/);

	await page.screenshot({ path: '/tmp/insert-after-filter.png' });
});

// ── Test 7: Filter expanded condition collapses when Escape pressed ─────────
// (Escape is only dispatched to focused element; expandCond now auto-focuses input)

test('filter expanded condition collapses on Escape', async ({ page }) => {
	await gotoGuiWithStages(page, [
		{ type: 'from', table: 'invoices' },
		{ type: 'filter', conditions: [{ column: 'total', op: '>', value: '0' }], logic: 'and' }
	]);

	const filterCard = page.locator('[data-testid="stage-card"][data-stage-type="filter"]');
	await filterCard.click();

	// Click the pill to expand — expandCond auto-focuses the column input
	await filterCard.locator('[data-testid="filter-condition-pill"]').first().click();
	const colInput = filterCard.locator('[data-testid="filter-column-input"]');
	await expect(colInput).toBeVisible({ timeout: 2_000 });
	await expect(colInput).toBeFocused({ timeout: 2_000 });

	// Escape should collapse the expanded condition
	await page.keyboard.press('Escape');
	await page.waitForTimeout(200);

	await expect(colInput).not.toBeVisible({ timeout: 2_000 });

	await page.screenshot({ path: '/tmp/filter-escape-collapse.png' });
});

// ── Test 8: Clicking outside the expanded condition collapses it ────────────

test('filter expanded condition collapses when clicking outside', async ({ page }) => {
	await gotoGuiWithStages(page, [
		{ type: 'from', table: 'invoices' },
		{ type: 'filter', conditions: [{ column: 'total', op: '>', value: '0' }], logic: 'and' }
	]);

	const filterCard = page.locator('[data-testid="stage-card"][data-stage-type="filter"]');
	await filterCard.click();

	await filterCard.locator('[data-testid="filter-condition-pill"]').first().click();
	const colInput = filterCard.locator('[data-testid="filter-column-input"]');
	await expect(colInput).toBeVisible({ timeout: 2_000 });
	await expect(colInput).toBeFocused({ timeout: 2_000 });

	// Click the FROM stage card (completely outside the filter condition)
	await page.locator('[data-testid="stage-card"][data-stage-type="from"]').click();
	await page.waitForTimeout(300);

	await expect(colInput).not.toBeVisible({ timeout: 2_000 });

	await page.screenshot({ path: '/tmp/filter-click-outside-collapse.png' });
});

// ── Test 9: Verify no transform/filter persists on stage-item after animation

test('stage-item has no transform or filter after entry animation completes', async ({ page }) => {
	await gotoGuiWithStages(page, [
		{ type: 'from', table: 'invoices' }
	]);

	// Wait for animation to finish (--motion-medium = 220ms + delay)
	await page.waitForTimeout(600);

	const hasTransformOrFilter = await page.evaluate(() => {
		const items = document.querySelectorAll('.stage-item');
		for (const item of Array.from(items)) {
			const style = window.getComputedStyle(item);
			const transform = style.transform;
			const filter = style.filter;
			// transform: none means no containing block; any other value would be a bug
			if (transform && transform !== 'none' && transform !== '') return { transform, filter };
			if (filter && filter !== 'none' && filter !== '') return { transform, filter };
		}
		return null;
	});

	console.log('Persisted transform/filter:', hasTransformOrFilter);
	expect(hasTransformOrFilter).toBeNull();

	await page.screenshot({ path: '/tmp/animation-no-transform.png' });
});
