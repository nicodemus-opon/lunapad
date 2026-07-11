import { Code2 } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import { makeDemoCell, makeDemoId, makeDemoMarkdownCell, makeDemoPythonCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

function build(): Notebook {
	const seedSQL = `SELECT
  range + 1 AS reading_id,
  DATE '2024-01-01' + CAST(range AS INTEGER) * INTERVAL '1 day' AS reading_date,
  20 + 10 * SIN(range * 0.05) + (range % 7) AS temperature_c
FROM range(365)`;

	const pythonCode = `# readings is bound automatically as a pandas DataFrame (upstream cell output).
# Plotted against reading_id (day-of-year) rather than reading_date — the
# Python runner's datetime-axis serialization has a known bug (renders as
# epoch/1970), so an integer x-axis is used here until that's fixed upstream.
readings['rolling_avg'] = readings['temperature_c'].rolling(14).mean()

fig = go.Figure()
fig.add_trace(go.Scatter(x=readings['reading_id'], y=readings['temperature_c'], name='Daily', opacity=0.4))
fig.add_trace(go.Scatter(x=readings['reading_id'], y=readings['rolling_avg'], name='14-day rolling avg'))
fig.update_layout(title='Temperature with rolling average', xaxis_title='Day of year', yaxis_title='°C')

result = readings[['reading_date', 'temperature_c', 'rolling_avg']]`;

	const introMarkdown = `# Python Analysis

A synthetic daily-readings table (\`readings\`), then a Python cell that computes a rolling average with pandas and renders a Plotly figure. \`pd\`, \`go\`, and \`px\` are pre-imported — reference any upstream cell's output name directly as a DataFrame, no boilerplate needed.`;

	const cells: Cell[] = [
		{ ...makeDemoMarkdownCell(introMarkdown), display: 'output' },
		{ ...makeDemoCell(seedSQL, 'readings', 'sql'), editMode: 'prql', resultViewMode: 'table' },
		{ ...makeDemoPythonCell(pythonCode, 'rolling_avg_temp'), resultViewMode: 'table' }
	];

	return {
		id: makeDemoId(),
		name: 'Python Analysis',
		folderId: null,
		cells,
		defaultCellLanguage: 'sql',
		filters: {}
	};
}

export const pythonAnalysisTemplate: DashboardTemplate = {
	id: 'python-analysis',
	name: 'Python Analysis',
	description: 'A seeded table plus a pandas + Plotly cell computing a rolling average.',
	category: 'starters',
	icon: Code2,
	build
};
