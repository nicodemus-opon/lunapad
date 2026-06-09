import { test, expect } from '@playwright/test';

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

test('debug: localStorage preload + GUI click', async ({ page }) => {
	// Pre-inject localStorage state
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
	}, FULL_QUERY);

	await page.goto('/');
	await page.waitForSelector('.cm-editor', { timeout: 10_000 });

	// Check what mode the cell loaded in
	await page.waitForFunction(() => !!(window as any).__testHelpers, { timeout: 5_000 });
	const initial = await page.evaluate(() => {
		const h = (window as any).__testHelpers;
		const cells = h.getCells();
		return { mode: cells[0]?.editMode, codeLen: cells[0]?.code?.length, codeStart: cells[0]?.code?.slice(0, 30) };
	});
	console.log('initial (from localStorage):', JSON.stringify(initial));

	// Click GUI button
	await page.locator('.notebook-cell').first().getByRole('button', { name: /GUI/ }).first().click();

	// Wait for stage-editor (with 3s timeout)
	try {
		await page.waitForSelector('.stage-editor', { timeout: 3_000 });
		console.log('.stage-editor appeared!');
	} catch {
		console.log('.stage-editor did NOT appear after 3s');
	}

	// Check state after GUI click
	const afterGui = await page.evaluate(() => {
		const h = (window as any).__testHelpers;
		const cells = h.getCells();
		return { mode: cells[0]?.editMode, stageCount: cells[0]?.guiStages?.length };
	});
	console.log('after GUI click:', JSON.stringify(afterGui));

	const count = await page.locator('[data-testid="stage-card"]').count();
	console.log('stage-card DOM count:', count);

	// Check innerHTML for any GUIEditor content
	const hasStageEditor = await page.locator('.notebook-cell').first().innerHTML().then(h => h.includes('stage-editor'));
	console.log('cell has stage-editor in HTML:', hasStageEditor);

	expect(afterGui.mode).toBe('gui');
	expect(afterGui.stageCount).toBe(11);
});


	// Wait for testHelpers
	await page.waitForFunction(() => !!(window as any).__testHelpers, { timeout: 10_000 });

	// Check initial state
	const initial = await page.evaluate(() => {
		const h = (window as any).__testHelpers;
		const cells = h.getCells();
		return { cnt: cells.length, mode: cells[0]?.editMode, code: cells[0]?.code?.slice(0, 30) };
	});
	console.log('initial:', JSON.stringify(initial));

	// Set code
	await page.evaluate(async (prql) => {
		const h = (window as any).__testHelpers;
		const cells = h.getCells();
		const cellId = cells[0].id;
		h.updateCellCode(cellId, prql);
		h.setEditMode(cellId, 'prql');
		await h.tick();
	}, FULL_QUERY);
	await page.waitForTimeout(100);

	// Check state after
	const after = await page.evaluate(() => {
		const h = (window as any).__testHelpers;
		const cells = h.getCells();
		return { mode: cells[0]?.editMode, codeLen: cells[0]?.code?.length, codeStart: cells[0]?.code?.slice(0, 30) };
	});
	console.log('after set:', JSON.stringify(after));

	expect(after.mode).toBe('prql');
	expect(after.codeLen).toBeGreaterThan(200);

	// Click GUI button
	await page.locator('.notebook-cell').first().getByRole('button', { name: /GUI/ }).first().click();
	
	// Wait for GUIEditor to appear (or timeout)
	try {
		await page.waitForSelector('.stage-editor', { timeout: 3_000 });
		console.log('stage-editor appeared!');
	} catch {
		console.log('stage-editor did NOT appear after 3s');
	}
	await page.waitForTimeout(500);

	// Check state after GUI click
	const afterGui = await page.evaluate(() => {
		const h = (window as any).__testHelpers;
		const cells = h.getCells();
		return { mode: cells[0]?.editMode, stageCount: cells[0]?.guiStages?.length, stages: cells[0]?.guiStages?.map((s: any) => s.type) };
	});
	console.log('after GUI click:', JSON.stringify(afterGui));

	// Check cell innerHTML after GUI click
	const cellHtml = await page.locator('.notebook-cell').first().innerHTML();
	const hasStageEditor = cellHtml.includes('stage-editor');
	const hasDataTestId = cellHtml.includes('data-testid');
	const hasStageCard = cellHtml.includes('stage-card');
	const hasGuiEditorContent = cellHtml.includes('space-y-0');
	console.log('cell has .stage-editor:', hasStageEditor);
	console.log('cell has data-testid:', hasDataTestId);
	console.log('cell has stage-card:', hasStageCard);
	console.log('cell has space-y-0 (GUIEditor container):', hasGuiEditorContent);
	
	// Check if GUIEditor is present
	const guiEditorCount = await page.locator('.stage-editor').count();
	console.log('.stage-editor count:', guiEditorCount);
	
	const stageCards = page.locator('[data-testid="stage-card"]');
	const count = await stageCards.count();
	console.log('stage-card count in DOM:', count);

	expect(afterGui.mode).toBe('gui');
	expect(afterGui.stageCount).toBe(11);
});
