import { READONLY_INVESTIGATION_TOOLS } from '$lib/server/ai-tools.js';
import { SUPPORTED_BLOCK_TYPES } from '$lib/services/generated-dashboard.js';

// Native OpenAI-format tool definitions (kept minimal to reduce token count)
// Lookup tools run client-side; they inject results as text into the message thread.
const ALL_NATIVE_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'create_notebook',
			description:
				'Create a complete notebook atomically from a typed blueprint. Prefer this for user requests to create a whole notebook, report, or dashboard from scratch. The blueprint is compiled into a validated ProseMirror/Tiptap document before anything is committed, so recoverable rich-layout errors are returned for repair instead of becoming visible broken cells.',
			parameters: {
				type: 'object',
				properties: {
					blueprint: {
						type: 'object',
						properties: {
							title: { type: 'string' },
							executableCells: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										cellId: {
											type: 'string',
											description:
												'Stable id used by queryBlock nodes, e.g. q_monthly_revenue.'
										},
										outputName: {
											type: 'string',
											description:
												'SQL/Python output name, e.g. monthly_revenue.'
										},
										cellType: { type: 'string', enum: ['query', 'python', 'plot'] },
										language: { type: 'string', enum: ['sql', 'prql'] },
										code: { type: 'string' }
									},
									required: ['cellId', 'outputName', 'code']
								}
							},
							blocks: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										type: {
											type: 'string',
											enum: ['queryBlock', ...SUPPORTED_BLOCK_TYPES]
										}
									},
									required: ['type'],
									description:
										'Recursive notebook presentation blocks. Use queryBlock to place executable cells by cellId; use the dashboard block grammar for grid/columns/card/metric/chart/datatable/callout/tabs/filter/conditional/loop rich nodes.'
								}
							}
						},
						required: ['blocks']
					}
				},
				required: ['blueprint']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'inspect_notebook',
			description:
				'Inspect a notebook as a validated PM/Tiptap document plus executable query-node payloads. Use before editing an existing notebook — including one that is not currently open in the UI. Omit notebookId to inspect the active notebook; pass notebookId (from list_cells/search_workspace) to inspect any other notebook in the workspace, even a background/closed one.',
			parameters: {
				type: 'object',
				properties: {
					notebookId: {
						type: 'string',
						description:
							'Id of the notebook to inspect. Omit for the active notebook. Required to inspect a different, non-active notebook.'
					}
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'apply_notebook_patch',
			description:
				'Atomically patch an EXISTING notebook PM document — the active one, or any other notebook in the workspace by id (including one that is not currently open in the UI). Use this, not create_notebook, whenever the notebook you need to edit already exists — never create a second notebook just because the one you want to edit is not the active tab. Omit notebookId to patch the active notebook; pass notebookId (from list_cells/search_workspace/inspect_notebook) to patch a different, non-active notebook — the UI will switch to it. Provide either a full replacement document, a typed notebook blueprint, or node operations. Include executableCells when adding new queryBlock nodes. The result is validated before it is committed.',
			parameters: {
				type: 'object',
				properties: {
					notebookId: {
						type: 'string',
						description:
							'Id of the EXISTING notebook to patch. Omit to patch the active notebook. Set this to edit any other notebook by id, even one that is not currently open — do not call create_notebook instead.'
					},
					title: {
						type: 'string',
						description: 'Optional new display name/title for the notebook being patched.'
					},
					blueprint: { type: 'object' },
					document: { type: 'object' },
					operations: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								op: {
									type: 'string',
									enum: [
										'replace_document',
										'insert_node',
										'replace_node',
										'delete_node',
										'patch_attrs',
										'move_node'
									]
								},
								nodeId: { type: 'string' },
								parentNodeId: {
								type: 'string',
								description:
									'Node to insert/move into. OMIT this to target the document root — there is no literal "root" id.'
							},
								index: { type: 'number' },
								node: {
								type: 'object',
								description:
									'A raw PM node, e.g. {"type":"paragraph","content":[{"type":"text","text":"..."}]}. Containers (tabs/columns/grid/card/callout/details) are NOT their own node type — use {"type":"markdocContainer","attrs":{"tagName":"tabs","attrsJson":"{}"},"content":[...]}. Widgets (metric/chart/datatable/...) are {"type":"markdocWidget","attrs":{"tagName":"metric","attrsJson":"{...}","selfClosing":true}}. A thematic break is {"type":"horizontalRule"}. Prefer blueprint or document for anything beyond a single small edit — operations is for surgical one-node tweaks to an existing document.'
							},
								attrs: { type: 'object' },
								document: { type: 'object' }
							},
							required: ['op']
						}
					},
					executableCells: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								cellId: { type: 'string' },
								outputName: { type: 'string' },
								cellType: { type: 'string', enum: ['query', 'python', 'plot'] },
								language: { type: 'string', enum: ['sql', 'prql'] },
								code: { type: 'string' }
							},
							required: ['cellId', 'outputName', 'code']
						}
					}
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_query_nodes',
			description:
				'Run executable queryBlock nodes by PM nodeId or cellId. Use after create_notebook or apply_notebook_patch; do not call done until this succeeds.',
			parameters: {
				type: 'object',
				properties: {
					nodeIds: { type: 'array', items: { type: 'string' } },
					cellIds: { type: 'array', items: { type: 'string' } }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'validate_notebook',
			description:
				'Validate the full PM notebook document and live queryBlock references. Completion requires this to return ok:true.',
			parameters: {
				type: 'object',
				properties: {
					notebookId: {
						type: 'string',
						description:
							'Id of the notebook to validate. Omit for the active notebook; pass the id you just patched with apply_notebook_patch if it was not the active one.'
					},
					document: { type: 'object' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'create_cell',
			description:
				'MANDATORY: Use this for every SQL query and every markdown block. Never write SQL in text. For SQL cells: cellType="query", complete SQL in "code". For prose/explanation: cellType="markdown", GitHub-flavored markdown in "markdown" (# headers, **bold**, bullet lists). For statistics/ML/text-processing/custom viz (only when Python is available — see Tool selection): cellType="python", Python source in "code", omit "language". For a custom Plotly chart beyond what the {% chart %} block supports (dual/secondary axis, custom hover templates, box/violin, sankey, treemap, subplots) — prefer {% chart %} first: cellType="plot", Plotly figure JS in "code". Markdown outputNames: intro, overview, summary, insights, methodology, findings. SQL/Python outputNames: revenue_by_month, top_customers, order_funnel (snake_case).',
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
						enum: ['query', 'markdown', 'python', 'plot'],
						description:
							'query for SQL, markdown for explanatory prose, python for stats/ML/text-processing (only if Python is available in this environment — see Tool selection section), plot for a custom Plotly chart the declarative {% chart %} block cannot express'
					},
					code: {
						type: 'string',
						description:
							'Complete SQL or Python source for query/python cells. Omit for markdown cells. Python cells: data is injected, never loaded manually — upstream cells are pandas DataFrames by outputName; workspace tables are available through the built-in tables namespace (for example tables["schema.table"] or tables.load("catalog.schema.table")); pd/np are pre-imported; the last DataFrame expression becomes the result and is published under this cell\'s outputName for downstream SQL/Python use. Never read files or open DB connections in Python. Plot cells: JS that must `return { data: [...], layout: {...} }` (a Plotly figure), referencing upstream cells by outputName.rows/outputName.columns exactly like a query cell reads another cell\'s outputName. Never hardcode colors — use var(--chart-1) through var(--chart-5) only; never set paper_bgcolor/plot_bgcolor/font.color, the app themes those automatically.'
					},
					markdown: {
						type: 'string',
						description:
							'GFM markdown content for markdown cells. Use headers (# ## ###), **bold**, bullet lists, `code` spans. Embed live query refs with $outputName.field (e.g. $orders.count, $top_month.revenue) for simple values, or use Markdoc tags for KPI cards/charts/layout: {% metric value=$orders.revenue label="Revenue" vs=$prev.revenue /%}, {% chart type="bar" data=$orders.rows x="month" y="revenue" /%}, {% grid cols=3 %}...{% /grid %}, {% callout type="warning" %}...{% /callout %}. Values update automatically when cells re-run.'
					},
					dashboard: {
						type: 'object',
						description:
							'Preferred for AI-authored notebook/report/dashboard markdown. A typed block tree compiled server-side into canonical Markdoc. Use this instead of hand-writing markdown when composing rich notebook UI around existing SQL/Python result cells.',
						properties: {
							title: { type: 'string' },
							statusBadge: {
								type: 'object',
								properties: {
									value: { type: ['string', 'number'] },
									color: { type: 'string' }
								}
							},
							blocks: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										type: {
											type: 'string',
											enum: [...SUPPORTED_BLOCK_TYPES]
										}
									},
									required: ['type'],
									description:
										"One typed notebook block. Container blocks (grid.items, columns.columns[].blocks, card/callout/details/tabs/conditional block arrays) nest these same blocks recursively — follow the block grammar in the system prompt for each type's fields."
								}
							}
						}
					},
					language: { type: 'string', enum: ['sql'], description: 'Always "sql" for query cells.' },
					materializeMode: {
						type: 'string',
						enum: ['ephemeral', 'view', 'table', 'incremental'],
						description:
							'How to materialize this model. Set per workspace naming conventions: dim_→table, fct_→incremental, stg_→view, metric_→incremental. Omit for ephemeral ad-hoc queries.'
					},
					afterCellId: {
						type: 'string',
						description:
							'Insert the new cell immediately after this cell id/outputName instead of appending at the end of the notebook. Use this to place narrative markdown cells precisely when curating a report.'
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
					},
					dashboard: {
						type: 'object',
						description:
							'Preferred structured replacement for AI-authored notebook/report/dashboard markdown. Same {title, statusBadge, blocks} shape as create_cell.dashboard — see the block grammar in the system prompt. Compiled server-side into canonical Markdoc before the tool call reaches the client.'
					},
					hideInReport: {
						type: 'boolean',
						description:
							'Set true to hide this cell from Report view and published shares (e.g. staging/intermediate cells); false to surface it.'
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
	},
	{
		type: 'function',
		function: {
			name: 'ask_user',
			description:
				'Pause and ask the user a clarifying question when genuinely blocked by ambiguity you cannot resolve from the schema, data, or workspace conventions (e.g. which of two plausible join keys, whether to reuse an existing cell vs create a new one, an ambiguous business rule). Do NOT use this for anything you can resolve yourself by investigating data (sample_data/query_data/profile_column) or by making a reasonable, stated default choice. Overuse annoys the user — reserve for cases where a wrong guess would require redoing significant work.',
			parameters: {
				type: 'object',
				properties: {
					question: {
						type: 'string',
						description: 'The clarifying question to ask, phrased concisely (one sentence).'
					},
					options: {
						type: 'array',
						items: { type: 'string' },
						minItems: 2,
						maxItems: 4,
						description:
							'Optional 2-4 short quick-reply choices (e.g. ["customer_id", "email"]). Omit if the answer cannot be reduced to a few discrete choices — the user can always type free text instead.'
					}
				},
				required: ['question']
			}
		}
	}
];

const LEGACY_CELL_TOOLS = new Set(['create_cell', 'update_cell']);

export const NATIVE_TOOLS = ALL_NATIVE_TOOLS.filter(
	(tool) => !LEGACY_CELL_TOOLS.has(tool.function.name)
);
