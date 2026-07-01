import type { EvalScenario } from './assertions.js';

/** Golden scenarios — mock transcripts representing ideal agent behavior. */
export const EVAL_SCENARIOS: EvalScenario[] = [
	{
		id: 'investigate-before-build',
		description: 'Agent samples data before creating cells',
		prompt: 'Show me revenue by month from orders',
		transcript: [
			{
				role: 'assistant',
				toolCalls: [{ tool: 'sample_data', args: { table: 'orders', n: 10 } }]
			},
			{ role: 'user', content: 'Sample: 10 rows with order_date, amount columns' },
			{
				role: 'assistant',
				toolCalls: [
					{
						tool: 'create_cell',
						args: { outputName: 'revenue_by_month', cellType: 'query', code: 'SELECT ...' }
					}
				]
			},
			{ role: 'user', content: "Cell 'revenue_by_month' created" },
			{
				role: 'assistant',
				toolCalls: [{ tool: 'run_cells', args: { cellIds: ['revenue_by_month'] } }]
			},
			{ role: 'assistant', done: true }
		],
		assertions: [
			{ type: 'tool_before_any_create', investigate: 'sample_data' },
			{ type: 'tool_before', before: 'sample_data', after: 'create_cell' },
			{ type: 'tool_before', before: 'create_cell', after: 'run_cells' }
		]
	},
	{
		id: 'debug-no-delete',
		description: 'Debug loop fixes cells without deleting',
		prompt: 'Fix the error in revenue_by_month',
		transcript: [
			{
				role: 'assistant',
				toolCalls: [{ tool: 'get_lineage', args: { outputName: 'revenue_by_month' } }]
			},
			{ role: 'user', content: 'Lineage: depends on orders' },
			{
				role: 'assistant',
				toolCalls: [
					{ tool: 'update_cell', args: { cellId: 'revenue_by_month', code: 'SELECT ...' } }
				]
			},
			{
				role: 'assistant',
				toolCalls: [{ tool: 'run_cells', args: { cellIds: ['revenue_by_month'] } }]
			},
			{ role: 'assistant', done: true }
		],
		assertions: [
			{ type: 'tool_called', tool: 'get_lineage' },
			{ type: 'tool_not_called', tool: 'delete_cell' },
			{ type: 'tool_before', before: 'get_lineage', after: 'update_cell' }
		]
	},
	{
		id: 'discovery-search-first',
		description: 'Discovery phase searches workspace before building',
		prompt: 'Build a customer dimension from existing models',
		transcript: [
			{
				role: 'assistant',
				toolCalls: [{ tool: 'search_workspace', args: { query: 'customer dimension' } }]
			},
			{ role: 'user', content: 'Found: stg_customers, dim_users' },
			{
				role: 'assistant',
				toolCalls: [{ tool: 'list_cells', args: {} }]
			},
			{ role: 'assistant', done: true }
		],
		assertions: [
			{ type: 'tool_called', tool: 'search_workspace' },
			{ type: 'tool_before', before: 'search_workspace', after: 'list_cells' }
		]
	},
	{
		id: 'lineage-before-delete',
		description: 'Agent checks lineage before destructive operations',
		prompt: 'Remove the old_orders staging model',
		transcript: [
			{
				role: 'assistant',
				toolCalls: [{ tool: 'get_lineage', args: { outputName: 'stg_old_orders' } }]
			},
			{ role: 'user', content: 'No downstream dependents' },
			{
				role: 'assistant',
				toolCalls: [{ tool: 'delete_cell', args: { cellId: 'stg_old_orders' } }]
			},
			{ role: 'assistant', done: true }
		],
		assertions: [
			{ type: 'tool_before', before: 'get_lineage', after: 'delete_cell' },
			{ type: 'tool_called', tool: 'get_lineage' }
		]
	},
	{
		id: 'chart-after-run',
		description: 'Visualization follows validation',
		prompt: 'Chart the top products query',
		transcript: [
			{
				role: 'assistant',
				toolCalls: [{ tool: 'run_cells', args: { cellIds: ['top_products'] } }]
			},
			{ role: 'user', content: 'Run succeeded: 50 rows' },
			{
				role: 'assistant',
				toolCalls: [{ tool: 'pick_chart', args: { cellId: 'top_products' } }]
			},
			{ role: 'assistant', done: true }
		],
		assertions: [
			{ type: 'tool_before', before: 'run_cells', after: 'pick_chart' },
			{ type: 'tool_called', tool: 'pick_chart' }
		]
	},
	{
		id: 'record-decision-after-discovery',
		description: 'Agent records decisions after confirming keys',
		prompt: 'Build dim_customers from orders',
		transcript: [
			{
				role: 'assistant',
				toolCalls: [{ tool: 'sample_data', args: { table: 'orders' } }]
			},
			{ role: 'user', content: 'orders.customer_id is unique' },
			{
				role: 'assistant',
				toolCalls: [{ tool: 'record_decision', args: { decision: 'customer_id is PK' } }]
			},
			{
				role: 'assistant',
				toolCalls: [{ tool: 'create_cell', args: { outputName: 'dim_customers' } }]
			},
			{ role: 'assistant', done: true }
		],
		assertions: [
			{ type: 'tool_before', before: 'record_decision', after: 'create_cell' },
			{ type: 'tool_called', tool: 'record_decision' }
		]
	},
	{
		id: 'sprint-investigate-first',
		description: 'Sprint tasks start with investigation',
		prompt: 'Build full revenue pipeline',
		transcript: [
			{
				role: 'assistant',
				toolCalls: [{ tool: 'list_cells', args: {} }]
			},
			{
				role: 'assistant',
				toolCalls: [{ tool: 'search_workspace', args: { query: 'revenue' } }]
			},
			{
				role: 'assistant',
				toolCalls: [{ tool: 'sample_data', args: { table: 'orders' } }]
			},
			{ role: 'assistant', done: true }
		],
		assertions: [
			{ type: 'tool_before', before: 'list_cells', after: 'search_workspace' },
			{ type: 'tool_not_called', tool: 'delete_cell' }
		]
	}
];
