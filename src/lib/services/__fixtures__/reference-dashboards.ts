import type { GeneratedDashboardDefinition } from '../generated-dashboard.js';

/**
 * Executable acceptance bar for the dashboard grammar's design range: four
 * GeneratedDashboardDefinitions that recreate the reference infographics the grammar
 * is expected to express (travel recap, ECO Milwaukee poster, hotel projection sheet,
 * GE "Middle Market by the Numbers") — theme tones only, existing block types only.
 * Compiled in generated-dashboard.test.ts; if a grammar change breaks any of these,
 * the design range has regressed.
 *
 * Cell outputNames referenced here are stubbed by the test (see REFERENCE_FIXTURE_CELLS).
 */

export const REFERENCE_FIXTURE_CELLS = [
	'trip_stats',
	'transport_counts',
	'continent_days',
	'spend_breakdown',
	'eco_stats',
	'stormwater',
	'hotel_forecast',
	'hotel_market',
	'hotel_metrics',
	'mm_jobs',
	'mm_industry',
	'mm_economy',
	'mm_champions'
] as const;

/** Travel recap — masthead, hero stat column beside an icon stat rail, pictogram,
 * continent bar + spend pie, accent hero total, serif caption. */
export const travelRecapDashboard: GeneratedDashboardDefinition = {
	blocks: [
		{
			type: 'text',
			content: '### around the world\n# Travels\n\n> by mr & mrs globetrot'
		},
		{ type: 'divider' },
		{
			type: 'columns',
			columns: [
				{
					blocks: [
						{ type: 'metric', value: '$trip_stats.friends', label: 'Best friends', size: 'hero' },
						{ type: 'metric', value: '$trip_stats.countries', label: 'Countries', size: 'hero' },
						{
							type: 'metric',
							value: '$trip_stats.miles',
							label: 'Miles',
							size: 'hero',
							accent: 'info'
						},
						{ type: 'metric', value: '$trip_stats.days', label: 'Days', size: 'hero' },
						{ type: 'metric', value: 2, label: 'suitcases', icon: 'Luggage', iconCount: 2 }
					]
				},
				{
					width: 2,
					blocks: [
						{ type: 'text', content: '## How we got around' },
						{
							type: 'grid',
							cols: 1,
							gap: 'compact',
							striped: true,
							items: [
								{
									type: 'metric',
									value: '$transport_counts.taxis',
									label: 'Taxis',
									layout: 'row',
									icon: 'Car'
								},
								{
									type: 'metric',
									value: '$transport_counts.buses',
									label: 'Buses',
									layout: 'row',
									icon: 'Bus'
								},
								{
									type: 'metric',
									value: '$transport_counts.airplanes',
									label: 'Airplanes',
									layout: 'row',
									icon: 'Plane'
								},
								{
									type: 'metric',
									value: '$transport_counts.boats',
									label: 'Boats',
									layout: 'row',
									icon: 'Ship'
								},
								{
									type: 'metric',
									value: '$transport_counts.trains',
									label: 'Trains',
									layout: 'row',
									icon: 'TrainFront'
								},
								{
									type: 'metric',
									value: '$transport_counts.bicycles',
									label: 'Bicycles',
									layout: 'row',
									icon: 'Bike'
								}
							]
						},
						{ type: 'text', content: '> …and too much walking.' }
					]
				}
			]
		},
		{ type: 'divider' },
		{
			type: 'columns',
			columns: [
				{
					blocks: [
						{ type: 'text', content: '## Time on each continent' },
						{
							type: 'chart',
							data: '$continent_days.rows',
							chartType: 'bar',
							x: 'continent',
							y: 'days',
							height: 200
						}
					]
				},
				{
					width: 2,
					blocks: [
						{ type: 'text', content: '## Where we spent money' },
						{
							type: 'chart',
							data: '$spend_breakdown.rows',
							chartType: 'pie',
							x: 'category',
							y: 'pct',
							height: 240
						}
					]
				}
			]
		},
		{
			type: 'metric',
			value: '$trip_stats.total_spend',
			label: 'Total spending',
			format: 'currency',
			size: 'hero',
			accent: 'warning'
		},
		{ type: 'text', content: '> just 4 days after our wedding — page 1 of 2' }
	]
};

/** ECO poster — masthead, hero counts with pictogram isotypes, icon'd program cards,
 * gauge-style custom chart stand-in via metric, eco icons throughout. */
export const ecoPosterDashboard: GeneratedDashboardDefinition = {
	blocks: [
		{
			type: 'text',
			content:
				'### eco in the media\n# Environmental Collaboration Office\n\nStrives to make the City of Milwaukee a world-class eco-city.'
		},
		{ type: 'divider' },
		{
			type: 'columns',
			columns: [
				{
					blocks: [
						{
							type: 'metric',
							value: '$eco_stats.homes_weatherized',
							label: 'Milwaukee homes weatherized',
							size: 'hero',
							accent: 'success'
						},
						{ type: 'text', content: '> equal to 110 square blocks.' }
					]
				},
				{
					blocks: [
						{ type: 'text', content: '## Home gr/own' },
						{
							type: 'metric',
							value: '$eco_stats.vacant_lots',
							label: 'vacant lots converted to parks, orchards & farms',
							icon: 'TreePine',
							iconCount: 55,
							accent: 'success'
						}
					]
				},
				{
					blocks: [
						{ type: 'text', content: '## Solar group buy' },
						{
							type: 'metric',
							value: '$eco_stats.solar_homes',
							label: 'home owners went solar',
							size: 'hero'
						}
					]
				}
			]
		},
		{ type: 'text', content: '## Stormwater management tools' },
		{
			type: 'grid',
			cols: 3,
			items: [
				{
					type: 'card',
					title: 'Mobile Solar Pump',
					icon: 'Droplets',
					blocks: [{ type: 'text', content: 'Solar-powered stormwater capture.' }]
				},
				{
					type: 'card',
					title: 'RainShed',
					icon: 'Droplets',
					blocks: [{ type: 'text', content: 'Collects rain for garden reuse.' }]
				},
				{
					type: 'card',
					title: 'BaseTern',
					icon: 'Droplets',
					blocks: [{ type: 'text', content: 'Basement rainwater harvesting.' }]
				}
			]
		},
		{
			type: 'columns',
			columns: [
				{
					width: 2,
					blocks: [
						{
							type: 'chart',
							data: '$stormwater.rows',
							chartType: 'bar',
							x: 'program',
							y: 'gallons',
							height: 220
						}
					]
				},
				{
					blocks: [
						{
							type: 'metric',
							value: '$eco_stats.ev_stations',
							label: 'EV charging stations installed',
							icon: 'Zap',
							iconCount: 4,
							accent: 'success'
						},
						{
							type: 'metric',
							value: '$eco_stats.clean_kwh',
							label: 'kWh of clean energy since 2012',
							format: 'compact',
							size: 'hero',
							accent: 'success'
						}
					]
				}
			]
		},
		{
			type: 'callout',
			variant: 'success',
			title: 'Better Buildings Challenge',
			icon: 'Leaf',
			blocks: [
				{
					type: 'text',
					content: '8 million sq ft of building space cut energy use by 20% — $eco_stats.sqft_pct.'
				}
			]
		}
	]
};

/** Hotel projection — hero forecast numbers over paired trend charts, compact metric
 * band, conditional-format performance table. */
export const hotelProjectionDashboard: GeneratedDashboardDefinition = {
	title: 'ITC Hotels Forecast Projection',
	blocks: [
		{ type: 'text', content: '### future projection indicators' },
		{
			type: 'metric',
			value: '$hotel_forecast.rooms',
			label: 'Lines projected',
			size: 'hero',
			accent: 'info'
		},
		{
			type: 'chart',
			data: '$hotel_forecast.rows',
			chartType: 'bar',
			x: 'year',
			yColumns: ['actual', 'projected'],
			seriesMode: 'grouped',
			height: 260
		},
		{ type: 'text', content: '## Growth trajectory' },
		{
			type: 'columns',
			columns: [
				{
					width: 2,
					blocks: [
						{
							type: 'chart',
							data: '$hotel_market.rows',
							chartType: 'area',
							x: 'year',
							y: 'value',
							height: 240
						}
					]
				},
				{
					blocks: [
						{
							type: 'metric',
							value: '$hotel_metrics.growth',
							label: 'Growth',
							format: 'percent',
							layout: 'row',
							icon: 'TrendingUp',
							accent: 'success'
						},
						{
							type: 'metric',
							value: '$hotel_metrics.share',
							label: 'Market share',
							format: 'percent',
							layout: 'row',
							icon: 'PieChart'
						},
						{
							type: 'metric',
							value: '$hotel_metrics.locations',
							label: 'Locations',
							layout: 'row',
							icon: 'Building2'
						}
					]
				}
			]
		},
		{ type: 'text', content: '## Performance settings' },
		{
			type: 'datatable',
			data: '$hotel_metrics.rows',
			cols: ['segment', 'change'],
			conditionalFormats: [
				{
					column: 'change',
					rules: [
						{ type: 'threshold', op: '>=', value: 0, tone: 'positive' },
						{ type: 'threshold', op: '<', value: 0, tone: 'negative' }
					]
				}
			]
		}
	]
};

/** GE Middle Market — masthead + intro, hero pair, diverging industry bars, pie trio,
 * champions grouped bars, dot-matrix waffle pictograms. */
export const middleMarketDashboard: GeneratedDashboardDefinition = {
	blocks: [
		{
			type: 'text',
			content:
				'# The Middle Market by the Numbers\n\nGE Capital and the Fisher College of Business partnered on the largest ever study of the U.S. Middle Market — businesses with revenues between $10 million and $1 billion.'
		},
		{ type: 'divider' },
		{ type: 'text', content: '## Surviving middle market businesses added jobs' },
		{
			type: 'columns',
			columns: [
				{
					blocks: [
						{
							type: 'metric',
							value: '$mm_jobs.mm_added',
							label: 'Jobs per middle market business',
							size: 'hero',
							accent: 'info'
						}
					]
				},
				{
					blocks: [
						{
							type: 'metric',
							value: '$mm_jobs.big_cut',
							label: 'Jobs cut per big business',
							size: 'hero',
							accent: 'error'
						}
					]
				}
			]
		},
		{ type: 'text', content: '## Mid-market survival by industry' },
		{
			type: 'chart',
			data: '$mm_industry.rows',
			chartType: 'bar-horizontal',
			x: 'industry',
			yColumns: ['mm_jobs', 'big_jobs'],
			seriesMode: 'grouped',
			height: 320
		},
		{ type: 'text', content: '## One third of the private-sector economy' },
		{
			type: 'columns',
			columns: [
				{
					blocks: [
						{
							type: 'chart',
							data: '$mm_economy.rows',
							chartType: 'pie',
							x: 'segment',
							y: 'small_pct',
							height: 180
						}
					]
				},
				{
					blocks: [
						{
							type: 'chart',
							data: '$mm_economy.rows',
							chartType: 'pie',
							x: 'segment',
							y: 'mid_pct',
							height: 180
						}
					]
				},
				{
					blocks: [
						{
							type: 'chart',
							data: '$mm_economy.rows',
							chartType: 'pie',
							x: 'segment',
							y: 'large_pct',
							height: 180
						}
					]
				}
			]
		},
		{ type: 'text', content: '## Growth champions' },
		{
			type: 'chart',
			data: '$mm_champions.rows',
			chartType: 'bar',
			x: 'trait',
			yColumns: ['champions_pct', 'rest_pct'],
			seriesMode: 'grouped',
			height: 260
		},
		{
			type: 'columns',
			columns: [
				{
					blocks: [
						{
							type: 'metric',
							value: 3,
							label: 'Nominal GDP grew at three percent (2005–2010)',
							icon: 'Building2',
							iconCount: 3,
							iconTotal: 10
						}
					]
				},
				{
					blocks: [
						{
							type: 'metric',
							value: 10,
							label: 'Growth champions grow at ten percent+',
							icon: 'Rocket',
							iconCount: 10,
							iconTotal: 10,
							accent: 'info'
						}
					]
				}
			]
		},
		{ type: 'text', content: '> Source: U.S. Census; Dun & Bradstreet; OSU/GE Analysis' }
	]
};

export const REFERENCE_DASHBOARDS = {
	travelRecap: travelRecapDashboard,
	ecoPoster: ecoPosterDashboard,
	hotelProjection: hotelProjectionDashboard,
	middleMarket: middleMarketDashboard
} as const;
