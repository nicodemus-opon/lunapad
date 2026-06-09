import { describe, expect, it } from 'vitest';

import {
	getQuickChips,
	makeDefaultStage,
	makePresetStages,
	STAGE_PRESETS,
	recommendPresets,
	recommendStages,
	searchAnalysisPrompts,
	generatePromptStagePlan,
	generatePromptStagePlanFromSuggestion,
	searchFunctionActions,
	searchSemanticStageCombinations,
	searchPresets,
	searchStages
} from '$lib/services/stage-catalog';
import { guiToPreql } from '$lib/services/gui-prql';
import { compile as compileNodePrql, CompileOptions as NodeCompileOptions } from 'prqlc/dist/node/prqlc_js';
import type { GUIPipelineStage } from '$lib/types/gui-pipeline';

describe('stage-catalog', () => {
	it('creates typed default stages', () => {
		expect(makeDefaultStage('take')).toEqual({ type: 'take', n: 100 });
		expect(makeDefaultStage('join')).toEqual({ type: 'join', joinType: 'inner', table: '', conditions: [] });
		expect(makeDefaultStage('append')).toEqual({ type: 'append', sources: [] });
		expect(makeDefaultStage('window')).toEqual({ type: 'window', frame: 'rows:-2..0', sortKeys: [], derives: [] });
		expect(makeDefaultStage('loop')).toEqual({ type: 'loop', body: 'filter true' });
	});

	it('recommends from for empty pipelines', () => {
		const ranked = recommendStages({ stages: [], availableColumnCount: 0 });
		expect(ranked[0]?.type).toBe('from');
	});

	it('recommends transform stages after from', () => {
		const stages: GUIPipelineStage[] = [{ type: 'from', table: 'orders' }];
		const ranked = recommendStages({ stages, availableColumnCount: 8 });
		const top = ranked.slice(0, 3).map((s) => s.type);
		expect(top).toContain('filter');
		expect(top).toContain('select');
	});

	it('boosts recently used stages', () => {
		const stages: GUIPipelineStage[] = [{ type: 'from', table: 'orders' }];
		const ranked = recommendStages({
			stages,
			availableColumnCount: 10,
			recentUsage: { derive: 5 }
		});
		expect(ranked[0]?.type).toBe('derive');
	});

	it('searches labels and keywords', () => {
		expect(searchStages('agg').map((s) => s.type)).toContain('group');
		expect(searchStages('where').map((s) => s.type)).toContain('filter');
	});

	it('searches preset labels, descriptions, and keywords', () => {
		expect(searchPresets('variance').map((preset) => preset.id)).toContain('period-variance');
		expect(searchPresets('dedup').map((preset) => preset.id)).toContain('dedup-exact');
		expect(searchPresets('').length).toBe(STAGE_PRESETS.length);
	});

	it('searches PRQL function actions and hydrates derive stages', () => {
		const suggestions = searchFunctionActions({
			query: 'math.pow score',
			availableColumns: ['score', 'created_at']
		});

		expect(suggestions.length).toBeGreaterThan(0);
		const pow = suggestions.find((entry) => entry.id === 'math.pow');
		expect(pow).toBeDefined();
		expect(pow?.stage.type).toBe('derive');
		expect(pow?.stage.columns[0]?.expr.mode).toBe('func');
		if (pow?.stage.columns[0]?.expr.mode === 'func') {
			expect(pow.stage.columns[0].expr.func).toBe('math.pow');
			expect(pow.stage.columns[0].expr.args[1]?.value).toBe('score');
		}
	});

	it('fans out semantic stage combinations from typed stage names', () => {
		const groupSuggestions = searchSemanticStageCombinations({
			query: 'group',
			availableColumns: ['region', 'product', 'amount', 'created_at']
		});

		expect(groupSuggestions.length).toBeGreaterThan(0);
		expect(groupSuggestions.some((entry) => entry.stageType === 'group')).toBe(true);
		expect(groupSuggestions.some((entry) => entry.stage.type === 'group' && entry.stage.by.includes('region'))).toBe(true);

		const deriveSuggestions = searchSemanticStageCombinations({
			query: 'derive',
			availableColumns: ['Price (GHS)', 'Units Sold', 'Category']
		});

		expect(deriveSuggestions.some((entry) => entry.stageType === 'derive')).toBe(true);
		expect(deriveSuggestions.some((entry) => entry.stage.type === 'derive')).toBe(true);
	});

	it('surfaces query-style analysis prompts for wg-like schemas', () => {
		const prompts = searchAnalysisPrompts({
			query: 'revenue category trend',
			availableColumns: ['Item Name', 'Category', 'Price (GHS)', 'Units Sold', 'Date Sold']
		});

		expect(prompts.some((prompt) => /Revenue analysis/i.test(prompt.label))).toBe(true);
		expect(prompts.some((prompt) => /Revenue by Category/i.test(prompt.label))).toBe(true);
		expect(prompts.some((prompt) => /Daily revenue trend/i.test(prompt.label))).toBe(true);
		expect(prompts.some((prompt) => /Top contributors/i.test(prompt.label))).toBe(true);
	});

	it('surfaces column-focused analysis prompts when query matches a column name', () => {
		const prompts = searchAnalysisPrompts({
			query: 'units sold',
			availableColumns: ['Item Name', 'Category', 'Price (GHS)', 'Units Sold', 'Date Sold']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts.some((prompt) => /Units Sold/i.test(prompt.label) || /Units Sold/i.test(prompt.prompt))).toBe(true);
		expect(prompts[0]?.prompt.toLowerCase()).toContain('units sold');
	});

	it('handles multi-keyword natural language queries like group tenant name', () => {
		const prompts = searchAnalysisPrompts({
			query: 'please group tenant name and show top spend',
			availableColumns: ['Tenant Name', 'Monthly Spend', 'Lease Start Date', 'Building']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts[0]?.prompt.toLowerCase()).toContain('tenant');
		expect(prompts.some((prompt) => /group by tenant name/i.test(prompt.prompt))).toBe(true);
		expect(
			prompts.some(
				(prompt) => /tenant name/i.test(prompt.prompt) && prompt.stages.some((stage) => stage.type === 'group')
			)
		).toBe(true);
		expect(prompts.some((prompt) => prompt.stages.some((stage) => stage.type === 'take' || stage.type === 'sort'))).toBe(true);
	});

	it('builds a valid prompt generation plan with strict schema grounding', () => {
		const plan = generatePromptStagePlan({
			query: 'group tenant name and show top monthly spend',
			availableColumns: ['Tenant Name', 'Monthly Spend', 'Lease Start Date', 'Building']
		});

		expect(plan).toBeDefined();
		expect(plan?.validation.isValid).toBe(true);
		expect(plan?.validation.unknownColumns).toHaveLength(0);
		expect(plan?.stages.some((stage) => stage.type === 'group')).toBe(true);
		expect(plan?.validation.prql.length ?? 0).toBeGreaterThan(0);
	});

	it('validates externally inferred stage chains before apply', () => {
		const plan = generatePromptStagePlanFromSuggestion({
			query: 'city with least rent',
			availableColumns: ['city', 'rent_usd'],
			validateCompile: false,
			suggestion: {
				label: 'Least rent by city',
				prompt: 'Least rent by city: group by city, min rent, sort asc, take 1',
				reasons: ['LLM inferred least-intent ranking'],
				stages: [
					{ type: 'group', by: ['city'], aggregations: [{ name: 'min_rent_usd', func: 'min', column: 'rent_usd' }] },
					{ type: 'sort', keys: [{ column: 'min_rent_usd', dir: 'asc' }] },
					{ type: 'take', n: 1 }
				],
				confidence: 0.81
			}
		});

		expect(plan).toBeTruthy();
		expect(plan?.validation.unknownColumns).toEqual([]);
		expect(plan?.stages.some((stage) => stage.type === 'group')).toBe(true);
		expect(plan?.stages.some((stage) => stage.type === 'take')).toBe(true);
	});

	it('normalizes prompt suggestions so group stages never have empty aggregations', () => {
		const prompts = searchAnalysisPrompts({
			query: 'group customer_id and show top total',
			availableColumns: ['order_id', 'customer_id', 'region', 'product_category', 'unit_price', 'units', 'total']
		});

		expect(prompts.length).toBeGreaterThan(0);
		for (const prompt of prompts) {
			for (const stage of prompt.stages) {
				if (stage.type !== 'group') continue;
				const hasWindowBody = !!stage.window && (stage.window.sortKeys.length > 0 || stage.window.derives.length > 0);
				expect(stage.aggregations.length > 0 || hasWindowBody).toBe(true);
			}
		}
	});

	it('prioritizes explicit group+top prompts using requested dimension and metric', () => {
		const prompts = searchAnalysisPrompts({
			query: 'group customer_id and show top total',
			availableColumns: ['order_id', 'customer_id', 'region', 'product_category', 'unit_price', 'units', 'total']
		});

		expect(prompts.length).toBeGreaterThan(0);
		const top = prompts[0];
		expect(`${top?.label} ${top?.prompt}`.toLowerCase()).toContain('customer');
		expect(`${top?.label} ${top?.prompt}`.toLowerCase()).toContain('total');

		const groupStage = top?.stages.find((stage) => stage.type === 'group');
		expect(groupStage?.type).toBe('group');
		if (groupStage?.type === 'group') {
			expect(groupStage.by).toEqual(['customer_id']);
			expect(groupStage.aggregations.some((agg) => agg.column === 'total')).toBe(true);
		}
	});

	it('respects explicit top-N counts in group+top prompts', () => {
		const prompts = searchAnalysisPrompts({
			query: 'group region and show top 7 revenue',
			availableColumns: ['order_id', 'region', 'product_category', 'revenue', 'order_date']
		});

		expect(prompts.length).toBeGreaterThan(0);
		const top = prompts[0];
		const takeStage = top?.stages.find((stage) => stage.type === 'take');
		expect(takeStage?.type).toBe('take');
		if (takeStage?.type === 'take') {
			expect(takeStage.n).toBe(7);
		}
	});

	it('maps customer_id intent to customer_name when only customer_name exists', () => {
		const prompts = searchAnalysisPrompts({
			query: 'group customer_id and show top total',
			availableColumns: [
				'order_id',
				'order_date',
				'customer_name',
				'region',
				'channel',
				'product_category',
				'units',
				'unit_price',
				'discount_pct',
				'returned',
				'shipping_days'
			]
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('customer_name');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).not.toContain('order_id');
		expect(
			prompts.some((prompt) =>
				/derive unit_price \* units|sum_revenue|by revenue/i.test(`${prompt.label} ${prompt.prompt}`)
			)
		).toBe(true);
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('revenue');
	});

	it('maps fraud-rate queries to fraud outcome columns instead of unrelated numeric fields', () => {
		const prompts = searchAnalysisPrompts({
			query: 'fraud rate by payment method',
			availableColumns: ['txn_id', 'txn_time', 'account_type', 'country', 'payment_method', 'merchant_category', 'amount_usd', 'fx_rate', 'is_fraud', 'settlement_status']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('fraud');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('payment_method');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).not.toContain('fx_rate');
	});

	it('prioritizes filtered metric summaries for return-rate prompts with dimensions and time grain', () => {
		const prompts = searchAnalysisPrompts({
			query: 'monthly return rate by channel where region is west',
			availableColumns: ['order_id', 'order_date', 'channel', 'region', 'customer_name', 'product_category', 'units', 'discount_pct', 'shipping_days', 'returned']
		});

		expect(prompts.length).toBeGreaterThan(0);
		const topText = `${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase();
		expect(topText).toContain('returned');
		expect(topText).toContain('channel');
		expect(topText).toContain('region');
		expect(topText).not.toContain('count rows');
	});

	it('prioritizes filtered top-N metric prompts over raw take-stage fallbacks', () => {
		const prompts = searchAnalysisPrompts({
			query: 'top 5 customer_name by units where returned == true',
			availableColumns: ['order_id', 'order_date', 'customer_name', 'region', 'channel', 'product_category', 'units', 'unit_price', 'discount_pct', 'returned', 'shipping_days']
		});

		expect(prompts.length).toBeGreaterThan(0);
		const topText = `${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase();
		expect(topText).toContain('customer_name');
		expect(topText).toContain('units');
		expect(topText).toContain('returned');
		expect(topText).not.toContain('take stage');
	});

	it('prompt generation plan does not emit aggregate {} placeholders', () => {
		const plan = generatePromptStagePlan({
			query: 'group customer_id and show top total',
			availableColumns: ['order_id', 'customer_id', 'region', 'product_category', 'unit_price', 'units', 'total'],
			validateCompile: true
		});

		expect(plan).toBeDefined();
		expect(plan?.validation.prql.toLowerCase()).not.toContain('aggregate {}');
	});

	it('builds fallback prompt plans for unknown-but-similar schema references', () => {
		const plan = generatePromptStagePlan({
			query: 'group customer_id and show top total',
			availableColumns: [
				'order_id',
				'order_date',
				'customer_name',
				'region',
				'channel',
				'product_category',
				'units',
				'unit_price',
				'discount_pct',
				'returned',
				'shipping_days'
			],
			validateCompile: true
		});

		expect(plan).toBeDefined();
		expect(plan?.stages.some((stage) => stage.type === 'group')).toBe(true);
		expect(plan?.validation.prql.toLowerCase()).not.toContain('aggregate {}');
	});

	it('respects auto-apply threshold for prompt generation', () => {
		const plan = generatePromptStagePlan({
			query: 'group tenant name and show top monthly spend',
			availableColumns: ['Tenant Name', 'Monthly Spend', 'Lease Start Date', 'Building'],
			autoApplyThreshold: 0.99
		});

		expect(plan).toBeDefined();
		expect(plan?.autoApply).toBe(false);
		expect(plan?.confidence ?? 0).toBeLessThan(0.99);
	});

	it('prioritizes explicit where-clause intents with a filter-first prompt', () => {
		const prompts = searchAnalysisPrompts({
			query: 'product category where channel is web',
			availableColumns: ['product_category', 'channel', 'discount_pct', 'order_date']
		});

		expect(prompts.length).toBeGreaterThan(0);
		const top = prompts[0];
		expect(`${top?.label} ${top?.prompt}`.toLowerCase()).toContain('channel');
		expect(`${top?.label} ${top?.prompt}`.toLowerCase()).toContain('web');
		expect(top?.stages.some((stage) => stage.type === 'filter')).toBe(true);

		const topFilter = top?.stages.find((stage) => stage.type === 'filter');
		if (topFilter?.type === 'filter') {
			expect(topFilter.conditions[0]?.column.toLowerCase()).toContain('channel');
			expect(topFilter.conditions[0]?.value.toLowerCase()).toContain('web');
		}
	});

	it('does not treat id-like columns as business metrics in industry mrr searches', () => {
		const prompts = searchAnalysisPrompts({
			query: 'industry mrr',
			availableColumns: ['industry', 'mrr_usd', 'account_id', 'signup_date']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts.some((prompt) => /mrr|mrr usd/i.test(prompt.label) && /industry/i.test(prompt.prompt))).toBe(true);
		expect(prompts.some((prompt) => /account id by industry/i.test(prompt.label))).toBe(false);
		expect(prompts.some((prompt) => /aggregate account_id by industry/i.test(prompt.prompt))).toBe(false);
	});

	it('prioritizes mrr-by-industry prompts for industry mrr natural-language input', () => {
		const prompts = searchAnalysisPrompts({
			query: 'industry mrr',
			availableColumns: ['industry', 'mrr_usd', 'churn_risk_score', 'signup_date']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts[0]?.prompt.toLowerCase()).toContain('mrr_usd');
		expect(prompts[0]?.prompt.toLowerCase()).toContain('industry');
		expect(prompts[0]?.prompt.toLowerCase()).not.toContain('count rows per industry');
	});

	it('matches multi-word metric phrases as a single signal', () => {
		const prompts = searchAnalysisPrompts({
			query: 'group industry by churn risk score',
			availableColumns: ['industry', 'churn_risk_score', 'mrr_usd', 'signup_date']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts.some((prompt) => /churn risk score by industry/i.test(prompt.label))).toBe(true);
	});

	it('returns a diverse top set for broad analytical natural-language queries', () => {
		const prompts = searchAnalysisPrompts({
			query: 'industry mrr trend compare outlier top',
			availableColumns: ['industry', 'mrr_usd', 'churn_risk_score', 'signup_date']
		});

		const categories = new Set(
			prompts.slice(0, 5).map((prompt) => {
				const text = `${prompt.label} ${prompt.prompt}`.toLowerCase();
				if (/outlier|anomaly|iqr/.test(text)) return 'outlier';
				if (/correlation|compare|versus/.test(text)) return 'compare';
				if (/trend|time|daily|temporal/.test(text)) return 'trend';
				if (/top|rank|contributors/.test(text)) return 'rank';
				if (/group by|value counts|aggregate .* by/.test(text)) return 'group';
				return 'other';
			})
		);

		expect(categories.size).toBeGreaterThanOrEqual(3);
	});

	it('does not bypass LLM when query references a dimension that does not match any column', () => {
		// "sales by industry and month" — "industry" has no matching column in this schema
		// so the fast planner should not claim >96% confidence and bypass the LLM
		const plan = generatePromptStagePlan({
			query: 'sales by industry and month',
			availableColumns: ['mrr_usd', 'signup_date', 'plan', 'is_active'],
			autoApplyThreshold: 0.96,
			validateCompile: false
		});

		// Plan may exist but confidence must be below 0.96 so the LLM bypass doesn't trigger
		if (plan) {
			expect(plan.confidence).toBeLessThan(0.96);
		}
	});

	it('generates a 2D temporal+dimension prompt when query has "by <dimension> and <month>" pattern', () => {
		// "sales by plan and month" — "plan" IS a column, so we should get a grouped prompt
		const prompts = searchAnalysisPrompts({
			query: 'sales by plan and month',
			availableColumns: ['mrr_usd', 'signup_date', 'plan', 'is_active']
		});

		expect(prompts.length).toBeGreaterThan(0);
		const twoDimensional = prompts.find((p) =>
			/by plan/i.test(p.prompt) && /monthly|month/i.test(p.prompt)
		);
		expect(twoDimensional).toBeDefined();
	});

	it('prioritizes dual-dimension count analysis for categorical queries like priority issue type', () => {
		const prompts = searchAnalysisPrompts({
			query: 'priority issue type',
			availableColumns: ['ticket_id', 'created_at', 'priority', 'issue_type', 'customer_segment', 'csat_score', 'first_response_minutes']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts[0]?.prompt.toLowerCase()).toContain('priority');
		expect(prompts[0]?.prompt.toLowerCase()).toContain('issue_type');
		expect(prompts[0]?.prompt.toLowerCase()).toContain('count rows');
		expect(prompts[0]?.prompt.toLowerCase()).not.toContain('csat_score');
	});

	it('treats measure-like columns as metrics in mixed queries like temperature region', () => {
		const prompts = searchAnalysisPrompts({
			query: 'temperature region',
			availableColumns: ['recorded_at', 'region', 'temperature_c', 'humidity_pct', 'air_quality_index']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts[0]?.prompt.toLowerCase()).toContain('temperature_c');
		expect(prompts[0]?.prompt.toLowerCase()).toContain('region');
		expect(prompts[0]?.prompt.toLowerCase()).toContain('avg temperature_c by region');
		expect(prompts[0]?.prompt.toLowerCase()).not.toContain('count rows by region and temperature_c');
	});

	it('uses average aggregation for continuous measure-like columns', () => {
		const prompts = searchAnalysisPrompts({
			query: 'temperature region',
			availableColumns: ['recorded_at', 'region', 'temperature_c', 'humidity_pct']
		});

		expect(prompts.some((prompt) => /avg temperature_c by region/i.test(prompt.prompt))).toBe(true);
	});

	it('keeps correlation checks numeric-only even when query includes categorical columns', () => {
		const prompts = searchAnalysisPrompts({
			query: 'temperature region compare',
			availableColumns: ['recorded_at', 'region', 'temperature_c', 'humidity_pct', 'air_quality_index']
		});

		const correlation = prompts.find((prompt) => /Correlation check/i.test(prompt.label));
		expect(correlation).toBeDefined();
		expect(correlation?.prompt.toLowerCase()).not.toContain('region');
		expect(correlation?.prompt.toLowerCase()).toMatch(/temperature_c|humidity_pct|air_quality_index/);
	});

	it('handles temporal-pair queries generically without overfitting to specific names', () => {
		const prompts = searchAnalysisPrompts({
			query: 'scraped_at application_deadline',
			availableColumns: ['scraped_at', 'application_deadline', 'job_title', 'company']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts[0]?.prompt.toLowerCase()).toContain('scraped_at');
		expect(prompts[0]?.prompt.toLowerCase()).toContain('application_deadline');
		expect(prompts[0]?.prompt.toLowerCase()).toMatch(/temporal relation|compare|lag|gap/);
	});

	it('computes average day gaps for temporal-pair prompts', () => {
		const prompts = searchAnalysisPrompts({
			query: 'scraped_at application_deadline',
			availableColumns: ['scraped_at', 'application_deadline', 'job_title', 'company'],
			availableColumnProfiles: {
				scraped_at: { dataKind: 'date', semanticType: 'updated_at' },
				application_deadline: { dataKind: 'date', semanticType: 'deadline' }
			}
		});

		const temporalPairPrompt = prompts.find((prompt) =>
			/average days between scraped_at and application_deadline/i.test(prompt.prompt)
		);
		expect(temporalPairPrompt).toBeDefined();
		expect(temporalPairPrompt?.stages[0]).toMatchObject({
			type: 'derive',
			columns: [
				{
					name: 'days_between_application_deadline_and_scraped_at',
					expr: {
						mode: 'sstring'
					}
				}
			]
		});
		expect(temporalPairPrompt?.stages[1]).toMatchObject({
			type: 'group',
			by: [],
			aggregations: [
				{
					name: 'avg_days_between_application_deadline_and_scraped_at',
					func: 'avg',
					column: 'days_between_application_deadline_and_scraped_at'
				}
			]
		});
	});

	it('synthesizes measure+dimension intent from any top matched pair', () => {
		const prompts = searchAnalysisPrompts({
			query: 'humidity region',
			availableColumns: ['region', 'humidity_pct', 'temperature_c', 'recorded_at']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts[0]?.prompt.toLowerCase()).toContain('humidity_pct');
		expect(prompts[0]?.prompt.toLowerCase()).toContain('region');
		expect(prompts[0]?.prompt.toLowerCase()).toMatch(/avg humidity_pct by region|sum humidity_pct by region/);
	});

	it('supports more-than-two matched columns by surfacing pair analyses that include the third column', () => {
		const prompts = searchAnalysisPrompts({
			query: 'scraped_at application_deadline posted_at',
			availableColumns: ['scraped_at', 'application_deadline', 'posted_at', 'job_title', 'company']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts.some((prompt) => /temporal relation|compare/i.test(prompt.prompt))).toBe(true);
		expect(prompts.some((prompt) => prompt.prompt.toLowerCase().includes('posted_at'))).toBe(true);
		expect(prompts.some((prompt) => prompt.prompt.toLowerCase().includes('application_deadline'))).toBe(true);
	});

	it('locks mixed four-column behavior across metric and dimension semantics', () => {
		const prompts = searchAnalysisPrompts({
			query: 'revenue cost region segment',
			availableColumns: ['region', 'segment', 'revenue_usd', 'cost_usd', 'created_at']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(
			prompts.some((prompt) => /avg revenue_usd by region|sum revenue_usd by region|avg cost_usd by region|sum cost_usd by region/i.test(prompt.prompt))
		).toBe(true);
		expect(
			prompts.some((prompt) => /avg revenue_usd by segment|sum revenue_usd by segment|avg cost_usd by segment|sum cost_usd by segment/i.test(prompt.prompt))
		).toBe(true);
		expect(
			prompts.some((prompt) => /correlation check: compare revenue_usd and cost_usd/i.test(prompt.prompt))
		).toBe(true);
		expect(
			prompts.some((prompt) => /revenue_usd|cost_usd/i.test(prompt.prompt) && /region|segment/i.test(prompt.prompt))
		).toBe(true);
	});

	it('prioritizes temporal-granularity trend prompts for metric by month queries', () => {
		const prompts = searchAnalysisPrompts({
			query: 'unit sold by month',
			availableColumns: ['units_sold', 'date_sold', 'price_ghs', 'category']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts[0]?.label.toLowerCase()).toContain('trend');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('monthly');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('units_sold');
	});

	it('maps returns intent to returned-like outcome columns', () => {
		const prompts = searchAnalysisPrompts({
			query: 'returns by channel',
			availableColumns: ['order_id', 'order_date', 'channel', 'returned', 'discount_pct', 'units']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('returned');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('channel');
	});

	it('maps delivery intent to delivered-on-time outcome columns for monthly queries', () => {
		const prompts = searchAnalysisPrompts({
			query: 'on-time delivery by month',
			availableColumns: ['shipment_id', 'ship_date', 'mode', 'delivered_on_time', 'weight_kg']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('trend');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('monthly');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('delivered_on_time');
	});

	it('maps attendance intent to present-like outcome columns for monthly queries', () => {
		const prompts = searchAnalysisPrompts({
			query: 'attendance by month',
			availableColumns: ['student_id', 'attendance_date', 'present', 'grade', 'math_score']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('trend');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('present');
	});

	it('maps resolution intent to resolution metrics for monthly queries', () => {
		const prompts = searchAnalysisPrompts({
			query: 'resolution hours by month',
			availableColumns: ['ticket_id', 'created_at', 'priority', 'resolution_hours', 'first_response_minutes']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('resolution_hours');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('monthly');
	});

	it('handles plain-language superlative prompts like cheapest rent by city', () => {
		const prompts = searchAnalysisPrompts({
			query: 'which city has the cheapest rent',
			availableColumns: ['lease_id', 'start_date', 'city', 'rent_usd', 'occupied']
		});

		expect(prompts.length).toBeGreaterThan(0);
		const top = `${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase();
		expect(top).toContain('city');
		expect(top).toContain('rent');
		expect(prompts[0]?.stages.some((stage) => stage.type === 'group')).toBe(true);
	});

	it('handles plain-language trend prompts like slower ticket resolution over time', () => {
		const prompts = searchAnalysisPrompts({
			query: 'are tickets getting slower to resolve over time',
			availableColumns: ['ticket_id', 'created_at', 'priority', 'resolution_hours', 'csat_score']
		});

		expect(prompts.length).toBeGreaterThan(0);
		const top = `${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase();
		expect(top).toContain('trend');
		expect(top).toMatch(/resolution|response|minutes/);
	});

	it('handles plain-language outlier prompts like weird spikes in shipping days', () => {
		const prompts = searchAnalysisPrompts({
			query: 'show me weird spikes in shipping days',
			availableColumns: ['order_id', 'order_date', 'channel', 'shipping_days', 'discount_pct']
		});

		expect(prompts.length).toBeGreaterThan(0);
		const top = `${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase();
		expect(top).toMatch(/outlier|anomaly|shipping_days/);
	});

	it('treats lease-count monthly queries as temporal activity trends', () => {
		const prompts = searchAnalysisPrompts({
			query: 'leases by month',
			availableColumns: ['lease_id', 'start_date', 'end_date', 'city', 'rent_usd', 'occupied']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('trend');
		expect(`${prompts[0]?.label} ${prompts[0]?.prompt}`.toLowerCase()).toContain('count rows');
	});

	it('supports synonyms and typo-tolerant matching in analysis search', () => {
		const prompts = searchAnalysisPrompts({
			query: 'brakdown industy rev',
			availableColumns: ['industry', 'mrr_usd', 'arr_usd', 'signup_date']
		});

		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts.some((prompt) => /industry/i.test(prompt.prompt))).toBe(true);
		expect(prompts.some((prompt) => /mrr_usd|arr_usd|revenue/i.test(prompt.prompt))).toBe(true);
	});

	it('exposes confidence metadata for prompt ranking', () => {
		const prompts = searchAnalysisPrompts({
			query: 'industry mrr trend',
			availableColumns: ['industry', 'mrr_usd', 'signup_date']
		});

		expect(prompts[0]).toBeDefined();
		expect(typeof prompts[0]?.confidence).toBe('number');
		expect(prompts[0]?.confidence).toBeGreaterThan(0);
		expect(prompts[0]?.confidence).toBeLessThanOrEqual(1);
	});

	it('table-driven quality checks for common natural-language patterns', () => {
		const matrix: Array<{
			query: string;
			columns: string[];
			expectTopContains: string[];
		}> = [
			{
				query: 'industry mrr',
				columns: ['industry', 'mrr_usd', 'signup_date'],
				expectTopContains: ['industry', 'mrr_usd']
			},
			{
				query: 'priority issue type',
				columns: ['priority', 'issue_type', 'csat_score', 'created_at'],
				expectTopContains: ['priority', 'issue_type']
			},
			{
				query: 'trend signup date mrr',
				columns: ['industry', 'mrr_usd', 'signup_date'],
				expectTopContains: ['signup_date', 'mrr_usd']
			},
			{
				query: 'compare churn risk score and mrr',
				columns: ['churn_risk_score', 'mrr_usd', 'industry', 'signup_date'],
				expectTopContains: ['churn_risk_score']
			},
			{
				query: 'top tenant by spend',
				columns: ['tenant_name', 'monthly_spend', 'created_at'],
				expectTopContains: ['tenant_name']
			}
		];

		for (const scenario of matrix) {
			const prompts = searchAnalysisPrompts({
				query: scenario.query,
				availableColumns: scenario.columns
			});
			const topPrompt = prompts[0]?.prompt.toLowerCase() ?? '';
			const top3Text = prompts.slice(0, 3).map((prompt) => `${prompt.label} ${prompt.prompt}`.toLowerCase()).join(' | ');
			expect(topPrompt.length).toBeGreaterThan(0);
			for (const token of scenario.expectTopContains) {
				expect(top3Text).toContain(token.toLowerCase());
			}
		}
	});

	it('benchmark output: ranking quality over representative scenarios', () => {
		const scenarios: Array<{
			query: string;
			columns: string[];
			top1MustContain: string[];
			top3MustContain: string[];
		}> = [
			{ query: 'industry mrr', columns: ['industry', 'mrr_usd', 'signup_date'], top1MustContain: ['industry'], top3MustContain: ['mrr_usd'] },
			{ query: 'priority issue type', columns: ['priority', 'issue_type', 'csat_score', 'created_at'], top1MustContain: ['priority'], top3MustContain: ['issue_type'] },
			{ query: 'trend by signup date', columns: ['industry', 'mrr_usd', 'signup_date'], top1MustContain: ['signup_date'], top3MustContain: ['signup_date'] },
			{ query: 'outliers in mrr', columns: ['industry', 'mrr_usd', 'signup_date'], top1MustContain: ['mrr_usd'], top3MustContain: ['mrr_usd'] },
			{ query: 'compare mrr and churn risk score', columns: ['industry', 'mrr_usd', 'churn_risk_score', 'signup_date'], top1MustContain: ['mrr_usd'], top3MustContain: ['churn_risk_score'] },
			{ query: 'top tenant by spend', columns: ['tenant_name', 'monthly_spend', 'created_at'], top1MustContain: ['tenant_name'], top3MustContain: ['monthly_spend'] },
			{ query: 'group region and product', columns: ['region', 'product', 'revenue', 'created_at'], top1MustContain: ['region'], top3MustContain: ['product'] },
			{ query: 'revenue by category trend', columns: ['category', 'price', 'units_sold', 'sold_date'], top1MustContain: ['category'], top3MustContain: ['revenue'] }
		];

		let top1Hits = 0;
		let top3Hits = 0;
		let duplicateCount = 0;
		let totalTopFive = 0;
		let metricIntentTopFive = 0;

		for (const scenario of scenarios) {
			const prompts = searchAnalysisPrompts({ query: scenario.query, availableColumns: scenario.columns, limit: 8 });
			const top1 = prompts[0]?.prompt.toLowerCase() ?? '';
			const top3 = prompts.slice(0, 3).map((prompt) => `${prompt.label} ${prompt.prompt}`.toLowerCase());
			const top5 = prompts.slice(0, 5);

			if (scenario.top1MustContain.every((token) => top1.includes(token.toLowerCase()))) top1Hits += 1;
			if (scenario.top3MustContain.every((token) => top3.some((entry) => entry.includes(token.toLowerCase())))) top3Hits += 1;

			const ids = new Set<string>();
			for (const prompt of top5) {
				if (ids.has(prompt.id)) duplicateCount += 1;
				ids.add(prompt.id);
				const isMetricPrompt = /aggregate .* by|sum_|mrr|revenue|score|amount|price|spend/i.test(`${prompt.label} ${prompt.prompt}`);
				if (isMetricPrompt) metricIntentTopFive += 1;
			}
			totalTopFive += top5.length;
		}

		const scenarioCount = scenarios.length;
		const top1Rate = top1Hits / scenarioCount;
		const top3Rate = top3Hits / scenarioCount;
		const duplicateRate = totalTopFive === 0 ? 0 : duplicateCount / totalTopFive;
		const metricShare = totalTopFive === 0 ? 0 : metricIntentTopFive / totalTopFive;

		console.info(`[analysis-benchmark] scenarios=${scenarioCount} top1=${top1Rate.toFixed(2)} top3=${top3Rate.toFixed(2)} duplicate=${duplicateRate.toFixed(2)} metricShare=${metricShare.toFixed(2)}`);

		expect(top1Rate).toBeGreaterThanOrEqual(0.75);
		expect(top3Rate).toBeGreaterThanOrEqual(0.875);
		expect(duplicateRate).toBeLessThan(0.05);
		expect(metricShare).toBeGreaterThanOrEqual(0.45);
	});

	it('adversarial matrix report: identifies underperforming query families', () => {
		type AdversarialScenario = {
			family: string;
			query: string;
			columns: string[];
			top1MustContain?: string[];
			top3MustContain?: string[];
		};

		const scenarios: AdversarialScenario[] = [
			{ family: 'dimension+metric', query: 'industry mrr', columns: ['industry', 'mrr_usd', 'signup_date'], top1MustContain: ['industry'], top3MustContain: ['mrr_usd'] },
			{ family: 'dimension+metric', query: 'region revenue', columns: ['region', 'revenue', 'created_at'], top1MustContain: ['region'], top3MustContain: ['revenue'] },
			{ family: 'dimension+metric', query: 'plan arr', columns: ['plan', 'arr_usd', 'recorded_at'], top1MustContain: ['plan'], top3MustContain: ['arr_usd'] },
			{ family: 'dimension+metric', query: 'channel sales', columns: ['channel', 'sales_amount', 'order_date'], top1MustContain: ['channel'], top3MustContain: ['sales_amount'] },
			{ family: 'dimension+metric', query: 'merchant payment volume', columns: ['merchant', 'payment_volume', 'transaction_date'], top1MustContain: ['merchant'], top3MustContain: ['payment_volume'] },

			{ family: 'dual-categorical', query: 'priority issue type', columns: ['priority', 'issue_type', 'created_at', 'csat_score'], top1MustContain: ['priority'], top3MustContain: ['issue_type'] },
			{ family: 'dual-categorical', query: 'region product', columns: ['region', 'product', 'revenue', 'created_at'], top1MustContain: ['region'], top3MustContain: ['product'] },
			{ family: 'dual-categorical', query: 'carrier route', columns: ['carrier', 'route_type', 'delay_minutes', 'event_time'], top1MustContain: ['carrier'], top3MustContain: ['route_type'] },
			{ family: 'dual-categorical', query: 'department diagnosis', columns: ['department', 'diagnosis', 'cost', 'visit_date'], top1MustContain: ['department'], top3MustContain: ['diagnosis'] },
			{ family: 'dual-categorical', query: 'plan region breakdown', columns: ['plan', 'region', 'mrr_usd', 'signup_date'], top1MustContain: ['plan'], top3MustContain: ['region'] },

			{ family: 'trend-intent', query: 'trend by signup date mrr', columns: ['industry', 'mrr_usd', 'signup_date'], top1MustContain: ['signup_date'], top3MustContain: ['mrr_usd'] },
			{ family: 'trend-intent', query: 'monthly revenue trend', columns: ['region', 'revenue', 'order_date'], top1MustContain: ['order_date'], top3MustContain: ['revenue'] },
			{ family: 'trend-intent', query: 'temperature trend by recorded at', columns: ['region', 'temperature_c', 'recorded_at', 'humidity_pct'], top1MustContain: ['recorded_at'], top3MustContain: ['temperature_c'] },
			{ family: 'trend-intent', query: 'time series latency', columns: ['service', 'latency_ms', 'timestamp'], top1MustContain: ['timestamp'], top3MustContain: ['latency_ms'] },
			{ family: 'trend-intent', query: 'arr timeline', columns: ['segment', 'arr_usd', 'report_date'], top1MustContain: ['report_date'], top3MustContain: ['arr_usd'] },

			{ family: 'compare-intent', query: 'compare mrr and churn risk score', columns: ['mrr_usd', 'churn_risk_score', 'industry', 'signup_date'], top1MustContain: ['mrr_usd'], top3MustContain: ['churn_risk_score'] },
			{ family: 'compare-intent', query: 'vs revenue and cost', columns: ['revenue', 'cost', 'category', 'date'], top1MustContain: ['revenue'], top3MustContain: ['cost'] },
			{ family: 'compare-intent', query: 'correlation temperature humidity', columns: ['temperature_c', 'humidity_pct', 'region', 'recorded_at'], top1MustContain: ['temperature_c'], top3MustContain: ['humidity_pct'] },
			{ family: 'compare-intent', query: 'compare delay and cancellations', columns: ['delay_minutes', 'cancellations', 'carrier', 'flight_date'], top1MustContain: ['delay_minutes'], top3MustContain: ['cancellations'] },
			{ family: 'compare-intent', query: 'compare response time and csat', columns: ['first_response_minutes', 'csat_score', 'priority', 'created_at'], top1MustContain: ['first_response_minutes'], top3MustContain: ['csat_score'] },

			{ family: 'outlier-intent', query: 'outliers in mrr', columns: ['industry', 'mrr_usd', 'signup_date'], top1MustContain: ['mrr_usd'], top3MustContain: ['mrr_usd'] },
			{ family: 'outlier-intent', query: 'anomaly temperature', columns: ['temperature_c', 'region', 'recorded_at'], top1MustContain: ['temperature_c'], top3MustContain: ['temperature_c'] },
			{ family: 'outlier-intent', query: 'unusual latency spikes', columns: ['latency_ms', 'service', 'timestamp'], top1MustContain: ['latency_ms'], top3MustContain: ['latency_ms'] },
			{ family: 'outlier-intent', query: 'detect anomaly cost', columns: ['cost', 'department', 'visit_date'], top1MustContain: ['cost'], top3MustContain: ['cost'] },
			{ family: 'outlier-intent', query: 'outlier humidity', columns: ['humidity_pct', 'region', 'recorded_at'], top1MustContain: ['humidity_pct'], top3MustContain: ['humidity_pct'] },

			{ family: 'rank-intent', query: 'top tenant by spend', columns: ['tenant_name', 'monthly_spend', 'created_at'], top1MustContain: ['tenant_name'], top3MustContain: ['monthly_spend'] },
			{ family: 'rank-intent', query: 'highest industry mrr', columns: ['industry', 'mrr_usd', 'signup_date'], top1MustContain: ['industry'], top3MustContain: ['mrr_usd'] },
			{ family: 'rank-intent', query: 'leaderboard region revenue', columns: ['region', 'revenue', 'date'], top1MustContain: ['region'], top3MustContain: ['revenue'] },
			{ family: 'rank-intent', query: 'rank plan churn risk score', columns: ['plan', 'churn_risk_score', 'created_at'], top1MustContain: ['plan'], top3MustContain: ['churn_risk_score'] },
			{ family: 'rank-intent', query: 'top issue type count', columns: ['issue_type', 'priority', 'created_at'], top1MustContain: ['issue_type'], top3MustContain: ['issue_type'] },

			{ family: 'synonym-typo', query: 'brakdown industy rev', columns: ['industry', 'mrr_usd', 'arr_usd', 'signup_date'], top3MustContain: ['industry'] },
			{ family: 'synonym-typo', query: 'tenent spend', columns: ['tenant_name', 'monthly_spend', 'created_at'], top3MustContain: ['tenant_name'] },
			{ family: 'synonym-typo', query: 'timline arr', columns: ['arr_usd', 'report_date', 'segment'], top3MustContain: ['report_date'] },
			{ family: 'synonym-typo', query: 'cmpare mrr churn', columns: ['mrr_usd', 'churn_risk_score', 'industry', 'signup_date'], top3MustContain: ['mrr_usd'] },
			{ family: 'synonym-typo', query: 'anomly latency', columns: ['latency_ms', 'service', 'timestamp'], top3MustContain: ['latency_ms'] },

			{ family: 'mixed-measure-dimension', query: 'temperature region', columns: ['recorded_at', 'region', 'temperature_c', 'humidity_pct', 'air_quality_index'], top1MustContain: ['temperature_c'], top3MustContain: ['region'] },
			{ family: 'mixed-measure-dimension', query: 'humidity city', columns: ['city', 'humidity_pct', 'temperature_c', 'recorded_at'], top1MustContain: ['humidity_pct'], top3MustContain: ['city'] },
			{ family: 'mixed-measure-dimension', query: 'air quality region', columns: ['region', 'air_quality_index', 'recorded_at'], top1MustContain: ['air_quality_index'], top3MustContain: ['region'] },
			{ family: 'mixed-measure-dimension', query: 'latency service', columns: ['service', 'latency_ms', 'timestamp'], top1MustContain: ['latency_ms'], top3MustContain: ['service'] },
			{ family: 'mixed-measure-dimension', query: 'risk score plan', columns: ['plan', 'risk_score', 'created_at'], top1MustContain: ['risk_score'], top3MustContain: ['plan'] }
		];

		type FamilyStats = {
			total: number;
			top1Hits: number;
			top3Hits: number;
		};

		const stats = new Map<string, FamilyStats>();
		for (const scenario of scenarios) {
			const prompts = searchAnalysisPrompts({ query: scenario.query, availableColumns: scenario.columns, limit: 8 });
			const top1Text = `${prompts[0]?.label ?? ''} ${prompts[0]?.prompt ?? ''}`.toLowerCase();
			const top3Text = prompts.slice(0, 3).map((prompt) => `${prompt.label} ${prompt.prompt}`.toLowerCase());

			const familyStats = stats.get(scenario.family) ?? { total: 0, top1Hits: 0, top3Hits: 0 };
			familyStats.total += 1;

			if ((scenario.top1MustContain ?? []).every((token) => top1Text.includes(token.toLowerCase()))) {
				familyStats.top1Hits += 1;
			}

			if ((scenario.top3MustContain ?? []).every((token) => top3Text.some((entry) => entry.includes(token.toLowerCase())))) {
				familyStats.top3Hits += 1;
			}

			stats.set(scenario.family, familyStats);
		}

		const lines: string[] = [];
		const underperforming: Array<{ family: string; top1Rate: number; top3Rate: number; total: number }> = [];
		for (const [family, value] of stats.entries()) {
			const top1Rate = value.total === 0 ? 0 : value.top1Hits / value.total;
			const top3Rate = value.total === 0 ? 0 : value.top3Hits / value.total;
			lines.push(`${family}: top1=${top1Rate.toFixed(2)} top3=${top3Rate.toFixed(2)} n=${value.total}`);
			if (top1Rate < 0.6 || top3Rate < 0.8) {
				underperforming.push({ family, top1Rate, top3Rate, total: value.total });
			}
		}

		console.info(`[analysis-adversarial] scenarios=${scenarios.length}`);
		for (const line of lines.sort()) {
			console.info(`[analysis-adversarial] ${line}`);
		}
		if (underperforming.length > 0) {
			for (const family of underperforming) {
				console.warn(`[analysis-adversarial-underperform] ${family.family}: top1=${family.top1Rate.toFixed(2)} top3=${family.top3Rate.toFixed(2)} n=${family.total}`);
			}
		} else {
			console.info('[analysis-adversarial-underperform] none');
		}

		expect(scenarios.length).toBeGreaterThanOrEqual(30);
		expect(scenarios.length).toBeLessThanOrEqual(50);
	});

	it('hydrates date functions with sensible defaults', () => {
		const suggestions = searchFunctionActions({
			query: 'date trunc month order_date',
			availableColumns: ['order_date', 'amount']
		});

		const trunc = suggestions.find((entry) => entry.id === 'date.trunc');
		expect(trunc).toBeDefined();
		expect(trunc?.stage.columns[0]?.expr.mode).toBe('func');
		if (trunc?.stage.columns[0]?.expr.mode === 'func') {
			expect(trunc.stage.columns[0].expr.args[0]?.value).toBe('day');
			expect(trunc.stage.columns[0].expr.args[1]?.value).toBe('order_date');
		}
	});

	it('creates multi-stage presets with inferred columns', () => {
		const stages = makePresetStages('group-top', {
			availableColumns: ['region', 'product', 'amount', 'created_at']
		});

		expect(stages.map((s) => s.type)).toEqual(['group', 'sort', 'take']);
		expect(stages[0]).toEqual({
			type: 'group',
			by: ['region', 'product'],
			aggregations: [{ name: 'sum_amount', func: 'sum', column: 'amount' }]
		});
	});

	it('derives composed revenue metric from price and quantity columns', () => {
		const stages = makePresetStages('group-top', {
			availableColumns: ['Item Name', 'Category', 'Price (GHS)', 'Units Sold', 'Date Sold']
		});

		expect(stages[0]?.type).toBe('derive');
		if (stages[0]?.type === 'derive') {
			expect(stages[0].columns).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: 'revenue' })
				])
			);
			const revenueExpr = stages[0].columns.find((column) => column.name === 'revenue');
			expect(revenueExpr?.expr.mode).toBe('sstring');
			if (revenueExpr?.expr.mode === 'sstring') {
				expect(revenueExpr.expr.template).toContain('Price (GHS)');
				expect(revenueExpr.expr.template).toContain('Units Sold');
			}
		}

		expect(stages[1]?.type).toBe('group');
		if (stages[1]?.type === 'group') {
			expect(stages[1].aggregations).toEqual(
				expect.arrayContaining([{ name: 'sum_revenue', func: 'sum', column: 'revenue' }])
			);
		}
	});

	it('boosts ranking presets when composed business metric is inferable', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'wg' }],
			availableColumnCount: 7,
			availableColumns: ['Item Name', 'Category', 'Price (GHS)', 'Units Sold', 'Date Sold', 'Location', 'Customer Type']
		});

		const topIds = ranked.slice(0, 6).map((entry) => entry.preset.id);
		expect(topIds).toEqual(expect.arrayContaining(['group-top', 'temporal-trend', 'contribution-total']));
		const groupTop = ranked.find((entry) => entry.preset.id === 'group-top');
		expect(groupTop?.reasons.some((reason) => /composed metric/i.test(reason))).toBe(true);
	});

	it('builds all extended advanced presets into non-empty stage chains', () => {
		const columns = ['event_time', 'region', 'product', 'status', 'amount', 'revenue', 'cost', 'customer_id'];
		const presets = [
			'hierarchical-rollup',
			'contribution-total',
			'period-variance',
			'segment-anomaly',
			'null-hotspots',
			'duplicate-fingerprint',
			'cohort-retention',
			'funnel-dropoff',
			'outlier-explain',
			'seasonal-pattern',
			'efficiency-lens',
			'drift-monitor',
			'append-union-stack',
			'window-rolling',
			'window-lag-delta',
			'loop-refine'
		] as const;

		for (const presetId of presets) {
			const stages = makePresetStages(presetId, { availableColumns: columns });
			expect(stages.length).toBeGreaterThan(0);
			expect(stages[0]?.type).toMatch(/derive|group|sort|take|append|window|loop/);
		}
	});

	it('builds dedicated append/window/loop analysis bundles', () => {
		const appendStages = makePresetStages('append-union-stack', {
			availableColumns: ['event_time', 'region', 'amount']
		});
		expect(appendStages.some((stage) => stage.type === 'append')).toBe(true);

		const rollingStages = makePresetStages('window-rolling', {
			availableColumns: ['event_time', 'region', 'amount']
		});
		expect(rollingStages.some((stage) => stage.type === 'window')).toBe(true);

		const lagStages = makePresetStages('window-lag-delta', {
			availableColumns: ['event_time', 'region', 'amount']
		});
		expect(lagStages.some((stage) => stage.type === 'window')).toBe(true);
		expect(lagStages.some((stage) => stage.type === 'take')).toBe(true);

		const loopStages = makePresetStages('loop-refine', {
			availableColumns: ['event_time', 'region', 'amount']
		});
		expect(loopStages[0]?.type).toBe('loop');
	});

	it('ranks window-focused bundles highly for temporal metric schemas', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'events' }],
			availableColumnCount: 4,
			availableColumns: ['event_time', 'amount', 'region', 'customer_id']
		});

		const topIds = ranked.slice(0, 8).map((entry) => entry.preset.id);
		expect(topIds).toEqual(expect.arrayContaining(['window-rolling', 'window-lag-delta']));
	});

	it('recommends dedup-latest when key and timestamp columns exist', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'orders' }],
			availableColumnCount: 4,
			availableColumns: ['order_id', 'updated_at', 'customer_id', 'amount']
		});

		const dedup = ranked.find((item) => item.preset.id === 'dedup-latest');
		expect(dedup).toBeDefined();
		expect(dedup?.score).toBeGreaterThan(20);
	});

	it('builds exact dedup preset as full-row group with take 1', () => {
		const stages = makePresetStages('dedup-exact', {
			availableColumns: ['order_id', 'customer_id', 'amount']
		});

		expect(stages).toEqual([
			{
				type: 'group',
				by: ['order_id', 'customer_id', 'amount'],
				aggregations: [{ name: 'row_count', func: 'count', column: '' }],
				take: 1
			}
		]);
	});

	it('recommends exact dedup when dataset has multiple columns', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'orders' }],
			availableColumnCount: 4,
			availableColumns: ['order_id', 'updated_at', 'customer_id', 'amount']
		});

		const dedupExact = ranked.find((item) => item.preset.id === 'dedup-exact');
		expect(dedupExact).toBeDefined();
		expect(dedupExact?.score).toBeGreaterThan(10);
	});

	it('builds temporal trend preset with derive, group, and sort stages', () => {
		const stages = makePresetStages('temporal-trend', {
			availableColumns: ['event_time', 'amount', 'region']
		});

		expect(stages.map((s) => s.type)).toEqual(['derive', 'group', 'sort']);
		expect(stages[0]).toEqual({
			type: 'derive',
			columns: [
				{
					name: 'period_month',
					expr: {
						mode: 'sstring',
						template: 'date_trunc(\'month\', cast(\\"event_time\\" as timestamp))'
					}
				}
			]
		});
	});

	it('coerces text timestamps when metadata marks temporal intent', () => {
		const stages = makePresetStages('temporal-trend', {
			availableColumns: ['Completion Time', 'amount', 'region'],
			availableColumnProfiles: {
				'Completion Time': { dataKind: 'text', semanticType: 'date', confidence: 0.91 },
				amount: { dataKind: 'numeric', semanticType: 'amount', confidence: 0.9 }
			}
		});

		expect(stages.map((stage) => stage.type)).toEqual(['derive', 'group', 'sort']);
		const deriveStage = stages[0];
		expect(deriveStage?.type).toBe('derive');
		if (deriveStage?.type === 'derive') {
			expect(deriveStage.columns[0]?.expr).toEqual({
				mode: 'sstring',
				template: 'date_trunc(\'month\', cast(\\"Completion Time\\" as timestamp))'
			});
		}
	});

	it('builds cashflow rollup preset from paired flow columns', () => {
		const stages = makePresetStages('cashflow-rollup', {
			availableColumns: ['Completion Time', 'Paid In', 'Withdrawn', 'Payee']
		});

		expect(stages.map((s) => s.type)).toEqual(['derive', 'group', 'derive', 'sort']);
		const groupStage = stages[1];
		expect(groupStage?.type).toBe('group');
		if (groupStage?.type === 'group') {
			expect(groupStage.aggregations.some((agg) => agg.name === 'total_in')).toBe(true);
			expect(groupStage.aggregations.some((agg) => agg.name === 'total_out')).toBe(true);
			expect(groupStage.aggregations.some((agg) => agg.name === 'net_flow')).toBe(false);
		}
		const netFlowDerive = stages[2];
		expect(netFlowDerive?.type).toBe('derive');
		if (netFlowDerive?.type === 'derive') {
			expect(netFlowDerive.columns.some((column) => column.name === 'net_flow')).toBe(true);
		}
		const firstDerive = stages[0];
		expect(firstDerive?.type).toBe('derive');
		if (firstDerive?.type === 'derive') {
			const inflow = firstDerive.columns.find((column) => column.name === 'inflow');
			expect(inflow).toBeDefined();
			expect(inflow?.expr.mode).toBe('sstring');
			if (inflow?.expr.mode === 'sstring') {
				expect(inflow.expr.template).toContain('cast(nullif(regexp_replace');
			}

			const outflow = firstDerive.columns.find((column) => column.name === 'outflow');
			expect(outflow).toBeDefined();
			expect(outflow?.expr.mode).toBe('sstring');
			if (outflow?.expr.mode === 'sstring') {
				expect(outflow.expr.template).toContain('cast(nullif(regexp_replace');
				expect(outflow.expr.template).toContain('abs(');
			}
		}
	});

	it('coerces text revenue and cost columns in efficiency-lens preset', () => {
		const stages = makePresetStages('efficiency-lens', {
			availableColumns: ['Region', 'Revenue Amount', 'Cost Amount'],
			availableColumnProfiles: {
				'Revenue Amount': { dataKind: 'text', semanticType: 'amount', confidence: 0.9 },
				'Cost Amount': { dataKind: 'text', semanticType: 'amount', confidence: 0.88 }
			}
		});

		expect(stages[0]?.type).toBe('derive');
		if (stages[0]?.type === 'derive') {
			const revenue = stages[0].columns.find((column) => column.name === 'revenue_value');
			const cost = stages[0].columns.find((column) => column.name === 'cost_value');
			expect(revenue?.expr.mode).toBe('sstring');
			expect(cost?.expr.mode).toBe('sstring');
			if (revenue?.expr.mode === 'sstring') {
				expect(revenue.expr.template).toContain('cast(nullif(regexp_replace');
			}
			if (cost?.expr.mode === 'sstring') {
				expect(cost.expr.template).toContain('cast(nullif(regexp_replace');
			}
		}

		expect(stages[1]?.type).toBe('group');
		if (stages[1]?.type === 'group') {
			expect(stages[1].aggregations).toEqual(
				expect.arrayContaining([{ name: 'avg_efficiency_ratio', func: 'average', column: 'efficiency_ratio' }])
			);
		}
	});

	it('casts metric in text-categorize preset before summing', () => {
		const stages = makePresetStages('text-categorize', {
			availableColumns: ['Details', 'Balance', 'Payee'],
			availableColumnProfiles: {
				Balance: { dataKind: 'text', semanticType: 'amount', confidence: 0.9 }
			}
		});

		expect(stages.map((stage) => stage.type)).toEqual(['derive', 'group', 'sort']);
		const deriveStage = stages[0];
		expect(deriveStage?.type).toBe('derive');
		if (deriveStage?.type === 'derive') {
			const casted = deriveStage.columns.find((column) => column.name === 'Balance_numeric');
			expect(casted).toBeDefined();
			expect(casted?.expr.mode).toBe('sstring');
			if (casted?.expr.mode === 'sstring') {
				expect(casted.expr.template).toContain('cast(nullif(regexp_replace(cast(\\"Balance\\" as varchar)');
			}
		}

		const groupStage = stages[1];
		expect(groupStage?.type).toBe('group');
		if (groupStage?.type === 'group') {
			expect(groupStage.aggregations).toEqual(
				expect.arrayContaining([{ name: 'total_Balance', func: 'sum', column: 'Balance_numeric' }])
			);
		}
	});

	it('coerces text metrics in group-top when metadata marks numeric semantics', () => {
		const stages = makePresetStages('group-top', {
			availableColumns: ['region', 'Balance'],
			availableColumnProfiles: {
				Balance: { dataKind: 'text', semanticType: 'amount', confidence: 0.92 },
				region: { dataKind: 'text', semanticType: 'region', confidence: 0.9 }
			}
		});

		expect(stages[0]?.type).toBe('derive');
		if (stages[0]?.type === 'derive') {
			expect(stages[0].columns.some((column) => column.name === 'Balance_numeric')).toBe(true);
		}

		expect(stages[1]?.type).toBe('group');
		if (stages[1]?.type === 'group') {
			expect(stages[1].aggregations).toEqual(
				expect.arrayContaining([{ name: 'sum_Balance', func: 'sum', column: 'Balance_numeric' }])
			);
		}
	});

	it('uses dialect-specific coercion templates for clickhouse and postgres', () => {
		const clickhouseStages = makePresetStages('text-categorize', {
			availableColumns: ['Details', 'Balance', 'Payee'],
			availableColumnProfiles: {
				Balance: { dataKind: 'text', semanticType: 'amount', confidence: 0.9 }
			},
			dialect: 'clickhouse'
		});
		const clickhouseDerive = clickhouseStages.find((stage) => stage.type === 'derive');
		expect(clickhouseDerive?.type).toBe('derive');
		if (clickhouseDerive?.type === 'derive') {
			const casted = clickhouseDerive.columns.find((column) => column.name === 'Balance_numeric');
			expect(casted?.expr.mode).toBe('sstring');
			if (casted?.expr.mode === 'sstring') {
				expect(casted.expr.template).toContain('toFloat64OrNull(');
				expect(casted.expr.template).toContain('replaceRegexpAll(');
			}
		}

		const postgresStages = makePresetStages('text-categorize', {
			availableColumns: ['Details', 'Balance', 'Payee'],
			availableColumnProfiles: {
				Balance: { dataKind: 'text', semanticType: 'amount', confidence: 0.9 }
			},
			dialect: 'postgres'
		});
		const postgresDerive = postgresStages.find((stage) => stage.type === 'derive');
		expect(postgresDerive?.type).toBe('derive');
		if (postgresDerive?.type === 'derive') {
			const casted = postgresDerive.columns.find((column) => column.name === 'Balance_numeric');
			expect(casted?.expr.mode).toBe('sstring');
			if (casted?.expr.mode === 'sstring') {
				expect(casted.expr.template).toContain('regexp_replace(');
				expect(casted.expr.template).toContain('double precision');
			}
		}
	});

	it('does not fabricate paired flow columns when only one metric exists', () => {
		const stages = makePresetStages('cashflow-rollup', {
			availableColumns: ['created_at', 'updated_at', 'name', 'genre', 'bpm']
		});

		expect(stages.map((s) => s.type)).toEqual(['group', 'sort', 'take']);
		const groupStage = stages[0];
		expect(groupStage?.type).toBe('group');
		if (groupStage?.type === 'group') {
			expect(groupStage.aggregations.some((agg) => agg.name === 'total_in')).toBe(false);
			expect(groupStage.aggregations.some((agg) => agg.name === 'total_out')).toBe(false);
			expect(groupStage.aggregations.some((agg) => agg.name === 'net_flow')).toBe(false);
		}
	});

	it('ranks advanced presets for non-finance temporal + metric + text schemas', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'events' }],
			availableColumnCount: 5,
			availableColumns: ['event_time', 'service_name', 'error_message', 'duration_ms', 'request_id']
		});

		const topFour = ranked.slice(0, 4).map((item) => item.preset.id);
		expect(topFour).toEqual(expect.arrayContaining(['temporal-trend', 'text-categorize']));
		expect(ranked.map((item) => item.preset.id)).toContain('anomaly-scan');
	});

	it('uses class-like dimension and average aggregation for iris-like group-top', () => {
		const stages = makePresetStages('group-top', {
			availableColumns: ['sepal_length', 'sepal_width', 'petal_length', 'petal_width', 'species'],
			availableColumnProfiles: {
				sepal_length: { dataKind: 'numeric', semanticType: 'metric', confidence: 0.9 },
				sepal_width: { dataKind: 'numeric', semanticType: 'metric', confidence: 0.88 },
				petal_length: { dataKind: 'numeric', semanticType: 'metric', confidence: 0.89 },
				petal_width: { dataKind: 'numeric', semanticType: 'metric', confidence: 0.9 },
				species: { dataKind: 'text', semanticType: 'category', confidence: 0.95 }
			}
		});

		expect(stages[0]?.type).toBe('group');
		if (stages[0]?.type === 'group') {
			expect(stages[0].by).toEqual(expect.arrayContaining(['species']));
			expect(stages[0].aggregations[0]?.func).toBe('average');
		}
	});

	it('prioritizes professional feature-matrix presets for iris-like schemas', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'iris' }],
			availableColumnCount: 5,
			availableColumns: ['sepal_length', 'sepal_width', 'petal_length', 'petal_width', 'species']
		});

		const topIds = ranked.slice(0, 6).map((entry) => entry.preset.id);
		expect(topIds).toEqual(expect.arrayContaining(['group-top', 'segment-anomaly', 'outlier-explain']));

		const groupTop = ranked.find((entry) => entry.preset.id === 'group-top');
		const nullHotspots = ranked.find((entry) => entry.preset.id === 'null-hotspots');
		const duplicate = ranked.find((entry) => entry.preset.id === 'duplicate-fingerprint');
		expect(groupTop?.score ?? 0).toBeGreaterThan(nullHotspots?.score ?? 0);
		expect(groupTop?.score ?? 0).toBeGreaterThan(duplicate?.score ?? 0);
	});

	it('ranks advanced templates for since23 transaction columns', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'since23' }],
			availableColumnCount: 8,
			availableColumns: [
				'Receipt No.',
				'Completion Time',
				'Details',
				'Transaction Status',
				'Paid In',
				'Withdrawn',
				'Balance',
				'Payee'
			]
		});

		const ids = ranked.slice(0, 5).map((item) => item.preset.id);
		expect(ids).toEqual(
			expect.arrayContaining(['cashflow-rollup', 'temporal-trend', 'text-categorize'])
		);
		expect(ranked.map((item) => item.preset.id)).toContain('frequency-ranking');
	});

	it('keeps temporal trend visible for logistics-style temporal metric schemas', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'logistics_ops' }],
			availableColumnCount: 8,
			availableColumns: [
				'Shipment Ref',
				'Settled At',
				'Route Details',
				'Settlement Status',
				'Freight Income',
				'Fuel Expense',
				'Cash Balance',
				'Carrier'
			]
		});

		const top = ranked.slice(0, 6).map((item) => item.preset.id);
		expect(top).toContain('temporal-trend');
		expect(top).toContain('text-categorize');
	});

	it('ranks cashflow and text presets for output.csv-like transaction columns', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'mpesa_transactions' }],
			availableColumnCount: 7,
			availableColumns: [
				'Receipt No.',
				'Completion Time',
				'Details',
				'Transaction Status',
				'Paid In',
				'Withdrawn',
				'Balance'
			]
		});

		const top = ranked.slice(0, 6).map((item) => item.preset.id);
		expect(top).toEqual(
			expect.arrayContaining(['cashflow-rollup', 'temporal-trend', 'text-categorize'])
		);
		const cashflow = ranked.find((item) => item.preset.id === 'cashflow-rollup');
		expect(cashflow?.score).toBeGreaterThan(25);
	});

	it('avoids overfitting group dimensions to generic name columns when better categories exist', () => {
		const stages = makePresetStages('group-top', {
			availableColumns: ['track_name', 'genre', 'region', 'amount', 'created_at']
		});

		expect(stages[0]?.type).toBe('group');
		if (stages[0]?.type === 'group') {
			expect(stages[0].by).toEqual(expect.arrayContaining(['genre']));
			expect(stages[0].by).not.toEqual(expect.arrayContaining(['track_name']));
		}
	});

	it('derives true share-of-total for contribution-total preset', () => {
		const stages = makePresetStages('contribution-total', {
			availableColumns: ['Category', 'Amount', 'Date Sold']
		});

		const deriveStage = stages.find((stage) => stage.type === 'derive');
		expect(deriveStage?.type).toBe('derive');
		if (deriveStage?.type === 'derive') {
			const pctColumn = deriveStage.columns.find((column) => column.name === 'pct_Amount');
			expect(pctColumn).toBeDefined();
			expect(pctColumn?.expr.mode).toBe('sstring');
			if (pctColumn?.expr.mode === 'sstring') {
				expect(pctColumn.expr.template).toContain('sum(sum_Amount) over ()');
				expect(pctColumn.expr.template).not.toContain('/ row_count');
			}
		}
	});

	it('builds intelligent quick chips from column semantics', () => {
		const chips = getQuickChips({
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['status', 'region', 'amount', 'created_at', 'customer_id']
		});

		expect(chips.map((chip) => chip.icon)).toEqual(
			expect.arrayContaining(['sort', 'filter', 'group', 'derive'])
		);

		const groupChip = chips.find((chip) => chip.icon === 'group');
		expect(groupChip?.label).toContain('Group');
		expect(groupChip?.hydration.semanticCategory).toBe('categorical');
		expect(groupChip?.hydration.analysisPattern).toContain('Segmentation');
		expect(groupChip?.stage).toEqual({
			type: 'group',
			by: ['region'],
			aggregations: [{ name: 'sum_amount', func: 'sum', column: 'amount' }]
		});
		expect(groupChip?.snippet?.prql).toContain('group');
	});

	it('includes snippet payloads for recommended presets', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'orders' }],
			availableColumnCount: 4,
			availableColumns: ['order_id', 'updated_at', 'customer_id', 'amount']
		});

		expect(ranked.length).toBeGreaterThan(0);
		expect(ranked[0]?.snippet?.prql.length ?? 0).toBeGreaterThan(0);
		expect(ranked[0]?.snippet?.tags.length ?? 0).toBeGreaterThan(0);
	});

	it('emits hydrated metadata for recommended presets', () => {
		const ranked = recommendPresets({
			stages: [{ type: 'from', table: 'orders' }],
			availableColumnCount: 4,
			availableColumns: ['order_id', 'updated_at', 'customer_id', 'amount']
		});

		const trend = ranked.find((entry) => entry.preset.id === 'temporal-trend');
		expect(trend?.hydration.semanticCategory).toBe('temporal');
		expect(trend?.hydration.analysisPattern).toContain('Time-Series');
		expect(trend?.hydration.metricHints.length).toBeGreaterThan(0);
	});

	it('avoids offering quick chips for stages already in pipeline', () => {
		const chips = getQuickChips({
			stages: [
				{ type: 'from', table: 'orders' },
				{ type: 'sort', keys: [{ column: 'created_at', dir: 'desc' }] },
				{ type: 'filter', conditions: [{ column: 'status', op: '==', value: 'open' }], logic: 'and' }
			],
			availableColumns: ['status', 'amount', 'created_at']
		});

		expect(chips.some((chip) => chip.icon === 'sort')).toBe(false);
		expect(chips.some((chip) => chip.icon === 'filter')).toBe(false);
	});

	it('avoids treating timestamp columns as numeric metrics in fallback chips', () => {
		const chips = getQuickChips({
			stages: [{ type: 'from', table: 'events' }],
			availableColumns: ['createdAt', 'name', 'id']
		});

		const groupChip = chips.find((chip) => chip.icon === 'group');
		expect(groupChip?.label).toContain('Group');
		expect(groupChip?.label).not.toContain('sum createdAt');

		const deriveChip = chips.find((chip) => chip.icon === 'derive');
		expect(deriveChip).toBeDefined();
		expect(deriveChip?.label).not.toContain('createdAt_rounded');
		expect(deriveChip?.label).toContain('Normalize Name to lowercase');
	});

	it('counts rows for group chips when only text-like columns are available', () => {
		const chips = getQuickChips({
			stages: [{ type: 'from', table: 'opportunities' }],
			availableColumns: ['source_platform', 'job_title', 'scraped_at']
		});

		const groupChip = chips.find((chip) => chip.icon === 'group');
		expect(groupChip?.label).toContain('count rows');
		expect(groupChip?.label).not.toContain('sum job_title');
		expect(groupChip?.stage).toEqual({
			type: 'group',
			by: ['source_platform'],
			aggregations: [{ name: 'row_count', func: 'count', column: '' }]
		});
	});

	it('treats deadline-like fields as temporal and avoids summing them', () => {
		const chips = getQuickChips({
			stages: [{ type: 'from', table: 'opportunities' }],
			availableColumns: ['role_category', 'job_title', 'application_deadline']
		});

		const sortChip = chips.find((chip) => chip.icon === 'sort');
		expect(sortChip?.label).toContain('Application Deadline');
		expect(sortChip?.label).not.toContain('application_deadline');

		const groupChip = chips.find((chip) => chip.icon === 'group');
		expect(groupChip?.label).toContain('count rows');
		expect(groupChip?.label).not.toContain('sum application_deadline');
	});

	it('skips derive rounding for count-like numeric-only columns', () => {
		const chips = getQuickChips({
			stages: [{ type: 'from', table: 'jobs' }],
			availableColumns: ['total_jobs', 'createdAt', 'id']
		});

		expect(chips.some((chip) => chip.icon === 'derive')).toBe(false);
		expect(chips.some((chip) => chip.label.includes('total_jobs_rounded'))).toBe(false);
	});

	it('emits dedicated append, window, and loop quick chips', () => {
		const chips = getQuickChips({
			stages: [{ type: 'from', table: 'transactions' }],
			availableColumns: ['event_time', 'total_jobs', 'region']
		});

		const appendChip = chips.find((chip) => chip.icon === 'append');
		expect(appendChip?.stage.type).toBe('append');

		const windowChip = chips.find((chip) => chip.icon === 'window');
		expect(windowChip?.stage.type).toBe('window');

		const loopChip = chips.find((chip) => chip.icon === 'loop');
		expect(loopChip?.stage.type).toBe('loop');
	});

	it('offers explicit remove-duplicate-rows quick chip', () => {
		const chips = getQuickChips({
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['order_id', 'customer_id', 'amount']
		});

		const dedupChip = chips.find((chip) => chip.id === 'dedup-exact-rows');
		expect(dedupChip?.label).toBe('Remove exact duplicate rows');
		expect(dedupChip?.stage).toEqual({
			type: 'group',
			by: ['order_id', 'customer_id', 'amount'],
			aggregations: [{ name: 'row_count', func: 'count', column: '' }],
			take: 1
		});
	});

	it('generates syntactically valid PRQL for every preset chain', async () => {
		const opts = new NodeCompileOptions();
		opts.target = 'sql.duckdb';
		opts.signature_comment = false;
		opts.format = true;
		const isExpectedResolutionError = (error: unknown): boolean => {
			const message = String((error as { message?: string })?.message ?? error);
			try {
				const parsed = JSON.parse(message) as {
					inner?: Array<{ reason?: string }>;
					reason?: string;
				};
				const reasons = parsed.inner?.map((item) => item.reason ?? '') ?? [parsed.reason ?? ''];
				return reasons.length > 0 && reasons.every((reason) => /Unknown name|Unknown table|Unknown relation/i.test(reason));
			} catch {
				return false;
			}
		};

		const availableColumns = [
			'Receipt No.',
			'Completion Time',
			'Details',
			'Transaction Status',
			'Paid In',
			'Withdrawn',
			'Balance',
			'Payee',
			'amount',
			'region',
			'event_time',
			'customer_id'
		];

		for (const preset of STAGE_PRESETS) {
			const stages: GUIPipelineStage[] = [
				{ type: 'from', table: 'since23' },
				...makePresetStages(preset.id, { availableColumns })
			];
			const prql = guiToPreql(stages);
			try {
				compileNodePrql(prql, opts);
			} catch (error) {
				expect(
					isExpectedResolutionError(error),
					`Preset ${preset.id} produced invalid PRQL:\n${prql}\n${String((error as { message?: string })?.message ?? error)}`
				).toBe(true);
			}
		}
	});

	it('keeps fallback preset chains valid when temporal or metric columns are missing', () => {
		const textOnlyColumns = ['region', 'status', 'name'];

		const periodVariance = makePresetStages('period-variance', {
			availableColumns: textOnlyColumns
		});
		expect(periodVariance.some((stage) => stage.type === 'group' && stage.by.includes('period_month'))).toBe(false);
		expect(
			periodVariance.some(
				(stage) => stage.type === 'sort' && stage.keys.some((key) => key.column === 'period_month')
			)
		).toBe(false);

		const cohort = makePresetStages('cohort-retention', {
			availableColumns: textOnlyColumns
		});
		expect(cohort.some((stage) => stage.type === 'group' && stage.by.includes('period_month'))).toBe(false);

		const seasonal = makePresetStages('seasonal-pattern', {
			availableColumns: textOnlyColumns
		});
		expect(
			seasonal.some(
				(stage) => stage.type === 'group' && stage.by.some((value) => value === 'season_month' || value === 'season_weekday')
			)
		).toBe(false);

		const drift = makePresetStages('drift-monitor', {
			availableColumns: textOnlyColumns
		});
		expect(
			drift.some(
				(stage) => stage.type === 'derive' && stage.columns.some((column) => column.name === 'drift_delta')
			)
		).toBe(false);

		const nullHotspots = makePresetStages('null-hotspots', {
			availableColumns: textOnlyColumns
		});
		expect(
			nullHotspots.some(
				(stage) => stage.type === 'derive' && stage.columns.some((column) => column.name === 'is_missing_metric')
			)
		).toBe(true);
		expect(
			nullHotspots.some(
				(stage) =>
					stage.type === 'group' &&
					stage.aggregations.some((aggregation) => aggregation.name === 'missing_count')
			)
		).toBe(true);
	});

	it('prioritizes strong metric presets for benchmark CSV schemas', () => {
		const inferProfiles = (columns: string[]) => {
			const profiles: Record<string, { dataKind: 'numeric' | 'date' | 'boolean' | 'text'; semanticType?: string; confidence?: number }> = {};
			for (const column of columns) {
				if (/(date|time|_at|recorded|signup|ship|attendance|production|start|end)/i.test(column)) {
					profiles[column] = { dataKind: 'date', semanticType: 'date', confidence: 0.9 };
					continue;
				}
				if (/^(is_|has_)|(?:^|_)(present|active|admitted|escalated|occupied|passed|returned|alert|fraud|qa_passed|delivered_on_time|pets_allowed)$/i.test(column)) {
					profiles[column] = { dataKind: 'boolean', semanticType: 'flag', confidence: 0.85 };
					continue;
				}
				if (/(amount|price|cost|mrr|seats|units|score|minutes|hours|days|distance|weight|temperature|humidity|wind|rainfall|energy|risk|rate|pct|percent|fx|defect|downtime|kwh|usd|kg|km)/i.test(column)) {
					profiles[column] = { dataKind: 'numeric', semanticType: 'metric', confidence: 0.82 };
					continue;
				}
				profiles[column] = { dataKind: 'text', semanticType: 'category', confidence: 0.72 };
			}
			return profiles;
		};

		const scenarios: Array<{
			name: string;
			columns: string[];
			requires: string[];
			oneOf?: string[];
		}> = [
			{
				name: 'ecommerce_orders',
				columns: ['order_id', 'order_date', 'customer_name', 'region', 'channel', 'product_category', 'units', 'unit_price', 'discount_pct', 'returned', 'shipping_days'],
				requires: ['temporal-trend', 'contribution-total'],
				oneOf: ['group-top', 'hierarchical-rollup', 'segment-anomaly']
			},
			{
				name: 'hospital_visits',
				columns: ['visit_id', 'visit_date', 'patient_age', 'patient_gender', 'department', 'triage_level', 'diagnosis', 'cost_usd', 'admitted', 'wait_minutes'],
				requires: ['temporal-trend'],
				oneOf: ['group-top', 'hierarchical-rollup', 'anomaly-scan', 'segment-anomaly']
			},
			{
				name: 'logistics_shipments',
				columns: ['shipment_id', 'ship_date', 'origin', 'destination', 'mode', 'carrier', 'weight_kg', 'distance_km', 'fragile', 'delivered_on_time'],
				requires: ['temporal-trend', 'anomaly-scan'],
				oneOf: ['group-top', 'hierarchical-rollup', 'segment-anomaly']
			},
			{
				name: 'real_estate_leases',
				columns: ['lease_id', 'property_type', 'city', 'tenant_name', 'start_date', 'end_date', 'rent_usd', 'deposit_usd', 'square_meters', 'occupied', 'pets_allowed'],
				requires: ['temporal-trend', 'period-variance'],
				oneOf: ['group-top', 'hierarchical-rollup', 'contribution-total']
			},
			{
				name: 'saas_subscriptions',
				columns: ['account_id', 'signup_date', 'plan', 'billing_cycle', 'seats', 'mrr_usd', 'active', 'industry', 'churn_risk_score', 'last_login_days_ago'],
				requires: ['temporal-trend'],
				oneOf: ['group-top', 'hierarchical-rollup', 'anomaly-scan', 'segment-anomaly']
			},
			{
				name: 'manufacturing_batches',
				columns: ['batch_id', 'production_date', 'plant', 'product_line', 'units_produced', 'defect_rate_pct', 'downtime_minutes', 'operator_shift', 'qa_passed', 'energy_kwh'],
				requires: ['temporal-trend', 'anomaly-scan'],
				oneOf: ['group-top', 'hierarchical-rollup', 'segment-anomaly']
			},
			{
				name: 'climate_readings',
				columns: ['station_id', 'recorded_at', 'region', 'temperature_c', 'humidity_pct', 'wind_kph', 'rainfall_mm', 'air_quality_index', 'storm_alert'],
				requires: ['temporal-trend', 'anomaly-scan'],
				oneOf: ['group-top', 'hierarchical-rollup', 'segment-anomaly']
			},
			{
				name: 'support_tickets',
				columns: ['ticket_id', 'created_at', 'priority', 'channel', 'customer_segment', 'issue_type', 'first_response_minutes', 'resolution_hours', 'csat_score', 'escalated'],
				requires: ['temporal-trend', 'text-categorize'],
				oneOf: ['group-top', 'hierarchical-rollup', 'segment-anomaly']
			},
			{
				name: 'school_attendance',
				columns: ['student_id', 'student_name', 'grade', 'homeroom', 'attendance_date', 'present', 'arrival_time', 'math_score', 'reading_score', 'club'],
				requires: ['temporal-trend'],
				oneOf: ['group-top', 'hierarchical-rollup', 'anomaly-scan', 'segment-anomaly']
			},
			{
				name: 'fintech_transactions',
				columns: ['txn_id', 'txn_time', 'account_type', 'country', 'payment_method', 'merchant_category', 'amount_usd', 'fx_rate', 'is_fraud', 'settlement_status'],
				requires: ['temporal-trend', 'contribution-total'],
				oneOf: ['group-top', 'hierarchical-rollup', 'segment-anomaly']
			}
		];

		for (const scenario of scenarios) {
			const ranked = recommendPresets({
				stages: [{ type: 'from', table: scenario.name }],
				availableColumnCount: scenario.columns.length,
				availableColumns: scenario.columns,
				availableColumnProfiles: inferProfiles(scenario.columns)
			});

			const topIds = ranked.slice(0, 8).map((entry) => entry.preset.id);
			expect(
				topIds,
				`${scenario.name} missing expected preset in top ranking: ${scenario.requires.join(', ')}`
			).toEqual(expect.arrayContaining(scenario.requires));
			if (scenario.oneOf && scenario.oneOf.length > 0) {
				expect(
					topIds.some((id) => scenario.oneOf?.includes(id)),
					`${scenario.name} missing any metric-breakdown preset in top ranking: ${scenario.oneOf.join(', ')}`
				).toBe(true);
			}
		}
	});

	it('builds robust plans for since23 natural-language analytical prompts', () => {
		const availableColumns = [
			'Receipt No.',
			'Completion Time',
			'Details',
			'Transaction Status',
			'Paid In',
			'Withdrawn',
			'Balance',
			'Payee'
		];

		const prompts = [
			'who did i pay the most in january',
			'show where money leaks each month',
			'which vendors are becoming expensive lately'
		];

		for (const query of prompts) {
			const plan = generatePromptStagePlan({
				query,
				availableColumns,
				validateCompile: false
			});

			expect(plan, `expected plan for query: ${query}`).toBeDefined();
			expect(
				(plan?.validation.unknownColumns ?? []).length <= 1,
				`expected low unresolved-column count for query: ${query}`
			).toBe(true);

			const stages = plan?.stages ?? [];
			expect(
				stages.some((stage) => stage.type === 'group') || stages.some((stage) => stage.type === 'window'),
				`expected grouped or windowed analysis for query: ${query}`
			).toBe(true);
			expect(
				stages.some((stage) => stage.type === 'sort') || stages.some((stage) => stage.type === 'take') || stages.some((stage) => stage.type === 'filter'),
				`expected ranking/filtering stages for query: ${query}`
			).toBe(true);
		}
	});

	it('infers a january payment-ranking plan from implicit temporal language', () => {
		const plan = generatePromptStagePlan({
			query: 'who did i pay the most in january',
			availableColumns: ['Receipt No.', 'Completion Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn', 'Balance', 'Payee'],
			validateCompile: false
		});

		expect(plan).toBeDefined();
		expect(plan?.stages[0]).toMatchObject({
			type: 'filter',
			conditions: [{ column: 'Completion Time', op: 'like', value: '%-01-%' }]
		});
		expect(plan?.stages.some((stage) => stage.type === 'group' && stage.by.includes('Payee'))).toBe(true);
		expect(plan?.stages.some((stage) => stage.type === 'sort')).toBe(true);
	});

	it('compiles every preset across multiple schema profiles', () => {
		const opts = new NodeCompileOptions();
		opts.target = 'sql.duckdb';
		opts.signature_comment = false;
		opts.format = true;

		const isExpectedResolutionError = (error: unknown): boolean => {
			const message = String((error as { message?: string })?.message ?? error);
			try {
				const parsed = JSON.parse(message) as {
					inner?: Array<{ reason?: string }>;
					reason?: string;
				};
				const reasons = parsed.inner?.map((item) => item.reason ?? '') ?? [parsed.reason ?? ''];
				return reasons.length > 0 && reasons.every((reason) => /Unknown name|Unknown table|Unknown relation/i.test(reason));
			} catch {
				return false;
			}
		};

		const schemaProfiles: string[][] = [
			['event_time', 'amount', 'region', 'customer_id'],
			['status', 'segment', 'name'],
			['created_at', 'category', 'total_orders'],
			['Paid In', 'Withdrawn', 'Completion Time', 'Payee', 'Details']
		];

		for (const availableColumns of schemaProfiles) {
			for (const preset of STAGE_PRESETS) {
				const stages: GUIPipelineStage[] = [
					{ type: 'from', table: 'sample_source' },
					...makePresetStages(preset.id, { availableColumns })
				];
				const prql = guiToPreql(stages);
				try {
					compileNodePrql(prql, opts);
				} catch (error) {
					expect(
						isExpectedResolutionError(error),
						`Preset ${preset.id} failed for profile ${JSON.stringify(availableColumns)}:\n${prql}\n${String((error as { message?: string })?.message ?? error)}`
					).toBe(true);
				}
			}
		}
	});
});
