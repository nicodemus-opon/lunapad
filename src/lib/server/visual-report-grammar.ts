import {
	CHART_TYPES,
	FILTER_KINDS,
	SUPPORTED_BLOCK_TYPES
} from '$lib/services/generated-dashboard.js';
import { DASHBOARD_ICON_NAMES } from '$lib/services/dashboard-icons.js';

const BLOCK_GROUPS = {
	structure: ['text', 'divider', 'columns', 'grid', 'toc'],
	emphasis: ['metric', 'badge', 'progress', 'callout', 'card'],
	dataViews: ['chart', 'datatable'],
	interaction: ['filter', 'tabs', 'details'],
	logic: ['conditional', 'each', 'group'],
	mediaAndExplanation: ['mermaid', 'math', 'video', 'embed', 'bookmark']
} as const;

const DATA_ROLES = [
	{
		name: 'headline_fact',
		useFor: 'One number or short result that carries the page argument.',
		blocks: ['metric', 'text', 'callout'],
		refPattern: '$outputName.field'
	},
	{
		name: 'ranked_list',
		useFor: 'Top/bottom items, ordered drivers, scoreboards, leaderboards, route/mode lists.',
		blocks: ['datatable', 'chart', 'grid', 'each'],
		refPattern: '$outputName.rows'
	},
	{
		name: 'part_to_whole',
		useFor: 'Shares, allocation, category mix, composition, budget/spend, market share.',
		blocks: ['chart', 'metric', 'progress'],
		chartTypes: ['pie', 'bar', 'bar-horizontal', 'treemap-via-custom']
	},
	{
		name: 'change_over_time',
		useFor: 'Forecasts, trend reports, timelines, before/after, cumulative progress.',
		blocks: ['chart', 'metric', 'datatable'],
		chartTypes: ['line', 'area', 'bar', 'sparkline', 'calendar-heatmap']
	},
	{
		name: 'distribution_or_outliers',
		useFor: 'Spread, variance, cohorts, anomalies, long tails, quality checks.',
		blocks: ['chart', 'datatable', 'callout'],
		chartTypes: ['histogram', 'box-plot', 'scatter', 'bubble', 'heatmap']
	},
	{
		name: 'flow_or_dependency',
		useFor: 'Funnels, handoffs, lineage, pipelines, journeys, causal chains.',
		blocks: ['chart', 'mermaid', 'columns', 'tabs'],
		chartTypes: ['funnel', 'sankey', 'custom']
	},
	{
		name: 'place_or_territory',
		useFor: 'Maps, regions, city programs, store territories, geopolitical or field reports.',
		blocks: ['chart', 'metric', 'datatable', 'columns'],
		chartTypes: ['map', 'choropleth']
	},
	{
		name: 'qualitative_context',
		useFor: 'Narrative interpretation, assumptions, caveats, source notes, methodology.',
		blocks: ['text', 'callout', 'details', 'tabs', 'bookmark', 'embed']
	}
] as const;

const COMPOSITION_PATTERNS = [
	{
		name: 'dense_single_page',
		useFor:
			'One-page infographic, board snapshot, public report, memo cover, factsheet, or poster.',
		blocks: ['text', 'divider', 'columns', 'grid', 'metric', 'chart', 'datatable', 'badge'],
		layoutMoves: [
			'Open with a title plus one or two supporting facts.',
			'Use columns with unequal widths when the page needs hierarchy.',
			'Mix large facts, small multiples, tables, and notes instead of repeating one card shape.',
			'Use whitespace and dividers to create reading lanes when density is high.'
		]
	},
	{
		name: 'scrolling_story',
		useFor:
			'Website-like report, narrated analysis, portfolio case study, launch recap, or explainer.',
		blocks: [
			'text',
			'columns',
			'metric',
			'chart',
			'callout',
			'tabs',
			'details',
			'embed',
			'bookmark'
		],
		layoutMoves: [
			'Sequence sections as claim, evidence, implication.',
			'Alternate text-led and data-led sections to avoid dashboard monotony.',
			'Use details/tabs for caveats and appendix material instead of overloading the main flow.'
		]
	},
	{
		name: 'operational_console',
		useFor: 'Live status, repeated monitoring, KPI review, SLA, finance, sales, or support ops.',
		blocks: ['filter', 'grid', 'metric', 'chart', 'datatable', 'progress', 'conditional'],
		layoutMoves: [
			'Put filters before dependent evidence.',
			'Use compact metric rows for scan speed and datatables for action lists.',
			'Reserve hero sizing for one true priority metric.'
		]
	},
	{
		name: 'comparison_matrix',
		useFor: 'Vendor comparison, market map, cohort contrast, options analysis, prioritization.',
		blocks: ['datatable', 'chart', 'grid', 'metric', 'badge', 'conditional'],
		layoutMoves: [
			'Use rows for comparable entities and columns for stable dimensions.',
			'Use conditionalFormats for intensity, rank, threshold, and direction.',
			'Pair the table with one summary chart or callout that states the decision.'
		]
	},
	{
		name: 'map_or_field_report',
		useFor:
			'Geographic, civic, logistics, retail, field operations, real-estate, or territory work.',
		blocks: ['chart', 'columns', 'metric', 'datatable', 'callout', 'mermaid'],
		layoutMoves: [
			'Anchor with map/choropleth when location is the organizing idea.',
			'Put local facts beside the map, not below a generic card grid.',
			'Use datatables for named places, incidents, projects, or stores.'
		]
	},
	{
		name: 'methodology_or_audit',
		useFor: 'Technical report, QA, data-quality review, model audit, notebook appendix.',
		blocks: ['text', 'datatable', 'details', 'tabs', 'math', 'mermaid', 'chart'],
		layoutMoves: [
			'Separate result, method, evidence, and caveats.',
			'Use details for reproducibility notes and tabs for alternate assumptions.',
			'Use tables for checks and exceptions rather than prose lists.'
		]
	}
] as const;

const STYLE_AXES = [
	{
		name: 'density',
		values: ['spacious', 'balanced', 'dense', 'poster_dense'],
		howToUse: 'Choose density from the intended reading context, not from the example image alone.'
	},
	{
		name: 'hierarchy',
		values: [
			'single_hero',
			'two_lead_columns',
			'small_multiples',
			'table_first',
			'narrative_first'
		],
		howToUse: 'Pick the structure that fits the argument. Do not always lead with metrics.'
	},
	{
		name: 'tone',
		values: ['editorial', 'operational', 'civic', 'technical', 'financial', 'playful', 'minimal'],
		howToUse:
			'Tone changes copy, density, and block choice; it should not collapse into a fixed color palette.'
	},
	{
		name: 'media_weight',
		values: ['data_only', 'light_context', 'mixed_media', 'embed_heavy'],
		howToUse:
			'Use media/embed/bookmark blocks when outside context matters; avoid decorative filler.'
	},
	{
		name: 'interactivity',
		values: ['static_printable', 'filterable', 'drilldown_tabs', 'progressive_disclosure'],
		howToUse: 'For agents, interactive controls should map to real data params or alternate views.'
	}
] as const;

const REFERENCE_DECONSTRUCTION = [
	'Extract intent first: decision, explanation, persuasion, monitoring, audit, story, or artifact.',
	'Identify data roles: headline facts, rankings, shares, trends, geography, flow, distribution, qualitative context.',
	'Identify the reading path: Z-pattern, two-column comparison, scroll narrative, map-led, table-led, or appendix-led.',
	'Map visual marks to supported blocks: typography to text, separators to divider, lanes to columns, small multiples to grid, icons to metric/iconCount, maps to chart, legends/ranked rows to datatable.',
	'Preserve the useful structure of a reference, not its literal subject, copy, numbers, or colors.',
	'If a reference contains unsupported bespoke illustration, approximate it with mermaid, custom chart, grouped metrics, or media/embed rather than pretending the block grammar can draw anything.'
] as const;

const BLUEPRINT_EXAMPLES = [
	{
		name: 'generic_stat_story',
		description:
			'A reusable claim/evidence/implication report seed. Works for finance, product, civic, research, or operations data.',
		blueprint: {
			title: 'Performance Story',
			executableCells: [
				{
					cellId: 'q_headline',
					outputName: 'headline',
					cellType: 'query',
					language: 'sql',
					connectionId: 'warehouse',
					code: 'select 128400 as primary_value, 0.18 as change_rate, 42 as affected_entities'
				},
				{
					cellId: 'q_drivers',
					outputName: 'drivers',
					cellType: 'query',
					language: 'sql',
					connectionId: 'warehouse',
					code: 'select * from report_drivers order by impact desc'
				}
			],
			blocks: [
				{
					type: 'text',
					content: '# Performance Story\\nA concise readout of what changed and why.'
				},
				{
					type: 'grid',
					cols: 3,
					items: [
						{
							type: 'metric',
							value: '$headline.primary_value',
							label: 'Primary value',
							size: 'hero'
						},
						{ type: 'metric', value: '$headline.change_rate', label: 'Change', format: 'percent' },
						{ type: 'metric', value: '$headline.affected_entities', label: 'Entities affected' }
					]
				},
				{
					type: 'columns',
					columns: [
						{
							width: 1.2,
							blocks: [
								{
									type: 'chart',
									chartType: 'bar-horizontal',
									data: '$drivers',
									x: 'impact',
									y: 'driver',
									title: 'Top drivers'
								}
							]
						},
						{
							width: 0.8,
							blocks: [
								{
									type: 'datatable',
									data: '$drivers',
									cols: ['driver', 'impact', 'owner'],
									limit: 8
								}
							]
						}
					]
				}
			]
		}
	},
	{
		name: 'generic_map_impact',
		description:
			'A geography-led seed for city, logistics, territory, field operations, retail, or public-impact reports.',
		blueprint: {
			title: 'Impact by Place',
			executableCells: [
				{
					cellId: 'q_places',
					outputName: 'places',
					cellType: 'query',
					language: 'sql',
					connectionId: 'warehouse',
					code: 'select * from place_metrics'
				},
				{
					cellId: 'q_place_summary',
					outputName: 'place_summary',
					cellType: 'query',
					language: 'sql',
					connectionId: 'warehouse',
					code: 'select count(*) as places, sum(value) as total_value from place_metrics'
				}
			],
			blocks: [
				{ type: 'text', content: '# Impact by Place' },
				{
					type: 'columns',
					columns: [
						{
							width: 1.4,
							blocks: [
								{
									type: 'chart',
									chartType: 'map',
									data: '$places',
									lat: 'lat',
									lon: 'lon',
									title: 'Locations'
								}
							]
						},
						{
							width: 0.8,
							blocks: [
								{ type: 'metric', value: '$place_summary.places', label: 'Places' },
								{
									type: 'metric',
									value: '$place_summary.total_value',
									label: 'Total value',
									icon: 'MapPin',
									iconCount: 12,
									iconTotal: 20
								},
								{
									type: 'datatable',
									data: '$places',
									cols: ['place', 'value', 'status'],
									limit: 10
								}
							]
						}
					]
				}
			]
		}
	},
	{
		name: 'generic_scroll_report',
		description:
			'A website-like analytical story seed with summary, evidence, interactive detail, and source context.',
		blueprint: {
			title: 'Analytical Report',
			executableCells: [
				{
					cellId: 'q_trend',
					outputName: 'trend',
					cellType: 'query',
					language: 'sql',
					connectionId: 'warehouse',
					code: 'select * from trend_metrics order by period'
				}
			],
			blocks: [
				{
					type: 'text',
					content: '# Analytical Report\\nWhat happened, what it means, and what to inspect next.'
				},
				{
					type: 'chart',
					chartType: 'line',
					data: '$trend',
					x: 'period',
					y: 'value',
					title: 'Trend'
				},
				{
					type: 'tabs',
					tabs: [
						{
							label: 'Evidence',
							blocks: [{ type: 'datatable', data: '$trend', limit: 12 }]
						},
						{
							label: 'Method',
							blocks: [
								{
									type: 'details',
									summary: 'Assumptions',
									blocks: [
										{
											type: 'text',
											content: 'Document filters, caveats, source freshness, and known gaps here.'
										}
									]
								}
							]
						}
					]
				}
			]
		}
	}
] as const;

export const VISUAL_REPORT_GRAMMAR = {
	purpose:
		'Describe a flexible visual composition language for agent-authored notebooks, reports, infographic-style pages, operational dashboards, and website-like analytical stories. The examples are seeds, not templates to imitate.',
	blockTypes: [...SUPPORTED_BLOCK_TYPES],
	blockGroups: BLOCK_GROUPS,
	chartTypes: [...CHART_TYPES],
	filterKinds: [...FILTER_KINDS],
	iconNames: DASHBOARD_ICON_NAMES,
	dataRoles: DATA_ROLES,
	compositionPatterns: COMPOSITION_PATTERNS,
	styleAxes: STYLE_AXES,
	referenceDeconstruction: REFERENCE_DECONSTRUCTION,
	blueprintExamples: BLUEPRINT_EXAMPLES,
	agentGuidance: [
		'Do not classify a new request as one of the examples. Decompose it into intent, data roles, reading path, density, hierarchy, tone, and interactivity.',
		'Start with discover_schema, then create executableCells for facts/charts/tables, then compose blocks around outputName refs.',
		'Use examples only as small syntax seeds. Rename outputs, reshape layouts, and choose blocks to fit the new report.',
		'Prefer columns for reading lanes, grid for small multiples, datatable for dense comparisons, tabs/details for secondary material, and filters only when they control real data.',
		'If a desired visual is not directly supported, approximate the communicative role with available blocks instead of forcing a fake match.',
		'Validate the result with validate_notebook and repair diagnostics before treating the report as complete.'
	]
} as const;
