import { Megaphone } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import type { ChartConfig } from '$lib/types/gui-pipeline';
import { makeDemoCell, makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

function build(): Notebook {
	const funnelEventsSQL = `SELECT * FROM (VALUES
  ('Organic', 'Impression', 12000), ('Organic', 'Click', 4200), ('Organic', 'Signup', 1100), ('Organic', 'Activation', 640), ('Organic', 'Purchase', 310),
  ('Paid Search', 'Impression', 9000), ('Paid Search', 'Click', 3600), ('Paid Search', 'Signup', 980), ('Paid Search', 'Activation', 510), ('Paid Search', 'Purchase', 260),
  ('Paid Social', 'Impression', 15000), ('Paid Social', 'Click', 3000), ('Paid Social', 'Signup', 720), ('Paid Social', 'Activation', 300), ('Paid Social', 'Purchase', 110),
  ('Email', 'Impression', 6000), ('Email', 'Click', 2800), ('Email', 'Signup', 1400), ('Email', 'Activation', 900), ('Email', 'Purchase', 520)
) AS t(channel, stage, event_count)`;

	const funnelTotalsSQL = `SELECT
  stage,
  SUM(event_count) AS total_events,
  CASE stage
    WHEN 'Impression' THEN 1 WHEN 'Click' THEN 2 WHEN 'Signup' THEN 3
    WHEN 'Activation' THEN 4 WHEN 'Purchase' THEN 5
  END AS stage_order
FROM funnel_events
GROUP BY stage
ORDER BY stage_order`;

	const channelPurchasesPRQL = `from funnel_events
filter stage == "Purchase"
select { channel, event_count }
sort {-event_count}`;

	const introMarkdown = `# Marketing Funnel

Synthetic ad-channel performance data — impressions through purchase, by channel. Run all cells to populate the funnel chart and channel comparison below.`;

	const closingMarkdown = `## Channel performance

{% grid cols=2 %}
{% chart type="funnel" data=$funnel_totals.rows x="stage" y="total_events" title="Overall funnel" /%}
{% chart type="bar-horizontal" data=$channel_purchases.rows x="channel" y="event_count" title="Purchases by channel" /%}
{% /grid %}`;

	const cells: Cell[] = [
		{ ...makeDemoMarkdownCell(introMarkdown), display: 'output' },
		{ ...makeDemoCell(funnelEventsSQL, 'funnel_events', 'sql'), editMode: 'prql', resultViewMode: 'table' },
		{
			...makeDemoCell(funnelTotalsSQL, 'funnel_totals', 'sql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'funnel',
				xColumn: 'stage',
				yColumns: ['total_events'],
				colorColumn: null,
				title: 'Overall funnel'
			} satisfies ChartConfig
		},
		{
			...makeDemoCell(channelPurchasesPRQL, 'channel_purchases', 'prql'),
			editMode: 'prql',
			resultViewMode: 'chart',
			resultChartConfig: {
				chartType: 'bar-horizontal',
				xColumn: 'channel',
				yColumns: ['event_count'],
				colorColumn: null,
				title: 'Purchases by channel'
			} satisfies ChartConfig
		},
		{ ...makeDemoMarkdownCell(closingMarkdown), display: 'output' }
	];

	return {
		id: makeDemoId(),
		name: 'Marketing Funnel',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: {}
	};
}

export const marketingFunnelTemplate: DashboardTemplate = {
	id: 'marketing-funnel',
	name: 'Marketing Funnel',
	description: 'Impressions-to-purchase funnel and channel comparison on synthetic ad data.',
	category: 'analytics',
	icon: Megaphone,
	build
};
