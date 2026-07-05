import { READONLY_INVESTIGATION_TOOLS } from '$lib/server/ai-tools.js';

// Native OpenAI-format tool definitions (kept minimal to reduce token count)
// Lookup tools run client-side; they inject results as text into the message thread.
export const NATIVE_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'create_cell',
			description:
				'MANDATORY: Use this for every SQL query and every markdown block. Never write SQL in text. For SQL cells: cellType="query", complete SQL in "code". For prose/explanation: cellType="markdown", GitHub-flavored markdown in "markdown" (# headers, **bold**, bullet lists). For statistics/ML/text-processing/custom viz (only when Python is available — see Tool selection): cellType="python", Python source in "code", omit "language". Markdown outputNames: intro, overview, summary, insights, methodology, findings. SQL/Python outputNames: revenue_by_month, top_customers, order_funnel (snake_case).',
			parameters: {
				type: 'object',
				properties: {
					outputName: {
						type: 'string',
						description:
							'For markdown: short word (intro, summary, findings). For SQL/Python: snake_case description (revenue_by_month, top_customers).'
					},
					cellType: {
						type: 'string',
						enum: ['query', 'markdown', 'python'],
						description:
							'query for SQL, markdown for explanatory prose, python for stats/ML/text-processing (only if Python is available in this environment — see Tool selection section)'
					},
					code: {
						type: 'string',
						description:
							'Complete SQL or Python source for query/python cells. Omit for markdown cells.'
					},
					markdown: {
						type: 'string',
						description:
							'GFM markdown content for markdown cells. Use headers (# ## ###), **bold**, bullet lists, `code` spans. Embed live query refs with $outputName.field (e.g. $orders.count, $top_month.revenue) for simple values, or use Markdoc tags for KPI cards/charts/layout: {% metric value=$orders.revenue label="Revenue" vs=$prev.revenue /%}, {% chart type="bar" data=$orders.rows x="month" y="revenue" /%}, {% grid cols=3 %}...{% /grid %}, {% callout type="warning" %}...{% /callout %}. Values update automatically when cells re-run.'
					},
					language: { type: 'string', enum: ['sql'], description: 'Always "sql" for query cells.' },
					materializeMode: {
						type: 'string',
						enum: ['ephemeral', 'view', 'table', 'incremental'],
						description:
							'How to materialize this model. Set per workspace naming conventions: dim_→table, fct_→incremental, stg_→view, metric_→incremental. Omit for ephemeral ad-hoc queries.'
					}
				},
				required: ['outputName', 'cellType']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'pick_chart',
			description:
				'PREFERRED chart tool. Call after run_cells — reads actual result rows/columns and selects the best chart type, or falls back to table view when no numeric data is present. Always call pick_chart after run_cells; only fall back to set_chart when you need a specific type (e.g. area for cumulative, pie for proportions, scatter).',
			parameters: {
				type: 'object',
				properties: {
					cellId: {
						type: 'string',
						description:
							'The cell to chart. Use the same callId or outputName you used in run_cells.'
					}
				},
				required: ['cellId']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_chart',
			description:
				'Explicitly configure a chart when you need a specific type that pick_chart would not choose (e.g. area for cumulative revenue, pie for proportions, scatter with colorColumn). For all other cases, prefer pick_chart after run_cells. Use chartType "custom" with a `code` snippet for chart shapes none of the other types can express — code receives `rows`, `columns` and should return a Plotly figure object: `{ data: [...], layout: {...} }`; xColumn/yColumns can be left empty for "custom".',
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string' },
					chartConfig: {
						type: 'object',
						properties: {
							chartType: {
								type: 'string',
								enum: [
									'bar',
									'bar-horizontal',
									'line',
									'area',
									'scatter',
									'bubble',
									'pie',
									'histogram',
									'heatmap',
									'big-value',
									'value',
									'delta',
									'funnel',
									'box-plot',
									'calendar-heatmap',
									'sankey',
									'map',
									'choropleth',
									'custom'
								]
							},
							xColumn: {
								type: 'string',
								description: 'Dimension / date / category / value / location column'
							},
							yColumns: {
								type: 'array',
								items: { type: 'string' },
								description:
									'One or more measure columns. List all numeric measures for grouped/stacked charts.'
							},
							colorColumn: {
								type: 'string',
								description: 'Optional: split series by this column (grouped bars, scatter color)'
							},
							seriesMode: {
								type: 'string',
								enum: ['auto', 'grouped', 'stacked'],
								description: 'Use grouped or stacked when yColumns has multiple entries'
							},
							sortOrder: { type: 'string', enum: ['none', 'asc', 'desc'] },
							title: { type: 'string' },
							latColumn: {
								type: 'string',
								description: 'Latitude column for chartType "map"'
							},
							lonColumn: {
								type: 'string',
								description: 'Longitude column for chartType "map"'
							},
							geoScope: {
								type: 'string',
								enum: ['world', 'usa-states'],
								description: 'Choropleth scope: ISO-3 countries or US state codes'
							},
							code: {
								type: 'string',
								description:
									'Required when chartType is "custom": a JS Plotly figure spec, see description above.'
							}
						},
						required: ['chartType', 'xColumn', 'yColumns']
					}
				},
				required: ['cellId', 'chartConfig']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_cells',
			description: 'Execute cells. Call after creating/updating query cells.',
			parameters: {
				type: 'object',
				properties: {
					cellIds: { type: 'array', items: { type: 'string' } }
				},
				required: ['cellIds']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'update_cell',
			description:
				'Edit an existing cell. For SQL/Python cells, provide code. For markdown/dashboard cells, provide markdown. Use this instead of create_cell when revising an existing summary/dashboard cell.',
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string', description: 'Cell id or outputName to edit.' },
					outputName: { type: 'string', description: 'Optional new outputName.' },
					code: { type: 'string', description: 'Replacement SQL or Python source.' },
					markdown: {
						type: 'string',
						description:
							'Replacement GFM/Markdoc markdown for markdown dashboard or findings cells.'
					}
				},
				required: ['cellId']
			}
		}
	},
	...READONLY_INVESTIGATION_TOOLS,
	{
		type: 'function',
		function: {
			name: 'list_cells',
			description:
				'Lists query, python, and markdown/dashboard cells with status, row counts, and markdown previews. Use when you need a full inventory of existing notebook content.',
			parameters: { type: 'object', properties: {} }
		}
	},
	{
		type: 'function',
		function: {
			name: 'query_data',
			description:
				'Run a read-only SELECT against the active database. Use BEFORE writing SQL to verify column values, date formats, join keys, and value ranges. Never invent values — inspect them first.',
			parameters: {
				type: 'object',
				properties: {
					sql: {
						type: 'string',
						description: 'A read-only SELECT statement. No WITH clauses needed.'
					},
					limit: { type: 'number', description: 'Max rows to return (default 20, max 50).' }
				},
				required: ['sql']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'move_cell',
			description: 'Reorder a cell within the notebook.',
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string', description: 'Cell id or outputName to move.' },
					direction: {
						type: 'string',
						enum: ['up', 'down'],
						description: 'Move one step up or down.'
					},
					toIndex: { type: 'number', description: 'Move to exact 0-based index position.' }
				},
				required: ['cellId']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_view_mode',
			description:
				'Switch a result cell between table, chart, and stats views. Prefer pick_chart after run_cells when creating visualizations.',
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string', description: 'Cell id or outputName.' },
					mode: {
						type: 'string',
						enum: ['table', 'chart', 'stats'],
						description: 'Result view mode to show.'
					}
				},
				required: ['cellId', 'mode']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'record_decision',
			description:
				'Record a modeling decision OR a notable data discovery that should persist across turns and across future sessions (written to disk, not just this conversation). Call when you resolve something non-obvious: confirmed primary key, join key, grain choice, data quality issue fixed, business rule applied (type: "decision") — or when you notice an unexpected fact about the data: a surprising null rate, an unusual cardinality, a gotcha future queries should account for (type: "discovery"). Persisted entries are also retrievable later via search_workspace, so this is worth calling even for things that won\'t matter again this turn.',
			parameters: {
				type: 'object',
				properties: {
					decision: {
						type: 'string',
						description:
							'Concise statement of what was decided/discovered and why (e.g. "treating email as FK to customers — id not present in source").'
					},
					type: {
						type: 'string',
						enum: ['decision', 'discovery'],
						description: 'Defaults to "decision" when omitted.'
					}
				},
				required: ['decision']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'validate_result',
			description:
				"Assert that a cell's result meets expectations. Use after run_cells to verify correctness. Returns PASS or a list of FAIL messages.",
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string', description: 'Cell outputName or id to validate.' },
					assertNotEmpty: { type: 'boolean', description: 'Fail if result has 0 rows.' },
					expectedRowCount: { type: 'number', description: 'Exact expected row count.' },
					minRowCount: { type: 'number', description: 'Minimum acceptable row count.' },
					expectedColumns: {
						type: 'array',
						items: { type: 'string' },
						description: 'Column names that must be present in the result.'
					}
				},
				required: ['cellId']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'compare_cells',
			description:
				'Compare the row counts and column schemas of two cells. Useful for verifying a refactored cell produces the same output as the original.',
			parameters: {
				type: 'object',
				properties: {
					cellId1: { type: 'string', description: 'First cell outputName or id.' },
					cellId2: { type: 'string', description: 'Second cell outputName or id.' }
				},
				required: ['cellId1', 'cellId2']
			}
		}
	}
];
