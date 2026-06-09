import { test, expect } from '@playwright/test';

const NOTEBOOK_STATE = {
	notebooks: [
		{
			id: 'nb-markdown-inline',
			name: 'Markdown Notebook',
			folderId: null,
			cells: [
				{
					id: 'cell-markdown-inline',
					cellType: 'markdown',
					outputName: 'note',
					code: '',
					markdown: '# Inline note\n\nThis editor should feel embedded in the cell.',
					markdownPreview: false,
					status: 'idle',
					result: null,
					errors: [],
					compiledSQL: null,
					executionMs: null,
					guiStages: [{ type: 'from', table: '' }],
					editMode: 'prql',
					resultViewMode: 'table',
					resultChartConfig: null,
					collapsed: false,
					stageResultsCollapsed: [],
					materializeMode: 'table',
					materializeTarget: 'note',
					materializeStatus: 'idle',
					materializeError: null,
					materializedRelationType: null
				}
			]
		}
	],
	folders: [],
	openNotebookTabIds: ['nb-markdown-inline'],
	expandedNotebookFolderIds: [],
	sidebarSectionsExpanded: { notebooks: true, tables: true },
	activeTabId: 'nb-markdown-inline',
	openResultTabs: [],
	openExtraTabs: [],
	tables: [],
	theme: 'system',
	autoRun: false
};

test('markdown edit mode reads inline and previews in place', async ({ page }) => {
	await page.addInitScript((state) => {
		localStorage.setItem('lunapad_notebook', JSON.stringify(state));
	}, NOTEBOOK_STATE);

	await page.goto('/');

	const cell = page.locator('.notebook-cell').first();
	const editor = cell.locator('textarea');

	await expect(editor).toBeVisible({ timeout: 10_000 });
	await expect(editor).toHaveAttribute('class', /border-0!/);
	await expect(editor).toHaveAttribute('class', /bg-transparent!/);
	await expect(editor).toHaveAttribute('class', /min-h-32!/);

	await cell.getByRole('button', { name: 'Preview' }).click();

	await expect(cell.getByRole('button', { name: 'Edit' })).toBeVisible();
	await expect(cell.locator('.prose')).toContainText('Inline note');
	await expect(editor).toHaveCount(0);
});
