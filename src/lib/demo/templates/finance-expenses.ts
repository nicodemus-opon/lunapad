import { Wallet } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import type { ChartConfig } from '$lib/types/gui-pipeline';
import { makeDemoCell, makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

function build(): Notebook {
	// random() (not range % N) for every pick — a fixed modulo cycle divides
	// evenly into round row counts and produces suspiciously uniform per-group
	// totals instead of a realistic spread.
	const expensesSQL = `SELECT
  range + 1 AS expense_id,
  (['Engineering','Sales','Marketing','Support','Operations'])[FLOOR(random() * 5)::INTEGER + 1] AS department,
  (['Software','Travel','Payroll','Office','Advertising'])[FLOOR(random() * 5)::INTEGER + 1] AS category,
  DATE '2024-01-01' + FLOOR(random() * 365)::INTEGER * INTERVAL '1 day' AS expense_date,
  ROUND(50 + random() * 4500, 2) AS amount
FROM range(1500)`;

	const budgetsSQL = `SELECT * FROM (VALUES
  ('Engineering', 400000.0),
  ('Sales', 250000.0),
  ('Marketing', 200000.0),
  ('Support', 150000.0),
  ('Operations', 180000.0)
) AS t(dept, budget)`;

	// GUI-pipeline cell mirroring the sales-analytics "join to a target table" shape,
	// applied to a different domain (budget vs. actual spend instead of quota vs. revenue).
	const budgetVsActualPRQL = `from e=expenses
join b=budgets (e.department==b.dept)
group e.department (
  aggregate { total_spent = sum e.amount, budget = max b.budget }
)
sort {-total_spent}`;

	const categorySpendSQL = `SELECT
  category,
  SUM(amount) AS total_spent,
  COUNT(*) AS expense_count
FROM expenses
GROUP BY category
ORDER BY total_spent DESC`;

	const introMarkdown = `# Finance & Expenses

Synthetic expense ledger — 1,500 line items across 5 departments, joined against department budgets. Run all cells to see budget-vs-actual and category spend.`;

	const closingMarkdown = `## Spend overview

{% chart type="bar" data=$budget_vs_actual.rows x="department" y="total_spent,budget" title="Budget vs. actual by department" /%}

{% chart type="bar-horizontal" data=$category_spend.rows x="category" y="total_spent" title="Spend by category" /%}`;

	const cells: Cell[] = [
		{ ...makeDemoMarkdownCell(introMarkdown), display: 'output' },
		{ ...makeDemoCell(expensesSQL, 'expenses', 'sql'), editMode: 'prql', resultViewMode: 'stats' },
		{ ...makeDemoCell(budgetsSQL, 'budgets', 'sql'), editMode: 'prql' },
		{
			...makeDemoCell(budgetVsActualPRQL, 'budget_vs_actual', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar',
				xColumn: 'department',
				yColumns: ['total_spent', 'budget'],
				colorColumn: null,
				seriesMode: 'grouped',
				title: 'Budget vs. actual by department'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(categorySpendSQL, 'category_spend', 'sql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar-horizontal',
				xColumn: 'category',
				yColumns: ['total_spent'],
				colorColumn: null,
				title: 'Spend by category'
			} satisfies ChartConfig
		},
		{ ...makeDemoMarkdownCell(closingMarkdown), display: 'output' }
	];

	return {
		id: makeDemoId(),
		name: 'Finance & Expenses',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: {}
	};
}

export const financeExpensesTemplate: DashboardTemplate = {
	id: 'finance-expenses',
	name: 'Finance & Expenses',
	description: 'Expense ledger joined to department budgets — budget-vs-actual and category spend.',
	category: 'analytics',
	icon: Wallet,
	build
};
