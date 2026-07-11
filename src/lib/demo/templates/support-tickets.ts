import { LifeBuoy } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import type { ChartConfig } from '$lib/types/gui-pipeline';
import { makeDemoCell, makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

function build(): Notebook {
	// random() (not range % N) for every pick, and created_date/resolution_days
	// are computed once in the inner query so resolved_date stays derived from
	// the same value — a fixed modulo cycle divides evenly into round row
	// counts and produces suspiciously uniform per-group counts.
	const ticketsSQL = `SELECT
  ticket_id,
  created_date,
  created_date + CAST(resolution_days AS INTEGER) * INTERVAL '1 day' AS resolved_date,
  priority,
  status
FROM (
  SELECT
    range + 1 AS ticket_id,
    DATE '2024-01-01' + FLOOR(random() * 300)::INTEGER * INTERVAL '1 day' AS created_date,
    1 + FLOOR(random() * 10)::INTEGER AS resolution_days,
    (['Low','Medium','High','Urgent'])[FLOOR(random() * 4)::INTEGER + 1] AS priority,
    (['Open','In Progress','Resolved','Closed'])[FLOOR(random() * 4)::INTEGER + 1] AS status
  FROM range(1200)
)`;

	const resolutionByPrioritySQL = `SELECT
  priority,
  ROUND(AVG(DATE_DIFF('day', created_date, resolved_date)), 1) AS avg_resolution_days,
  COUNT(*) AS ticket_count
FROM tickets
GROUP BY priority
ORDER BY avg_resolution_days DESC`;

	const statusBreakdownPRQL = `from tickets
group status (
  aggregate { ticket_count = count this }
)
sort {-ticket_count}`;

	const monthlyTrendSQL = `SELECT
  DATE_TRUNC('month', created_date) AS month,
  ROUND(AVG(DATE_DIFF('day', created_date, resolved_date)), 1) AS avg_resolution_days,
  COUNT(*) - LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', created_date)) AS ticket_volume_delta
FROM tickets
GROUP BY DATE_TRUNC('month', created_date)
ORDER BY month`;

	const introMarkdown = `# Support Ticket Analytics

Synthetic ticket data — 1,200 tickets with priority, status, and resolution time. Shows SLA-style resolution metrics by priority, a status breakdown, and a monthly trend with a window-function delta.`;

	const closingMarkdown = `## Ticket health

{% chart type="bar-horizontal" data=$resolution_by_priority.rows x="priority" y="avg_resolution_days" title="Avg. resolution time by priority (days)" /%}

{% grid cols=2 %}
{% chart type="pie" data=$status_breakdown.rows x="status" y="ticket_count" title="Tickets by status" /%}
{% datatable data=$monthly_trend.rows cols=["month","avg_resolution_days","ticket_volume_delta"] limit=12 /%}
{% /grid %}`;

	const cells: Cell[] = [
		{ ...makeDemoMarkdownCell(introMarkdown), display: 'output' },
		{ ...makeDemoCell(ticketsSQL, 'tickets', 'sql'), editMode: 'prql', resultViewMode: 'stats' },
		{
			...makeDemoCell(resolutionByPrioritySQL, 'resolution_by_priority', 'sql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar-horizontal',
				xColumn: 'priority',
				yColumns: ['avg_resolution_days'],
				colorColumn: null,
				title: 'Avg. resolution time by priority (days)'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(statusBreakdownPRQL, 'status_breakdown', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'pie',
				xColumn: 'status',
				yColumns: ['ticket_count'],
				colorColumn: null,
				title: 'Tickets by status'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(monthlyTrendSQL, 'monthly_trend', 'sql'),
			editMode: 'prql',
			resultViewMode: 'table'
		},
		{ ...makeDemoMarkdownCell(closingMarkdown), display: 'output' }
	];

	return {
		id: makeDemoId(),
		name: 'Support Ticket Analytics',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: {}
	};
}

export const supportTicketsTemplate: DashboardTemplate = {
	id: 'support-tickets',
	name: 'Support Ticket Analytics',
	description: 'SLA resolution time by priority, status mix, and a monthly trend with a window function.',
	category: 'analytics',
	icon: LifeBuoy,
	build
};
