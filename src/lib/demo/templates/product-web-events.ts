import { Activity } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import type { ChartConfig, GUIPipelineStage } from '$lib/types/gui-pipeline';
import { guiToPreql } from '$lib/services/gui-prql';
import { makeDemoCell, makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

function build(): Notebook {
	// random() (not range % N) drives every categorical/user pick here — a fixed
	// modulo cycle lines up identically with the day cycle and produces a
	// perfectly flat daily-active-users line and equal-height bars, which
	// looked like a bug (it visually was one) even though the SQL "worked".
	const eventsSQL = `SELECT
  range + 1 AS event_id,
  1 + FLOOR(random() * 400)::INTEGER AS user_id,
  DATE '2024-06-01' + FLOOR(random() * 60)::INTEGER * INTERVAL '1 day' AS event_date,
  (['page_view','click','search','add_to_cart','checkout'])[FLOOR(random() * 5)::INTEGER + 1] AS event_type,
  (['desktop','mobile','tablet'])[FLOOR(random() * 3)::INTEGER + 1] AS device
FROM range(8000)`;

	const dailyActiveUsersSQL = `SELECT
  event_date,
  COUNT(DISTINCT user_id) AS active_users
FROM web_events
GROUP BY event_date
ORDER BY event_date`;

	const eventBreakdownGuiStages: GUIPipelineStage[] = [
		{ type: 'from', table: 'web_events' },
		{
			type: 'group',
			by: ['event_type'],
			aggregations: [{ name: 'event_count', func: 'count', column: '' }]
		},
		{ type: 'sort', keys: [{ column: 'event_count', dir: 'desc' }] }
	];
	const eventBreakdownPRQL = guiToPreql(eventBreakdownGuiStages);

	const deviceBreakdownPRQL = `from web_events
group device (
  aggregate { event_count = count this }
)
sort {-event_count}`;

	const introMarkdown = `# Product & Web Events

Synthetic clickstream data — 8,000 events across 400 users over 60 days. Shows a daily-active-users trend, a GUI-pipeline event breakdown, and a device split.`;

	const closingMarkdown = `## Engagement overview

{% chart type="line" data=$daily_active_users.rows x="event_date" y="active_users" title="Daily active users" /%}

{% grid cols=2 %}
{% chart type="bar" data=$event_breakdown.rows x="event_type" y="event_count" title="Events by type" /%}
{% chart type="pie" data=$device_breakdown.rows x="device" y="event_count" title="Events by device" /%}
{% /grid %}`;

	const cells: Cell[] = [
		{ ...makeDemoMarkdownCell(introMarkdown), display: 'output' },
		{ ...makeDemoCell(eventsSQL, 'web_events', 'sql'), editMode: 'prql', resultViewMode: 'stats' },
		{
			...makeDemoCell(dailyActiveUsersSQL, 'daily_active_users', 'sql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'line',
				xColumn: 'event_date',
				yColumns: ['active_users'],
				colorColumn: null,
				title: 'Daily active users'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(eventBreakdownPRQL, 'event_breakdown', 'prql'),
			editMode: 'gui',
			guiStages: eventBreakdownGuiStages,
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar',
				xColumn: 'event_type',
				yColumns: ['event_count'],
				colorColumn: null,
				title: 'Events by type'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(deviceBreakdownPRQL, 'device_breakdown', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'pie',
				xColumn: 'device',
				yColumns: ['event_count'],
				colorColumn: null,
				title: 'Events by device'
			} satisfies ChartConfig
		},
		{ ...makeDemoMarkdownCell(closingMarkdown), display: 'output' }
	];

	return {
		id: makeDemoId(),
		name: 'Product & Web Events',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: {}
	};
}

export const productWebEventsTemplate: DashboardTemplate = {
	id: 'product-web-events',
	name: 'Product & Web Events',
	description: 'Clickstream analysis with DAU trend, event breakdown, and device split.',
	category: 'analytics',
	icon: Activity,
	build
};
