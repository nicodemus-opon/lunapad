import { describe, expect, it } from 'vitest';

import {
	getNextStageRecommendations,
	getStageEvidenceSummary,
	getStageQualityInsights,
	presentStageErrors
} from '$lib/components/gui/stage-card-utils';

describe('getStageEvidenceSummary', () => {
	it('returns status labels for non-result states', () => {
		expect(getStageEvidenceSummary({ kind: 'idle' })).toBe('none');
		expect(getStageEvidenceSummary({ kind: 'loading' })).toBe('running');
		expect(getStageEvidenceSummary({ kind: 'error', message: 'boom' })).toBe('error');
	});

	it('formats row and column counts with singular and plural labels', () => {
		expect(getStageEvidenceSummary({ kind: 'result', rows: [{ id: 1 }], columns: ['id'] })).toBe(
			'1 row · 1 col'
		);

		expect(
			getStageEvidenceSummary({
				kind: 'result',
				rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
				columns: ['id', 'name']
			})
		).toBe('3 rows · 2 cols');
	});
});

describe('getStageQualityInsights', () => {
	it('returns info and warning insights from result evidence', () => {
		const rows = Array.from({ length: 40 }, (_, i) => ({
			id: i,
			amount: i * 10,
			city: `city-${i}`,
			region: i % 2 === 0 ? null : 'east'
		}));

		const insights = getStageQualityInsights({
			kind: 'result',
			rows,
			columns: ['id', 'amount', 'city', 'region']
		});

		expect(insights.some((insight) => insight.label === 'Metrics ready')).toBe(true);
		expect(insights.some((insight) => insight.label === 'Null heavy')).toBe(true);
	});
});

describe('getNextStageRecommendations', () => {
	it('recommends sensible follow-up stages from stage type and evidence', () => {
		const recommendations = getNextStageRecommendations('group', {
			kind: 'result',
			rows: [{ amount: 10 }, { amount: 20 }, { amount: 30 }],
			columns: ['amount']
		});

		expect(recommendations.map((r) => r.type)).toContain('sort');
		expect(recommendations.map((r) => r.type)).toContain('take');
	});

	it('builds prefilled stages from evidence shape', () => {
		const recommendations = getNextStageRecommendations('filter', {
			kind: 'result',
			rows: [
				{ region: 'east', amount: 10, margin: 2 },
				{ region: 'west', amount: 20, margin: 5 }
			],
			columns: ['region', 'amount', 'margin']
		});

		const groupSuggestion = recommendations.find((item) => item.type === 'group');
		expect(groupSuggestion).toBeDefined();
		if (!groupSuggestion || groupSuggestion.stage.type !== 'group') return;
		expect(groupSuggestion.stage.by).toEqual(['region']);
		expect(groupSuggestion.stage.aggregations[0]?.column).toBe('amount');
		expect(groupSuggestion.stage.aggregations[0]?.func).toBe('sum');
	});

	it('prefills filter using numeric threshold', () => {
		const recommendations = getNextStageRecommendations('from', {
			kind: 'result',
			rows: [
				{ customer_id: 'c_1', amount: 10, region: 'east' },
				{ customer_id: 'c_2', amount: 30, region: 'west' },
				{ customer_id: 'c_3', amount: 50, region: 'west' }
			],
			columns: ['customer_id', 'amount', 'region']
		});

		const filterSuggestion = recommendations.find((item) => item.type === 'filter');
		expect(filterSuggestion).toBeDefined();
		if (filterSuggestion?.stage.type === 'filter') {
			expect(filterSuggestion.stage.conditions[0]?.column).toBe('amount');
			expect(filterSuggestion.stage.conditions[0]?.op).toBe('>=');
			expect(filterSuggestion.stage.conditions[0]?.value).toBe('30');
		}
	});

	it('prefills join stage with shorthand guessed key condition', () => {
		const recommendations = getNextStageRecommendations('from', {
			kind: 'result',
			rows: [{ customer_id: 'c_1' }, { customer_id: 'c_2' }],
			columns: ['customer_id']
		});

		const joinPrefill = recommendations.find((item) => item.type === 'join');
		expect(joinPrefill).toBeDefined();
		if (!joinPrefill || joinPrefill.stage.type !== 'join') return;
		expect(joinPrefill.stage.conditions[0]?.left).toBe('customer_id');
		expect(joinPrefill.stage.conditions[0]?.right).toBe('customer_id');
		expect(joinPrefill.stage.conditions[0]?.shorthand).toBe(true);
	});
});

describe('presentStageErrors', () => {
	it('adds derive chip pinpoint labels from stage line mapping', () => {
		const presented = presentStageErrors(
			{
				type: 'derive',
				columns: [
					{ name: 'gross', expr: { mode: 'raw', expr: 'amount' } },
					{ name: 'net', expr: { mode: 'raw', expr: 'gross - tax' } }
				]
			},
			[
				{
					reason: "can't find column tax",
					hint: null,
					display: null,
					stageLine: 2
				}
			]
		);

		expect(presented[0]?.lineLabel).toBe('derive chip net');
		expect(presented[0]?.hint).toContain('Verify column names');
	});

	it('falls back to stage line labels for non-derive stages', () => {
		const presented = presentStageErrors(
			{
				type: 'join',
				joinType: 'inner',
				table: 'customers',
				conditions: [{ left: 'customer_id', right: 'id' }]
			},
			[
				{
					reason: 'ambiguous reference to id',
					hint: null,
					display: null,
					stageLine: 0
				}
			]
		);

		expect(presented[0]?.lineLabel).toBe('stage line 1');
		expect(presented[0]?.hint).toContain('join alias');
	});
});
