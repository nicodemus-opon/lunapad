import { describe, expect, it } from 'vitest';
import { isChatToolCallAllowed, blockedToolFallbackText } from './chat-tool-policy.js';

const ctx = {
	schemaTableNames: new Set(['orders', 'region_targets']),
	cellOutputNames: new Set(['monthly_revenue']),
	latestUserMessage: 'delete all cells now'
};

describe('chat-tool-policy', () => {
	it('blocks bulk delete_cell', () => {
		expect(isChatToolCallAllowed('delete_cell', { cellId: 'all' }, ctx)).toBe(false);
		expect(isChatToolCallAllowed('delete_cell', { cellId: 'orders' }, ctx)).toBe(false);
	});

	it('blocks sample_data on unknown tables', () => {
		expect(
			isChatToolCallAllowed(
				'sample_data',
				{ table: 'unicorn_revenue' },
				{
					...ctx,
					latestUserMessage: 'show arr'
				}
			)
		).toBe(false);
	});

	it('allows sample_data on schema tables', () => {
		expect(
			isChatToolCallAllowed(
				'sample_data',
				{ table: 'orders' },
				{
					...ctx,
					latestUserMessage: 'show orders'
				}
			)
		).toBe(true);
	});

	it('returns fallback text for unknown table', () => {
		const msg = blockedToolFallbackText(
			'sample_data',
			{ table: 'unicorn_revenue' },
			{ ...ctx, latestUserMessage: 'x' },
			[{ name: 'orders', columns: ['region'] }]
		);
		expect(msg).toMatch(/unicorn_revenue/);
		expect(msg).toMatch(/orders/);
	});

	it('blocks create_cell referencing unknown tables', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'cohort_ltv',
					code: 'from ltv_facts\nderive x = churn_score'
				},
				{ ...ctx, latestUserMessage: 'build ltv' }
			)
		).toBe(false);
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'cohort_ltv',
					code: 'PRQL model referencing table ltv_facts with columns customer_ltv'
				},
				{ ...ctx, latestUserMessage: 'build ltv' }
			)
		).toBe(false);
	});

	it('allows create_cell on known schema tables', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'ent_monthly',
					code: 'SELECT region, SUM(quantity * unit_price) FROM orders GROUP BY 1'
				},
				{ ...ctx, latestUserMessage: 'build' }
			)
		).toBe(true);
	});

	it('allows markdown create_cell without code field', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'overview',
					cellType: 'markdown',
					markdown: '## Hi\n{% metric value=$orders.count label="N" /%}'
				},
				{ ...ctx, latestUserMessage: 'dashboard', cellOutputNames: new Set(['orders']) }
			)
		).toBe(true);
	});

	it('accepts structured dashboard payloads once compiled markdown is present', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'overview',
					cellType: 'markdown',
					dashboard: {
						title: 'Notebook',
						blocks: [{ type: 'metric', value: '$orders.count', label: 'Orders' }]
					},
					markdown: '{% metric value=$orders.count label="Orders" /%}'
				},
				{ ...ctx, latestUserMessage: 'document notebook', cellOutputNames: new Set(['orders']) }
			)
		).toBe(true);
	});

	it('blocks markdown with phantom refs', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'bad',
					cellType: 'markdown',
					markdown: '{% metric value=$phantom.total label="x" /%}'
				},
				{ ...ctx, latestUserMessage: 'dashboard', cellOutputNames: new Set(['orders']) }
			)
		).toBe(false);
	});

	it('blocks markdown with $cell placeholder and stg_ refs', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'bad',
					cellType: 'markdown',
					markdown: '{% metric value=$cell.total label="x" /%}'
				},
				{ ...ctx, latestUserMessage: 'dashboard', cellOutputNames: new Set(['monthly_revenue']) }
			)
		).toBe(false);
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'bad',
					cellType: 'markdown',
					markdown: '{% chart data=$stg_orders.rows x="region" y="n" /%}'
				},
				{ ...ctx, latestUserMessage: 'dashboard', cellOutputNames: new Set(['stg_orders']) }
			)
		).toBe(false);
	});
});
